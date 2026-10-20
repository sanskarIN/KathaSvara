// SPDX-License-Identifier: MPL-2.0
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use atomicwrites::{AtomicFile, OverwriteBehavior};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;
use uuid::Uuid;

const MAX_GENERATED_WAV: u64 = 25 * 1024 * 1024;
const MAX_TEXT_LENGTH: usize = 3000;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
struct StoryProject {
    id: String,
    title: String,
    text: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct TextInspection {
    normalized: String,
    characters: usize,
    chunks: Vec<String>,
    chunk_count: usize,
    changed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct VoiceProfileV2 {
    engine_id: String,
    model_id: String,
    language: String,
    exaggeration: f32,
    cfg_weight: f32,
    pause_ms: u32,
    profile_version: u16,
    speaker_conditioning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CharacterV2 {
    id: String,
    name: String,
    voice: VoiceProfileV2,
    description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SegmentV2 {
    id: String,
    original_text: String,
    spoken_text: String,
    speaker_id: Option<String>,
    kind: String,
    status: String,
    audio_ref: Option<String>,
    duration_seconds: Option<f64>,
    source_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SceneV2 {
    id: String,
    title: String,
    segments: Vec<SegmentV2>,
    notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoryV2 {
    schema_version: u32,
    id: String,
    title: String,
    text: String,
    characters: Vec<CharacterV2>,
    scenes: Vec<SceneV2>,
}

fn validate_story_v2(doc: &StoryV2) -> Result<(), String> {
    if doc.schema_version != 2 || Uuid::parse_str(&doc.id).is_err() {
        return Err("Unsupported v2 story schema or ID.".into());
    }
    if doc.title.trim().is_empty() || doc.title.chars().count() > 120 ||
       doc.text.chars().count() > 100_000 {
        return Err("Invalid story title or length.".into());
    }
    if doc.characters.is_empty() || doc.characters.len() > 100 || doc.scenes.len() > 200 {
        return Err("Character or scene count exceeds limits.".into());
    }
    let mut ids = std::collections::HashSet::new();
    let mut names = std::collections::HashSet::new();
    for ch in &doc.characters {
        if ch.id.trim().is_empty() || ch.id.len() > 80 ||
           ch.name.trim().is_empty() || ch.name.chars().count() > 120 ||
           ch.description.chars().count() > 1000 ||
           !ids.insert(ch.id.as_str()) || !names.insert(ch.name.to_lowercase()) {
            return Err("Character names or IDs are invalid or duplicated.".into());
        }
        let voice = &ch.voice;
        if voice.engine_id != "chatterbox-multilingual" || voice.language != "hi" ||
           voice.profile_version != 1 || voice.speaker_conditioning.is_some() ||
           voice.model_id.is_empty() || voice.model_id.len() > 160 ||
           !(0.25..=2.0).contains(&voice.exaggeration) || !voice.exaggeration.is_finite() ||
           !(0.0..=1.0).contains(&voice.cfg_weight) || !voice.cfg_weight.is_finite() ||
           voice.pause_ms > 2000 {
            return Err("Character voice contains unsupported engine settings.".into());
        }
    }
    if !ids.contains("narrator") {
        return Err("Every story requires a narrator.".into());
    }
    let mut seen_scenes = std::collections::HashSet::new();
    let mut seen_segments = std::collections::HashSet::new();
    for scene in &doc.scenes {
        if scene.id.is_empty() || !seen_scenes.insert(&scene.id) ||
           scene.title.trim().is_empty() || scene.title.chars().count() > 120 ||
           scene.notes.chars().count() > 4000 || scene.segments.len() > 2000 {
            return Err("Scene metadata is invalid.".into());
        }
        for seg in &scene.segments {
            if seg.id.is_empty() || !seen_segments.insert(&seg.id) ||
               seg.original_text.chars().count() > 100_000 ||
               seg.spoken_text.chars().count() > 100_000 ||
               (seg.kind != "speech" && seg.kind != "direction") ||
               (seg.kind == "speech" && seg.spoken_text.trim().is_empty()) ||
               (seg.kind == "speech" && seg.speaker_id.is_none() && seg.source_label.is_none()) ||
               seg.speaker_id.as_ref().is_some_and(|id| !ids.contains(id.as_str())) ||
               seg.audio_ref.as_ref().is_some_and(|id| Uuid::parse_str(id).is_err()) ||
               seg.duration_seconds.is_some_and(|seconds| !seconds.is_finite() || seconds < 0.0) {
                return Err("A dialogue segment is invalid or refers to an unknown character.".into());
            }
        }
    }
    Ok(())
}

fn v2_project_path(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    Uuid::parse_str(id).map_err(|_| "Invalid v2 story identifier.")?;
    let folder = app_dir(app)?.join("projects-v2");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    Ok(folder.join(format!("{id}.json")))
}

#[tauri::command]
fn save_story_v2(app: tauri::AppHandle, project: StoryV2) -> Result<StoryV2, String> {
    validate_story_v2(&project)?;
    let bytes = serde_json::to_vec_pretty(&project).map_err(|e| e.to_string())?;
    if bytes.len() > 1_500_000 { return Err("Story project is too large.".into()); }
    let path = v2_project_path(&app, &project.id)?;
    AtomicFile::new(path, OverwriteBehavior::AllowOverwrite)
        .write(|output| output.write_all(&bytes))
        .map_err(|e| format!("Failed to atomically save story: {e}"))?;
    Ok(project)
}

#[tauri::command]
fn load_story_v2(app: tauri::AppHandle, id: String) -> Result<StoryV2, String> {
    let path = v2_project_path(&app, &id)?;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    if bytes.len() > 1_500_000 { return Err("Story exceeds the project limit.".into()); }
    let story: StoryV2 = serde_json::from_slice(&bytes)
        .map_err(|_| "Story v2 file is corrupt or incompatible.".to_string())?;
    validate_story_v2(&story)?;
    if story.id != id { return Err("Story ID mismatch.".into()); }
    Ok(story)
}

#[tauri::command]
async fn parse_dialogue(
    title: String,
    text: String,
    characters: Vec<Value>,
    script_id: Option<String>,
) -> Result<Value, String> {
    if title.trim().is_empty() || title.chars().count() > 120 ||
       text.chars().count() > 100_000 || characters.len() > 99 {
        return Err("Title, characters or story size exceeds limits.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let response = invoke_python(json!({
            "action": "parse_dialogue",
            "title": title, "text": text,
            "characters": characters, "script_id": script_id,
        }))?;
        let doc = response.get("result").ok_or("Dialogue parser returned no story.")?;
        let parsed: StoryV2 = serde_json::from_value(doc.clone())
            .map_err(|_| "Dialogue parser returned an incompatible story.".to_string())?;
        validate_story_v2(&parsed)?;
        Ok(response)
    }).await.map_err(|e| e.to_string())?
}

#[derive(Debug, Serialize)]
struct AudioResult {
    audio_id: String,
    data_url: String,
    duration_seconds: f64,
    sample_rate: u32,
    chunks: u32,
}

fn app_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

fn project_file(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    Uuid::parse_str(id).map_err(|_| "Invalid project ID.")?;
    let dir = app_dir(app)?.join("projects");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{id}.json")))
}

fn validate_project(project: &StoryProject) -> Result<(), String> {
    if project.title.trim().is_empty() || project.title.chars().count() > 120 {
        return Err("Project title must contain 1–120 characters.".into());
    }
    if project.text.chars().count() > 100_000 {
        return Err("Project text is too long; split it into separate stories.".into());
    }
    Ok(())
}

#[tauri::command]
fn save_project(app: tauri::AppHandle, mut project: StoryProject) -> Result<StoryProject, String> {
    validate_project(&project)?;
    if project.id.is_empty() {
        project.id = Uuid::new_v4().to_string();
    }
    let path = project_file(&app, &project.id)?;
    let content = serde_json::to_vec_pretty(&project).map_err(|e| e.to_string())?;
    AtomicFile::new(path, OverwriteBehavior::AllowOverwrite)
        .write(|file| file.write_all(&content))
        .map_err(|e| format!("Unable to save project: {e}"))?;
    Ok(project)
}

#[tauri::command]
fn load_project(app: tauri::AppHandle, id: String) -> Result<StoryProject, String> {
    let content = fs::read(project_file(&app, &id)?).map_err(|e| e.to_string())?;
    let project: StoryProject = serde_json::from_slice(&content)
        .map_err(|_| "Project file is corrupt or incompatible.".to_string())?;
    validate_project(&project)?;
    if project.id != id {
        return Err("Project identifier mismatch.".into());
    }
    Ok(project)
}

#[tauri::command]
fn list_projects(app: tauri::AppHandle) -> Result<Vec<StoryProject>, String> {
    let dir = app_dir(&app)?.join("projects");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        if let Some(id) = entry.path().file_stem().and_then(|stem| stem.to_str()) {
            if let Ok(project) = load_project(app.clone(), id.to_owned()) {
                items.push(project);
            }
        }
    }
    items.sort_by_key(|a| a.title.to_lowercase());
    Ok(items)
}

fn python_executable() -> String {
    std::env::var("KATHASVARA_PYTHON")
        .unwrap_or_else(|_| if cfg!(windows) { "python" } else { "python3" }.to_string())
}

fn inference_directory() -> PathBuf {
    std::env::var_os("KATHASVARA_INFERENCE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../services/inference"))
}

fn invoke_python(request: Value) -> Result<Value, String> {
    let directory = inference_directory();
    if !directory.join("kathasvara").is_dir() {
        return Err("Inference sources are missing. Set KATHASVARA_INFERENCE_DIR.".into());
    }
    let mut child = Command::new(python_executable())
        .args(["-m", "kathasvara.cli"])
        .current_dir(directory.clone())
        .env("PYTHONPATH", directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Python 3.11 runtime not found. Configure KATHASVARA_PYTHON.".to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(request.to_string().as_bytes())
            .map_err(|_| "Unable to send synthesis request.".to_string())?;
    }
    let max_wait = if matches!(request.get("action").and_then(Value::as_str), Some("synthesize" | "render_story")) {
        Duration::from_secs(600)
    } else {
        Duration::from_secs(15)
    };
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {}
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Unable to monitor the local inference process.".into());
            }
        }
        if started.elapsed() >= max_wait {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Local inference timed out. Check model installation or hardware.".into());
        }
        thread::sleep(Duration::from_millis(100));
    }
    let response = child.wait_with_output().map_err(|e| e.to_string())?;
    if response.stdout.len() > 1_048_576 {
        return Err("Inference response exceeds the maximum allowed size.".into());
    }
    // Upstream model libraries may print progress to stdout. The final JSON
    // response is a complete line, not necessarily the entire output stream.
    let data: Value = response
        .stdout
        .split(|byte| *byte == b'\n')
        .filter_map(|line| serde_json::from_slice::<Value>(line).ok())
        .next_back()
        .ok_or_else(|| "Inference service did not return valid JSON.".to_string())?;
    if !response.status.success() || data.get("ok") != Some(&Value::Bool(true)) {
        return Err(
            data.get("message").and_then(Value::as_str)
                .unwrap_or("Local synthesis failed.")
                .to_string()
        );
    }
    Ok(data)
}

#[tauri::command]
async fn inspect_script(text: String) -> Result<TextInspection, String> {
    if text.trim().is_empty() || text.chars().count() > MAX_TEXT_LENGTH {
        return Err("Enter between 1 and 3000 characters of story text.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let response = invoke_python(json!({"action": "inspect", "text": text}))?;
        serde_json::from_value(
            response.get("result").cloned().ok_or("Missing inspection data.")?
        ).map_err(|_| "Malformed Hindi inspection response.".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn diagnose_engine() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let response = invoke_python(json!({"action": "diagnose"}))?;
        response
            .get("result")
            .cloned()
            .ok_or_else(|| "The Python diagnostic response is incomplete.".to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn check_engine() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| invoke_python(json!({"action":"health"})))
        .await.map_err(|e| e.to_string())??;
    Ok("Python bridge available. Model weights have not been verified.".into())
}

fn inspect_wav(data: &[u8]) -> Result<(), String> {
    const INVALID: &str = "Generated audio is not valid mono 16-bit PCM WAV.";
    if data.len() < 44 || &data[..4] != b"RIFF" || &data[8..12] != b"WAVE" {
        return Err(INVALID.into());
    }
    let riff_size = u32::from_le_bytes(data[4..8].try_into().map_err(|_| INVALID)?) as usize;
    if riff_size.checked_add(8) != Some(data.len()) {
        return Err("WAV RIFF length does not match its file size.".into());
    }
    let mut index = 12usize;
    let mut found_format = false;
    let mut found_samples = false;
    while index + 8 <= data.len() {
        let marker = &data[index..index + 4];
        let size = u32::from_le_bytes(
            data[index + 4..index + 8].try_into().map_err(|_| INVALID)?
        ) as usize;
        let next = index.checked_add(8)
            .and_then(|value| value.checked_add(size))
            .and_then(|value| value.checked_add(size % 2))
            .ok_or(INVALID)?;
        if next > data.len() {
            return Err("WAV chunk extends beyond its file size.".into());
        }
        if marker == b"fmt " {
            if size < 16 {
                return Err(INVALID.into());
            }
            let fmt = &data[index + 8..index + 24];
            let codec = u16::from_le_bytes([fmt[0], fmt[1]]);
            let channels = u16::from_le_bytes([fmt[2], fmt[3]]);
            let sample_rate = u32::from_le_bytes(fmt[4..8].try_into().map_err(|_| INVALID)?);
            let block_align = u16::from_le_bytes([fmt[12], fmt[13]]);
            let bits_per_sample = u16::from_le_bytes([fmt[14], fmt[15]]);
            if codec != 1 || channels != 1 || !(8_000..=192_000).contains(&sample_rate)
                || block_align != 2 || bits_per_sample != 16
            {
                return Err(INVALID.into());
            }
            found_format = true;
        }
        if marker == b"data" && size >= 2 && size.is_multiple_of(2) {
            found_samples = true;
        }
        index = next;
    }
    if index != data.len() || !found_format || !found_samples {
        return Err(INVALID.into());
    }
    Ok(())
}

#[tauri::command]
async fn synthesize(
    app: tauri::AppHandle,
    text: String,
    exaggeration: f32,
    cfg_weight: f32,
) -> Result<AudioResult, String> {
    if text.trim().is_empty() || text.chars().count() > MAX_TEXT_LENGTH {
        return Err("Enter between 1 and 3000 characters of story text.".into());
    }
    if !exaggeration.is_finite() || !(0.25..=2.0).contains(&exaggeration)
        || !cfg_weight.is_finite() || !(0.0..=1.0).contains(&cfg_weight)
    {
        return Err("Voice settings are outside supported limits.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let audio_id = Uuid::new_v4().to_string();
        let folder = app_dir(&app)?.join("audio");
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let path = folder.join(format!("{audio_id}.wav"));
        let data = match invoke_python(json!({
            "action":"synthesize",
            "text":text,
            "output":path,
            "exaggeration":exaggeration,
            "cfg_weight":cfg_weight
        })) {
            Ok(response) => response,
            Err(error) => {
                // A terminated or timed-out Python worker cannot execute its
                // own temporary-file cleanup. Remove only this UUID's files.
                let _ = fs::remove_file(&path);
                let _ = fs::remove_file(folder.join(format!("{audio_id}.partial.wav")));
                return Err(error);
            }
        };
        let size = fs::metadata(&path).map_err(|_| "Audio file was not created.".to_string())?.len();
        if size > MAX_GENERATED_WAV {
            let _ = fs::remove_file(&path);
            return Err("Generated audio exceeds the preview limit.".into());
        }
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        inspect_wav(&bytes)?;
        let result = data.get("result").ok_or("Missing synthesis metadata.")?;
        Ok(AudioResult {
            audio_id,
            data_url: format!("data:audio/wav;base64,{}", STANDARD.encode(bytes)),
            duration_seconds: result["duration_seconds"].as_f64().unwrap_or(0.0),
            sample_rate: result["sample_rate"].as_u64().unwrap_or(0) as u32,
            chunks: result["chunks"].as_u64().unwrap_or(0) as u32,
        })
    }).await.map_err(|e| e.to_string())?
}

#[derive(Debug, Serialize)]
struct RenderProgress {
    done: u32,
    total: u32,
}

#[tauri::command]
fn story_render_progress(app: tauri::AppHandle, job_id: String) -> Result<RenderProgress, String> {
    Uuid::parse_str(&job_id).map_err(|_| "Invalid job identifier.")?;
    let path = app_dir(&app)?.join("jobs").join(format!("{job_id}.progress.json"));
    match fs::read(&path) {
        Ok(bytes) => {
            if bytes.len() > 1024 { return Err("Invalid render progress.".into()); }
            let data: Value = serde_json::from_slice(&bytes)
                .map_err(|_| "Render progress is unreadable.".to_string())?;
            let done = data["done"].as_u64().ok_or("Missing completed counter.")?;
            let total = data["total"].as_u64().ok_or("Missing total counter.")?;
            if total > 256 || done > total { return Err("Render counters are invalid.".into()); }
            Ok(RenderProgress { done: done as u32, total: total as u32 })
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound =>
            Ok(RenderProgress { done: 0, total: 0 }),
        Err(error) => Err(format!("Progress unavailable: {error}")),
    }
}

#[tauri::command]
fn cancel_story_render(app: tauri::AppHandle, job_id: String) -> Result<(), String> {
    Uuid::parse_str(&job_id).map_err(|_| "Invalid job identifier.")?;
    let folder = app_dir(&app)?.join("jobs");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let path = folder.join(format!("{job_id}.cancel"));
    fs::write(path, b"cancel").map_err(|e| e.to_string())
}

#[tauri::command]
async fn render_story_v2(
    app: tauri::AppHandle,
    project: StoryV2,
    job_id: String,
    selected_scene_ids: Option<Vec<String>>,
    force_segment_ids: Option<Vec<String>>,
) -> Result<AudioResult, String> {
    validate_story_v2(&project)?;
    Uuid::parse_str(&job_id).map_err(|_| "Invalid render job ID.")?;
    if selected_scene_ids.as_ref().is_some_and(|items| items.len() > 200) ||
       force_segment_ids.as_ref().is_some_and(|items| items.len() > 256) {
        return Err("Too many selected scenes or dialogue lines.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_dir(&app)?;
        let folder = root.join("audio");
        let jobs = root.join("jobs");
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        fs::create_dir_all(&jobs).map_err(|e| e.to_string())?;
        let output = folder.join(format!("{job_id}.wav"));
        if output.exists() {
            return Err("This audio job identifier has already been used.".into());
        }
        let cancel_path = jobs.join(format!("{job_id}.cancel"));
        let progress_path = jobs.join(format!("{job_id}.progress.json"));
        // A new UUID is supplied for each request by the UI; old sentinel is
        // never interpreted as a fresh cancellation.
        let _ = fs::remove_file(&cancel_path);
        let _ = fs::remove_file(&progress_path);
        let response = invoke_python(json!({
            "action": "render_story",
            "project": project,
            "output": output,
            "cache": root.join("segment-cache"),
            "cancel_file": cancel_path,
            "progress_file": progress_path,
            "selected_scene_ids": selected_scene_ids,
            "force_segment_ids": force_segment_ids,
        }));
        let _ = fs::remove_file(&cancel_path);
        let _ = fs::remove_file(&progress_path);
        let data = match response {
            Ok(data) => data,
            Err(message) => {
                let _ = fs::remove_file(&output);
                return Err(message);
            }
        };
        let size = fs::metadata(&output)
            .map_err(|_| "The batch renderer did not produce a WAV.".to_string())?.len();
        if size > MAX_GENERATED_WAV {
            let _ = fs::remove_file(&output);
            return Err("Rendered WAV exceeds the current 25 MB desktop preview limit.".into());
        }
        let bytes = fs::read(&output).map_err(|e| e.to_string())?;
        if let Err(reason) = inspect_wav(&bytes) {
            let _ = fs::remove_file(&output);
            return Err(reason);
        }
        let metadata = data.get("result").ok_or("Missing render metadata.")?;
        Ok(AudioResult {
            audio_id: job_id,
            data_url: format!("data:audio/wav;base64,{}", STANDARD.encode(bytes)),
            duration_seconds: metadata["duration_seconds"].as_f64().unwrap_or(0.0),
            sample_rate: metadata["sample_rate"].as_u64().unwrap_or(0) as u32,
            chunks: metadata["chunks"].as_u64().unwrap_or(0) as u32,
        })
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn discard_audio(app: tauri::AppHandle, audio_id: String) -> Result<(), String> {
    Uuid::parse_str(&audio_id).map_err(|_| "Invalid audio ID.")?;
    let path = app_dir(&app)?.join("audio").join(format!("{audio_id}.wav"));
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Unable to delete local audio preview: {error}")),
    }
}

#[tauri::command]
fn export_wav(app: tauri::AppHandle, audio_id: String, destination: String) -> Result<(), String> {
    Uuid::parse_str(&audio_id).map_err(|_| "Invalid audio ID.")?;
    let source = app_dir(&app)?.join("audio").join(format!("{audio_id}.wav"));
    let destination = Path::new(&destination);
    if !destination.is_absolute() || destination.extension().and_then(|e| e.to_str()) != Some("wav") {
        return Err("Choose an absolute .wav output path.".into());
    }
    let mut source = fs::File::open(source).map_err(|_| "Generated audio is missing.".to_string())?;
    if source.metadata().map_err(|e| e.to_string())?.len() > MAX_GENERATED_WAV {
        return Err("Audio exceeds the export limit.".into());
    }
    let mut bytes = Vec::new();
    source.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    inspect_wav(&bytes)?;
    let mut out = fs::OpenOptions::new().write(true).create_new(true)
        .open(destination).map_err(|e| format!("Cannot create destination file: {e}"))?;
    out.write_all(&bytes).map_err(|e| e.to_string())?;
    out.sync_all().map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_project, load_project, list_projects, save_story_v2, load_story_v2, parse_dialogue, inspect_script, check_engine, diagnose_engine, synthesize, render_story_v2, story_render_progress, cancel_story_render, discard_audio, export_wav
        ])
        .run(tauri::generate_context!())
        .expect("KathaSvara failed to start");
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample_v2() -> StoryV2 {
        StoryV2 {
            schema_version: 2,
            id: Uuid::new_v4().to_string(),
            title: "राजा भोज".to_string(),
            text: "Narrator: नमस्कार।".to_string(),
            characters: vec![CharacterV2 {
                id: "narrator".to_string(),
                name: "Narrator".to_string(),
                description: String::new(),
                voice: VoiceProfileV2 {
                    engine_id: "chatterbox-multilingual".to_string(),
                    model_id: "chatterbox-multilingual".to_string(),
                    language: "hi".to_string(),
                    exaggeration: 0.5,
                    cfg_weight: 0.5,
                    pause_ms: 140,
                    profile_version: 1,
                    speaker_conditioning: None,
                },
            }],
            scenes: vec![SceneV2 {
                id: Uuid::new_v4().to_string(),
                title: "दरबार".to_string(),
                notes: String::new(),
                segments: vec![SegmentV2 {
                    id: Uuid::new_v4().to_string(),
                    original_text: "नमस्कार।".to_string(),
                    spoken_text: "नमस्कार।".to_string(),
                    speaker_id: Some("narrator".to_string()),
                    kind: "speech".to_string(),
                    status: "pending".to_string(),
                    audio_ref: None,
                    duration_seconds: None,
                    source_label: None,
                }],
            }],
        }
    }

    #[test]
    fn v2_scene_json_roundtrip_is_lossless() {
        let story = sample_v2();
        assert!(validate_story_v2(&story).is_ok());
        let json = serde_json::to_vec(&story).expect("serializable v2 document");
        let recovered: StoryV2 = serde_json::from_slice(&json).expect("readable v2 document");
        assert!(validate_story_v2(&recovered).is_ok());
        assert_eq!(story.text, recovered.text);
        assert_eq!(story.scenes[0].segments[0].id, recovered.scenes[0].segments[0].id);
    }

    #[test]
    fn v2_rejects_unknown_speakers_and_unsupported_voice_conditioning() {
        let mut story = sample_v2();
        story.scenes[0].segments[0].speaker_id = Some("stranger".to_string());
        assert!(validate_story_v2(&story).is_err());
        story.scenes[0].segments[0].speaker_id = Some("narrator".to_string());
        story.characters[0].voice.speaker_conditioning = Some("unverified".to_string());
        assert!(validate_story_v2(&story).is_err());
    }

    #[test]
    fn v2_rejects_nonfinite_voice_controls_and_duplicate_ids() {
        let mut story = sample_v2();
        story.characters[0].voice.exaggeration = f32::NAN;
        assert!(validate_story_v2(&story).is_err());
        story.characters[0].voice.exaggeration = 0.5;
        story.characters.push(story.characters[0].clone());
        assert!(validate_story_v2(&story).is_err());
    }

    #[test]
    fn project_validates_title() {
        let project = StoryProject { id: String::new(), title: String::new(), text: String::new() };
        assert!(validate_project(&project).is_err());
    }
    #[test]
    fn riff_validation_rejects_invalid_bytes() {
        assert!(inspect_wav(&[0u8; 50]).is_err());
        assert!(inspect_wav(b"RIFF").is_err());
    }

    fn minimal_pcm_wav() -> Vec<u8> {
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&38u32.to_le_bytes());
        wav.extend_from_slice(b"WAVE");
        wav.extend_from_slice(b"fmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&24_000u32.to_le_bytes());
        wav.extend_from_slice(&48_000u32.to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&2u32.to_le_bytes());
        wav.extend_from_slice(&[0u8, 0u8]);
        wav
    }

    #[test]
    fn wav_validation_accepts_mono_pcm16() {
        assert!(inspect_wav(&minimal_pcm_wav()).is_ok());
    }

    #[test]
    fn wav_validation_rejects_corrupt_chunk_length() {
        let mut wav = minimal_pcm_wav();
        wav[40..44].copy_from_slice(&100u32.to_le_bytes());
        assert!(inspect_wav(&wav).is_err());
    }

    #[test]
    fn wav_validation_rejects_bad_channel_count() {
        let mut wav = minimal_pcm_wav();
        wav[22..24].copy_from_slice(&2u16.to_le_bytes());
        assert!(inspect_wav(&wav).is_err());
    }
}
