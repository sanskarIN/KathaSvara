// SPDX-License-Identifier: MPL-2.0
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use atomicwrites::{AtomicFile, OverwriteBehavior};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;
use uuid::Uuid;

mod wav_file;
mod production_manifest;
use production_manifest::write_production_manifest;
use wav_file::{inspect_wav_file, wav_source_metadata_unchanged};

const MAX_GENERATED_WAV: u64 = 25 * 1024 * 1024;
const MAX_TEXT_LENGTH: usize = 3000;

const CACHE_PRUNE_SENTINEL: &str = ":segment-cache-maintenance:";
static ACTIVE_RENDER_JOBS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn active_render_jobs() -> &'static Mutex<HashSet<String>> {
    ACTIVE_RENDER_JOBS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn is_render_job_active(job_id: &str) -> Result<bool, String> {
    let active = active_render_jobs().lock()
        .map_err(|_| "Render job registry is unavailable.".to_string())?;
    Ok(active.contains(job_id))
}

struct ActiveRenderGuard {
    job_id: String,
}

impl ActiveRenderGuard {
    fn start(job_id: &str) -> Result<Self, String> {
        Uuid::parse_str(job_id).map_err(|_| "Invalid render job ID.".to_string())?;
        let mut active = active_render_jobs().lock()
            .map_err(|_| "Render job registry is unavailable.".to_string())?;
        if active.contains(CACHE_PRUNE_SENTINEL) {
            return Err("Wait for local cache cleanup to finish before rendering.".into());
        }
        if !active.insert(job_id.to_owned()) {
            return Err("Render job is already active.".into());
        }
        Ok(Self { job_id: job_id.to_owned() })
    }
}

impl Drop for ActiveRenderGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = active_render_jobs().lock() {
            active.remove(&self.job_id);
        }
    }
}

struct CachePruneGuard;

impl CachePruneGuard {
    fn start() -> Result<Self, String> {
        let mut jobs = active_render_jobs().lock()
            .map_err(|_| "Render job registry is unavailable.".to_string())?;
        if !jobs.is_empty() {
            return Err("Cannot prune the segment cache during active rendering.".into());
        }
        jobs.insert(CACHE_PRUNE_SENTINEL.to_string());
        Ok(Self)
    }
}

impl Drop for CachePruneGuard {
    fn drop(&mut self) {
        if let Ok(mut jobs) = active_render_jobs().lock() {
            jobs.remove(CACHE_PRUNE_SENTINEL);
        }
    }
}

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
struct PronunciationRuleV2 {
    id: String,
    original: String,
    spoken: String,
    enabled: bool,
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
    #[serde(default)]
    pronunciation_glossary: Vec<PronunciationRuleV2>,
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
    if doc.pronunciation_glossary.len() > 100 {
        return Err("Pronunciation glossary exceeds 100 rules.".into());
    }
    let mut rule_ids = std::collections::HashSet::new();
    let mut rule_originals = std::collections::HashSet::new();
    for rule in &doc.pronunciation_glossary {
        if rule.id.is_empty() || rule.id.chars().count() > 80 ||
            rule.id.chars().any(char::is_control) ||
            rule.original.trim().is_empty() || rule.original.chars().count() > 80 ||
            rule.spoken.trim().is_empty() || rule.spoken.chars().count() > 160 ||
            rule.original.chars().any(char::is_control) ||
            rule.spoken.chars().any(char::is_control) ||
            rule.original.trim() == rule.spoken.trim() ||
            !rule_ids.insert(rule.id.as_str()) ||
            !rule_originals.insert(rule.original.trim().to_lowercase()) {
            return Err("Pronunciation rule is malformed or duplicated.".into());
        }
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

#[tauri::command]
async fn audit_production(project: StoryV2) -> Result<Value, String> {
    validate_story_v2(&project)?;
    tauri::async_runtime::spawn_blocking(move || {
        let response = invoke_python(json!({
            "action": "audit_production",
            "project": project,
        }))?;
        response.get("result").cloned()
            .ok_or_else(|| "Production audit returned no report.".to_string())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn preflight_render(
    project: StoryV2,
    selected_scene_ids: Option<Vec<String>>,
    selected_segment_ids: Option<Vec<String>>,
    force_segment_ids: Option<Vec<String>>,
) -> Result<Value, String> {
    validate_story_v2(&project)?;
    if selected_scene_ids.as_ref().is_some_and(|ids| ids.len() > 200) ||
       selected_segment_ids.as_ref().is_some_and(|ids| ids.len() > 256) ||
       force_segment_ids.as_ref().is_some_and(|ids| ids.len() > 256) {
        return Err("Too many selected scenes or dialogue lines.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let response = invoke_python(json!({
            "action": "preflight_render",
            "project": project,
            "selected_scene_ids": selected_scene_ids,
            "selected_segment_ids": selected_segment_ids,
            "force_segment_ids": force_segment_ids,
        }))?;
        response.get("result").cloned()
            .ok_or_else(|| "Preflight returned no report.".to_string())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn preview_pronunciation(project: StoryV2, segment_id: String) -> Result<Value, String> {
    validate_story_v2(&project)?;
    if !project.scenes.iter().any(|scene| scene.segments.iter().any(|seg|
        seg.id == segment_id && seg.kind == "speech")) {
        return Err("Spoken segment is not in this document.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let response = invoke_python(json!({
            "action": "preview_pronunciation",
            "project": project,
            "segment_id": segment_id,
        }))?;
        response.get("result").cloned()
            .ok_or_else(|| "Pronunciation preview response is incomplete.".to_string())
    }).await.map_err(|e| e.to_string())?
}

#[derive(Debug, Serialize, Deserialize)]
struct SegmentTiming {
    segment_id: String,
    start_seconds: f64,
    end_seconds: f64,
    // Only returned to the current UI; never stored in a recovery journal.
    effective_text: String,
}

fn parse_segment_timings(metadata: &Value) -> Result<Vec<SegmentTiming>, String> {
    let times = metadata["segments"].as_array().ok_or("Missing rendered segment timings.")?;
    if times.is_empty() || times.len() > 256 {
        return Err("Invalid number of generated subtitle cues.".into());
    }
    let mut result = Vec::with_capacity(times.len());
    let mut previous_end = 0.0;
    let mut text_chars = 0_usize;
    for value in times {
        let timing: SegmentTiming = serde_json::from_value(value.clone())
            .map_err(|_| "Malformed measured subtitle cue.".to_string())?;
        text_chars += timing.effective_text.chars().count();
        if timing.segment_id.is_empty() || timing.segment_id.len() > 80 ||
            timing.effective_text.trim().is_empty() || text_chars > 100_000 ||
            timing.effective_text.chars().any(|ch| ch == '\0') ||
            !timing.start_seconds.is_finite() || !timing.end_seconds.is_finite() ||
            timing.start_seconds + 0.002 < previous_end ||
            timing.start_seconds < 0.0 || timing.end_seconds <= timing.start_seconds ||
            timing.end_seconds > 1200.1 {
            return Err("Invalid generated segment timeline.".into());
        }
        previous_end = timing.end_seconds;
        result.push(timing);
    }
    Ok(result)
}

#[derive(Debug, Serialize)]
struct AudioResult {
    audio_id: String,
    data_url: String,
    duration_seconds: f64,
    sample_rate: u32,
    chunks: u32,
    segment_timings: Vec<SegmentTiming>,
    preview_available: bool,
    file_bytes: u64,
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

fn inference_directory() -> Result<PathBuf, String> {
    if let Some(configured) = std::env::var_os("KATHASVARA_INFERENCE_DIR") {
        let path = PathBuf::from(configured);
        if !path.is_absolute() {
            return Err("KATHASVARA_INFERENCE_DIR must be an absolute directory.".into());
        }
        return Ok(path);
    }
    // Discover source checkout at runtime; never embed the Windows CI checkout path.
    let cwd = std::env::current_dir()
        .map_err(|_| "Unable to inspect current directory; configure KATHASVARA_INFERENCE_DIR.")?;
    for ancestor in cwd.ancestors() {
        let candidate = ancestor.join("services/inference");
        if candidate.join("kathasvara/cli.py").is_file() {
            return Ok(candidate);
        }
    }
    Err("Inference sources are not configured. Set KATHASVARA_INFERENCE_DIR to their absolute directory.".into())
}

const MAX_PYTHON_RESPONSE: usize = 1_048_576;

fn read_bounded_response(mut source: impl Read) -> Result<Vec<u8>, String> {
    let mut response = Vec::new();
    let mut chunk = [0_u8; 8192];
    let mut exceeded_limit = false;
    loop {
        let size = source.read(&mut chunk)
            .map_err(|_| "Cannot read the local inference response.".to_string())?;
        if size == 0 {
            return if exceeded_limit {
                Err("Inference response exceeds the maximum allowed size.".into())
            } else {
                Ok(response)
            };
        }
        // Keep draining stdout after overflow. Stopping the read early can
        // block the child on a full pipe while the parent waits for its exit.
        if response.len().saturating_add(size) > MAX_PYTHON_RESPONSE {
            exceeded_limit = true;
        } else if !exceeded_limit {
            response.extend_from_slice(&chunk[..size]);
        }
    }
}

fn invoke_python(request: Value) -> Result<Value, String> {
    let directory = inference_directory()?;
    if !directory.join("kathasvara/cli.py").is_file() {
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
    // Drain child stdout concurrently to avoid a full pipe deadlocking JSON IPC.
    let stdout = child.stdout.take()
        .ok_or_else(|| "Python stdout was not connected.".to_string())?;
    let output_reader = thread::spawn(move || read_bounded_response(stdout));
    let max_wait = match request.get("action").and_then(Value::as_str) {
        Some("synthesize" | "render_story") => Duration::from_secs(600),
        // PCM inspection scans the entire allowed WAV twice without model weights.
        Some("inspect_generated_wav") => Duration::from_secs(180),
        _ => Duration::from_secs(15),
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
    let status = child.wait().map_err(|_| "Cannot collect inference process status.".to_string())?;
    let response = output_reader.join()
        .map_err(|_| "Inference output reader terminated unexpectedly.".to_string())??;
    // Upstream model libraries may print progress to stdout. The final JSON
    // response is a complete line, not necessarily the entire output stream.
    let data: Value = response
        .split(|byte| *byte == b'\n')
        .filter_map(|line| serde_json::from_slice::<Value>(line).ok())
        .next_back()
        .ok_or_else(|| "Inference service did not return valid JSON.".to_string())?;
    if !status.success() || data.get("ok") != Some(&Value::Bool(true)) {
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

fn cache_budget_bytes(max_mib: u32) -> Result<u64, String> {
    if !(16..=2_048).contains(&max_mib) {
        return Err("Cache budget must be between 16 and 2048 MiB.".into());
    }
    Ok(u64::from(max_mib) * 1024 * 1024)
}

#[tauri::command]
async fn inspect_segment_cache(app: tauri::AppHandle) -> Result<Value, String> {
    let cache = app_dir(&app)?.join("segment-cache");
    tauri::async_runtime::spawn_blocking(move || {
        let response = invoke_python(json!({"action": "cache_stats", "cache": cache}))?;
        response.get("result").cloned()
            .ok_or_else(|| "Cache inspection returned no report.".to_string())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn prune_segment_cache(
    app: tauri::AppHandle,
    max_mib: u32,
    dry_run: bool,
) -> Result<Value, String> {
    let budget = cache_budget_bytes(max_mib)?;
    let cache = app_dir(&app)?.join("segment-cache");
    let guard = CachePruneGuard::start()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _cache_guard = guard;
        let response = invoke_python(json!({
            "action": "cache_prune", "cache": cache,
            "max_bytes": budget, "dry_run": dry_run,
        }))?;
        response.get("result").cloned()
            .ok_or_else(|| "Cache maintenance returned no report.".to_string())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn maintain_abandoned_wavs(
    app: tauri::AppHandle,
    dry_run: bool,
) -> Result<Value, String> {
    // Reuse the same in-app mutex as cache pruning, in addition to the
    // OS-level Python cache lock shared by participating renderer processes.
    let guard = CachePruneGuard::start()?;
    let root = app_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let result = invoke_python(json!({
            "action": "abandoned_wav_cleanup",
            "root": root,
            "dry_run": dry_run,
        }))?;
        result.get("result").cloned()
            .ok_or_else(|| "Abandoned audio cleanup returned no report.".to_string())
    }).await.map_err(|error| error.to_string())?
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
    let mut sample_rate_hz = None;
    let mut data_frames = None;
    let mut chunks = 0_u32;
    while index + 8 <= data.len() {
        chunks += 1;
        if chunks > 4096 {
            return Err("Generated WAV has too many metadata chunks.".into());
        }
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
            if sample_rate_hz.is_some() || size < 16 {
                return Err(INVALID.into());
            }
            let fmt = &data[index + 8..index + 24];
            let codec = u16::from_le_bytes([fmt[0], fmt[1]]);
            let channels = u16::from_le_bytes([fmt[2], fmt[3]]);
            let sample_rate = u32::from_le_bytes(fmt[4..8].try_into().map_err(|_| INVALID)?);
            let byte_rate = u32::from_le_bytes(fmt[8..12].try_into().map_err(|_| INVALID)?);
            let block_align = u16::from_le_bytes([fmt[12], fmt[13]]);
            let bits_per_sample = u16::from_le_bytes([fmt[14], fmt[15]]);
            if codec != 1 || channels != 1 || !(8_000..=192_000).contains(&sample_rate)
                || byte_rate != sample_rate * 2 || block_align != 2 || bits_per_sample != 16
            {
                return Err(INVALID.into());
            }
            sample_rate_hz = Some(sample_rate);
        }
        if marker == b"data" {
            if data_frames.is_some() || size < 2 || !size.is_multiple_of(2) {
                return Err(INVALID.into());
            }
            data_frames = Some(size / 2);
        }
        index = next;
    }
    if index != data.len() {
        return Err(INVALID.into());
    }
    let rate = sample_rate_hz.ok_or(INVALID)?;
    let frames = data_frames.ok_or(INVALID)?;
    if frames as u64 > u64::from(rate) * 1200 {
        return Err("Generated WAV exceeds the 20-minute narration limit.".into());
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
            segment_timings: Vec::new(),
            preview_available: true,
            file_bytes: size,
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

#[derive(Debug, Serialize)]
struct RenderHistoryEntry {
    job_id: String,
    story_id: String,
    state: String,
    done: u32,
    total: u32,
    updated_at: String,
}

// Keep the history reader independent of Tauri to test filtering and
// interrupt classification on a temporary folder without model weights.
fn read_render_history(
    folder: &Path,
    story_filter: Option<&str>,
) -> Result<Vec<RenderHistoryEntry>, String> {
    if story_filter.is_some_and(|id| id.is_empty() || id.len() > 80) {
        return Err("Invalid story history filter.".into());
    }
    if !folder.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for result in fs::read_dir(folder).map_err(|e| e.to_string())? {
        let entry = result.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(id) = name.strip_suffix(".manifest.json") else { continue; };
        if Uuid::parse_str(id).is_err() { continue; }
        let metadata = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
        if !metadata.file_type().is_file() || metadata.len() > 65_536 { continue; }
        let updated = metadata.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        entries.push((updated, id.to_owned(), entry.path()));
    }
    entries.sort_by_key(|item| std::cmp::Reverse(item.0));
    let mut reports = Vec::new();
    for (_, job_id, path) in entries {
        let Ok(bytes) = fs::read(path) else { continue; };
        let Ok(data) = serde_json::from_slice::<Value>(&bytes) else { continue; };
        let (Some(story_id), Some(state), Some(done), Some(total), Some(updated_at)) = (
            data["story_id"].as_str(), data["state"].as_str(),
            data["done"].as_u64(), data["total"].as_u64(),
            data["updated_at"].as_str(),
        ) else { continue; };
        if data["schema_version"] != 1 || story_id.is_empty() || story_id.len() > 80 ||
            updated_at.len() > 64 || total == 0 || total > 256 || done > total ||
            !matches!(state, "running" | "cancelled" | "failed" | "completed") {
            continue;
        }
        if story_filter.is_some_and(|filter| filter != story_id) {
            continue;
        }
        let display_state = if state == "running" && !is_render_job_active(&job_id)? {
            "interrupted"
        } else {
            state
        };
        reports.push(RenderHistoryEntry {
            job_id, story_id: story_id.to_owned(), state: display_state.to_owned(),
            done: done as u32, total: total as u32, updated_at: updated_at.to_owned(),
        });
        if reports.len() == 20 {
            break;
        }
    }
    Ok(reports)
}

#[tauri::command]
fn story_render_history(
    app: tauri::AppHandle,
    story_id: Option<String>,
) -> Result<Vec<RenderHistoryEntry>, String> {
    read_render_history(&app_dir(&app)?.join("jobs"), story_id.as_deref())
}

fn forget_render_journal_file(
    folder: &Path,
    job_id: &str,
    story_id: &str,
) -> Result<(), String> {
    Uuid::parse_str(job_id).map_err(|_| "Invalid render job ID.".to_string())?;
    if story_id.is_empty() || story_id.len() > 80 {
        return Err("Invalid story ID.".into());
    }
    if is_render_job_active(job_id)? {
        return Err("Cannot forget a render while it is active.".into());
    }
    let path = folder.join(format!("{job_id}.manifest.json"));
    let metadata = fs::symlink_metadata(&path)
        .map_err(|_| "Render history record was not found.".to_string())?;
    if !metadata.file_type().is_file() || metadata.len() > 65_536 {
        return Err("Render history record is not a regular bounded JSON file.".into());
    }
    let data: Value = serde_json::from_slice(
        &fs::read(&path).map_err(|_| "Cannot read render history.".to_string())?,
    ).map_err(|_| "Render history is unreadable.".to_string())?;
    if data["schema_version"] != 1 || data["story_id"].as_str() != Some(story_id) {
        return Err("The history record belongs to a different story.".into());
    }
    // A user-confirmed forget also removes its small cancellation/progress
    // bookkeeping files. Validate BOTH optional files before deleting anything
    // to avoid partial cleanup when an unexpected symlink is encountered.
    let mut sidecars = Vec::new();
    for (suffix, bound) in [(".progress.json", 1024), (".cancel", 8)] {
        let sidecar = folder.join(format!("{job_id}{suffix}"));
        let metadata = match fs::symlink_metadata(&sidecar) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("Cannot inspect render sidecar: {error}")),
        };
        if !metadata.file_type().is_file() || metadata.len() > bound {
            return Err("Render bookkeeping sidecar is not a bounded regular file.".into());
        }
        sidecars.push(sidecar);
    }
    for sidecar in sidecars {
        fs::remove_file(sidecar)
            .map_err(|e| format!("Cannot remove render bookkeeping file: {e}"))?;
    }
    fs::remove_file(path).map_err(|e| format!("Cannot remove render history record: {e}"))
}

#[tauri::command]
fn forget_render_journal(
    app: tauri::AppHandle,
    job_id: String,
    story_id: String,
) -> Result<(), String> {
    forget_render_journal_file(&app_dir(&app)?.join("jobs"), &job_id, &story_id)
}

#[tauri::command]
fn cancel_story_render(app: tauri::AppHandle, job_id: String) -> Result<(), String> {
    Uuid::parse_str(&job_id).map_err(|_| "Invalid job identifier.")?;
    if !is_render_job_active(&job_id)? {
        return Err("The render job is no longer active.".into());
    }
    let folder = app_dir(&app)?.join("jobs");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let path = folder.join(format!("{job_id}.cancel"));
    fs::write(path, b"cancel").map_err(|e| e.to_string())
}

fn finalize_rendered_story_wav(
    output: &Path,
    job_id: String,
    data: &Value,
) -> Result<AudioResult, String> {
    // A valid long narration must remain exportable even when the webview
    // cannot carry its full 25 MiB+ content in a base64 data URL.
    let mut source = fs::File::open(output)
        .map_err(|_| "The batch renderer did not produce a WAV.".to_string())?;
    let size = inspect_wav_file(&mut source)?;
    let metadata = data.get("result").ok_or("Missing render metadata.")?;
    let timings = parse_segment_timings(metadata)?;
    let duration = metadata["duration_seconds"].as_f64()
        .ok_or("Missing reported WAV duration.")?;
    let rate = metadata["sample_rate"].as_u64()
        .ok_or("Missing reported sample rate.")?;
    let chunks = metadata["chunks"].as_u64()
        .ok_or("Missing synthesis chunk count.")?;
    if !duration.is_finite() || duration <= 0.0 || duration > 1200.0 ||
        !(8_000..=192_000).contains(&rate) || !(1..=500).contains(&chunks) ||
        timings.last().is_some_and(|cue| cue.end_seconds > duration + 0.005)
    {
        return Err("Render metadata has inconsistent audio duration or chunk counts.".into());
    }
    let preview_available = size <= MAX_GENERATED_WAV;
    let data_url = if preview_available {
        let bytes = fs::read(output).map_err(|e| e.to_string())?;
        format!("data:audio/wav;base64,{}", STANDARD.encode(bytes))
    } else {
        String::new()
    };
    Ok(AudioResult {
        audio_id: job_id,
        data_url,
        duration_seconds: duration,
        sample_rate: rate as u32,
        chunks: chunks as u32,
        segment_timings: timings,
        preview_available,
        file_bytes: size,
    })
}

fn finalize_or_remove_rendered_wav(
    output: &Path,
    job_id: String,
    data: &Value,
) -> Result<AudioResult, String> {
    let result = finalize_rendered_story_wav(output, job_id, data);
    if result.is_err() {
        let _ = fs::remove_file(output);
    }
    result
}

#[tauri::command]
async fn render_story_v2(
    app: tauri::AppHandle,
    project: StoryV2,
    job_id: String,
    selected_scene_ids: Option<Vec<String>>,
    selected_segment_ids: Option<Vec<String>>,
    force_segment_ids: Option<Vec<String>>,
) -> Result<AudioResult, String> {
    validate_story_v2(&project)?;
    Uuid::parse_str(&job_id).map_err(|_| "Invalid render job ID.")?;
    if selected_scene_ids.as_ref().is_some_and(|items| items.len() > 200) ||
       selected_segment_ids.as_ref().is_some_and(|items| items.len() > 256) ||
       force_segment_ids.as_ref().is_some_and(|items| items.len() > 256) {
        return Err("Too many selected scenes or dialogue lines.".into());
    }
    // Register synchronously, before the worker starts: fast cancel/history
    // requests should observe the job even while the runtime queues work.
    let guard = ActiveRenderGuard::start(&job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _active_job = guard;
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
        let journal_path = jobs.join(format!("{job_id}.manifest.json"));
        if journal_path.exists() || journal_path.is_symlink() {
            return Err("Render job already has a recovery journal.".into());
        }
        let progress_path = jobs.join(format!("{job_id}.progress.json"));
        // Keep cancellation sent between synchronous registration and worker
        // startup: removing the new UUID's marker here would lose fast cancels.
        // A previously used job UUID is rejected by the persisted journal.
        let _ = fs::remove_file(&progress_path);
        let response = invoke_python(json!({
            "action": "render_story",
            "project": project,
            "output": output,
            "cache": root.join("segment-cache"),
            "cancel_file": cancel_path,
            "progress_file": progress_path,
            "journal_file": journal_path,
            "selected_scene_ids": selected_scene_ids,
            "selected_segment_ids": selected_segment_ids,
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
        // Any metadata/preview failure after inference should clean the
        // job-owned WAV. Previously such errors leaked orphan audio into app data.
        finalize_or_remove_rendered_wav(&output, job_id, &data)
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

fn generated_audio_for_inspection(root: &Path, audio_id: &str) -> Result<PathBuf, String> {
    // Canonicalized UUID formatting ensures caller input cannot inject path
    // components, alternate filenames or symlink references.
    let id = Uuid::parse_str(audio_id).map_err(|_| "Invalid audio ID.".to_string())?;
    Ok(root.join("audio").join(format!("{id}.wav")))
}

#[tauri::command]
async fn inspect_generated_audio(
    app: tauri::AppHandle,
    audio_id: String,
) -> Result<Value, String> {
    // Never accept a caller-supplied file path. The only source is this
    // app's already-generated UUID WAV inside its own audio directory.
    let source = generated_audio_for_inspection(&app_dir(&app)?, &audio_id)?;
    let metadata = fs::symlink_metadata(&source)
        .map_err(|_| "Generated WAV is missing. Render again before inspecting.".to_string())?;
    if !metadata.file_type().is_file() {
        return Err("Generated WAV must be a regular non-symlink file.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let response = invoke_python(json!({
            "action": "inspect_generated_wav",
            "path": source,
        })).map_err(|_| {
            // Never echo an absolute audio path or a private machine directory
            // from Python's error response to the desktop UI.
            "Cannot inspect the generated WAV. Check the local Python runtime and audio file."
                .to_string()
        })?;
        let report = response.get("result").cloned()
            .ok_or_else(|| "WAV inspection returned no report.".to_string())?;
        if report["structure_valid"] != true ||
            report["model_loaded"] != false ||
            report["hindi_listening_verified"] != false ||
            report["human_review_required"] != true
        {
            return Err("WAV inspection returned inconsistent verification flags.".into());
        }
        Ok(report)
    }).await.map_err(|_| "WAV inspection worker stopped unexpectedly.".to_string())?
}

fn copy_validated_wav(source: &Path, destination: &Path) -> Result<(), String> {
    if !destination.is_absolute() ||
        destination.extension().and_then(|ext| ext.to_str()) != Some("wav") {
        return Err("Choose a new absolute .wav output path.".into());
    }
    let metadata = fs::symlink_metadata(source)
        .map_err(|_| "Generated audio is missing.".to_string())?;
    if !metadata.file_type().is_file() {
        return Err("Generated audio is not a regular WAV file.".into());
    }
    let mut input = fs::File::open(source)
        .map_err(|_| "Generated audio is missing.".to_string())?;
    let initial = input.metadata()
        .map_err(|_| "Unable to inspect generated WAV source.".to_string())?;
    let size = inspect_wav_file(&mut input)?;
    let checked = input.metadata()
        .map_err(|_| "Unable to recheck generated WAV source.".to_string())?;
    if !wav_source_metadata_unchanged(&initial, &checked) {
        return Err("Generated WAV changed during validation; export it again.".into());
    }
    let mut output = fs::OpenOptions::new().write(true).create_new(true)
        .open(destination).map_err(|e| format!("Cannot create destination file: {e}"))?;
    let copy = std::io::copy(&mut input, &mut output)
        .and_then(|copied| {
            if copied != size {
                return Err(std::io::Error::other("WAV source changed during export."));
            }
            output.sync_all()?;
            let final_meta = input.metadata()?;
            if !wav_source_metadata_unchanged(&initial, &final_meta) {
                return Err(std::io::Error::other("WAV source changed during export."));
            }
            Ok(())
        });
    if let Err(error) = copy {
        drop(output);
        let _ = fs::remove_file(destination);
        return Err(format!("Unable to export WAV: {error}"));
    }
    Ok(())
}

#[tauri::command]
fn export_wav(app: tauri::AppHandle, audio_id: String, destination: String) -> Result<(), String> {
    Uuid::parse_str(&audio_id).map_err(|_| "Invalid audio ID.")?;
    let source = app_dir(&app)?.join("audio").join(format!("{audio_id}.wav"));
    copy_validated_wav(&source, Path::new(&destination))
}

fn parse_srt_milliseconds(value: &str) -> Result<u64, String> {
    let bytes = value.as_bytes();
    if bytes.len() != 12 || bytes[2] != b':' || bytes[5] != b':' || bytes[8] != b',' ||
        bytes.iter().enumerate().any(|(index, byte)|
            !matches!(index, 2 | 5 | 8) && !byte.is_ascii_digit())
    {
        return Err("Subtitle timestamp must use HH:MM:SS,mmm.".into());
    }
    let hours = value[0..2].parse::<u64>().map_err(|e| e.to_string())?;
    let minutes = value[3..5].parse::<u64>().map_err(|e| e.to_string())?;
    let seconds = value[6..8].parse::<u64>().map_err(|e| e.to_string())?;
    let millis = value[9..12].parse::<u64>().map_err(|e| e.to_string())?;
    if minutes >= 60 || seconds >= 60 {
        return Err("Subtitle timestamp has invalid minutes or seconds.".into());
    }
    Ok(((hours * 60 + minutes) * 60 + seconds) * 1000 + millis)
}

fn validate_srt_content(content: &str) -> Result<(), String> {
    if content.is_empty() || content.len() > 250_000 || content.contains('\r') {
        return Err("Invalid or oversized UTF-8 SubRip content.".into());
    }
    let body = content.strip_suffix('\n').unwrap_or(content);
    let mut previous_end = 0_u64;
    let mut count = 0_usize;
    for block in body.split("\n\n") {
        count += 1;
        if count > 256 {
            return Err("A subtitle export supports at most 256 dialogue cues.".into());
        }
        let mut lines = block.split('\n');
        let number = lines.next().unwrap_or("");
        let timings = lines.next().unwrap_or("");
        let subtitle = lines.next().unwrap_or("");
        if number != count.to_string() || lines.next().is_some() ||
            subtitle.trim().is_empty() || subtitle.chars().count() > 3000 ||
            subtitle.chars().any(char::is_control)
        {
            return Err("Invalid SubRip cue index or dialogue text.".into());
        }
        let (start, end) = timings.split_once(" --> ")
            .ok_or("Subtitle cue is missing the timing separator.")?;
        let start_ms = parse_srt_milliseconds(start)?;
        let end_ms = parse_srt_milliseconds(end)?;
        if end_ms <= start_ms || start_ms < previous_end || end_ms > 1_200_000 {
            return Err("Subtitle cues must be ordered and within 20 minutes.".into());
        }
        previous_end = end_ms;
    }
    if count == 0 {
        return Err("Subtitle export needs a dialogue cue.".into());
    }
    Ok(())
}

fn write_srt(destination: &Path, content: &str) -> Result<(), String> {
    if !destination.is_absolute() ||
        destination.extension().and_then(|ext| ext.to_str()) != Some("srt") {
        return Err("Choose a new absolute .srt subtitle destination.".into());
    }
    validate_srt_content(content)?;
    let mut file = fs::OpenOptions::new().write(true).create_new(true)
        .open(destination).map_err(|e| format!("Cannot create subtitle destination: {e}"))?;
    if let Err(error) = file.write_all(content.as_bytes()).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(destination);
        return Err(format!("Unable to write subtitles: {error}"));
    }
    Ok(())
}

#[tauri::command]
fn export_subtitles(destination: String, content: String) -> Result<(), String> {
    write_srt(Path::new(&destination), &content)
}

#[tauri::command]
fn export_production_manifest(destination: String, content: String) -> Result<(), String> {
    write_production_manifest(Path::new(&destination), &content)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_project, load_project, list_projects, save_story_v2, load_story_v2, parse_dialogue, preview_pronunciation, preflight_render, audit_production, inspect_script, check_engine, diagnose_engine, inspect_segment_cache, prune_segment_cache, maintain_abandoned_wavs, synthesize, render_story_v2, story_render_progress, story_render_history, forget_render_journal, cancel_story_render, discard_audio, inspect_generated_audio, export_wav, export_subtitles, export_production_manifest
        ])
        .run(tauri::generate_context!())
        .expect("KathaSvara failed to start");
}

#[cfg(test)]
mod tests {
    use super::*;
    // Parallel Rust test workers must not interleave global render/maintenance guards.
    static REGISTRY_TEST_LOCK: Mutex<()> = Mutex::new(());
    #[test]
    fn generated_audio_inspection_accepts_only_uuid_scoped_app_data_path() {
        let root = Path::new("private-app-data");
        let valid = "123e4567-e89b-42d3-a456-426614174000";
        let candidate = generated_audio_for_inspection(root, valid).unwrap();
        assert_eq!(candidate, root.join("audio").join(format!("{valid}.wav")));
        for invalid in [
            "../private", "audio/123e4567-e89b-42d3-a456-426614174000",
            "not-a-uuid", "", "123e4567-e89b-42d3-a456-426614174000.wav",
        ] {
            assert!(generated_audio_for_inspection(root, invalid).is_err());
        }
    }

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
            pronunciation_glossary: vec![],
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
    fn active_render_guard_rejects_duplicate_and_resets_on_drop() {
        let _lock = REGISTRY_TEST_LOCK.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        assert!(!is_render_job_active(&id).unwrap());
        {
            let _guard = ActiveRenderGuard::start(&id).unwrap();
            assert!(is_render_job_active(&id).unwrap());
            assert!(ActiveRenderGuard::start(&id).is_err());
        }
        assert!(!is_render_job_active(&id).unwrap());
        assert!(ActiveRenderGuard::start(&id).is_ok());
    }

    #[test]
    fn history_filter_finds_older_matching_story_and_classifies_interruption() {
        let _lock = REGISTRY_TEST_LOCK.lock().unwrap();
        let folder = std::env::temp_dir().join(format!("kathasvara-history-{}", Uuid::new_v4()));
        fs::create_dir_all(&folder).unwrap();
        let story_a = Uuid::new_v4().to_string();
        let story_b = Uuid::new_v4().to_string();
        let original_job = Uuid::new_v4().to_string();
        let manifest = json!({
            "schema_version": 1, "story_id": story_a,
            "state": "running", "done": 1, "total": 2,
            "updated_at": "2026-10-20T10:00:00+00:00",
        });
        fs::write(folder.join(format!("{original_job}.manifest.json")),
            manifest.to_string()).unwrap();
        for _ in 0..24 {
            let other = Uuid::new_v4();
            let data = json!({
                "schema_version": 1, "story_id": story_b,
                "state": "completed", "done": 2, "total": 2,
                "updated_at": "2026-10-20T10:01:00+00:00",
            });
            fs::write(folder.join(format!("{other}.manifest.json")),
                data.to_string()).unwrap();
        }
        let matches = read_render_history(&folder, Some(&story_a)).unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].job_id, original_job);
        assert_eq!(matches[0].state, "interrupted");
        {
            let _guard = ActiveRenderGuard::start(&original_job).unwrap();
            let active = read_render_history(&folder, Some(&story_a)).unwrap();
            assert_eq!(active[0].state, "running");
            assert!(forget_render_journal_file(&folder, &original_job, &story_a).is_err());
        }
        assert!(forget_render_journal_file(&folder, &original_job, &story_b).is_err());
        assert!(folder.join(format!("{original_job}.manifest.json")).exists());
        let progress = folder.join(format!("{original_job}.progress.json"));
        let cancel = folder.join(format!("{original_job}.cancel"));
        let other = folder.join(format!("{}.progress.json", Uuid::new_v4()));
        fs::write(&progress, br#"{"done":1,"total":2}"#).unwrap();
        fs::write(&cancel, b"cancel").unwrap();
        fs::write(&other, b"keep").unwrap();
        forget_render_journal_file(&folder, &original_job, &story_a).unwrap();
        assert!(!progress.exists());
        assert!(!cancel.exists());
        assert!(other.exists());
        assert!(!folder.join(format!("{original_job}.manifest.json")).exists());
        assert_eq!(read_render_history(&folder, Some(&story_a)).unwrap().len(), 0);
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn journal_forget_rejects_malformed_json_without_deleting() {
        let folder = std::env::temp_dir().join(format!("kathasvara-bad-journal-{}", Uuid::new_v4()));
        fs::create_dir_all(&folder).unwrap();
        let job_id = Uuid::new_v4().to_string();
        let path = folder.join(format!("{job_id}.manifest.json"));
        fs::write(&path, b"not JSON").unwrap();
        let story_id = Uuid::new_v4().to_string();
        assert!(forget_render_journal_file(&folder, &job_id, &story_id).is_err());
        assert!(path.exists());
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn unsafe_progress_sidecar_refuses_to_forget_manifest() {
        let folder = std::env::temp_dir().join(format!("kathasvara-sidecar-{}", Uuid::new_v4()));
        fs::create_dir_all(&folder).unwrap();
        let job_id = Uuid::new_v4().to_string();
        let story_id = Uuid::new_v4().to_string();
        let manifest = folder.join(format!("{job_id}.manifest.json"));
        fs::write(&manifest, json!({"schema_version":1, "story_id":story_id}).to_string()).unwrap();
        let progress = folder.join(format!("{job_id}.progress.json"));
        fs::create_dir_all(&progress).unwrap();
        assert!(forget_render_journal_file(&folder, &job_id, &story_id).is_err());
        assert!(manifest.exists());
        assert!(progress.is_dir());
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn cache_prune_blocks_live_renders_and_render_guard_blocks_pruning() {
        let _lock = REGISTRY_TEST_LOCK.lock().unwrap();
        let active_id = Uuid::new_v4().to_string();
        {
            let _render = ActiveRenderGuard::start(&active_id).unwrap();
            assert!(CachePruneGuard::start().is_err());
        }
        {
            let _prune = CachePruneGuard::start().unwrap();
            assert!(CachePruneGuard::start().is_err());
            assert!(ActiveRenderGuard::start(&Uuid::new_v4().to_string()).is_err());
        }
        assert!(CachePruneGuard::start().is_ok());
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
    fn v2_legacy_json_without_glossary_is_still_readable() {
        let doc = sample_v2();
        let mut payload = serde_json::to_value(&doc).unwrap();
        payload.as_object_mut().unwrap().remove("pronunciation_glossary");
        let old: StoryV2 = serde_json::from_value(payload).unwrap();
        assert!(old.pronunciation_glossary.is_empty());
        assert!(validate_story_v2(&old).is_ok());
    }

    #[test]
    fn v2_rejects_duplicate_glossary_sources() {
        let mut doc = sample_v2();
        doc.pronunciation_glossary = vec![
            PronunciationRuleV2 { id: "a".into(), original: "राजा".into(),
                spoken: "रा-जा".into(), enabled: true },
            PronunciationRuleV2 { id: "b".into(), original: "राजा".into(),
                spoken: "रजा".into(), enabled: false },
        ];
        assert!(validate_story_v2(&doc).is_err());
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
    fn python_response_reader_accepts_bounded_json() {
        let bytes = br#"{"ok":true,"result":"Hindi"}"#;
        let actual = read_bounded_response(std::io::Cursor::new(bytes)).unwrap();
        assert_eq!(actual, bytes);
    }

    #[test]
    fn python_response_reader_rejects_oversize() {
        let bytes = vec![b'a'; MAX_PYTHON_RESPONSE + 1];
        assert!(read_bounded_response(std::io::Cursor::new(bytes))
            .expect_err("response should be bounded").contains("maximum allowed size"));
    }

    #[test]
    fn subtitle_export_accepts_real_line_breaks_and_refuses_overwrite() {
        let dest = std::env::temp_dir().join(format!("kathasvara-{}.srt", Uuid::new_v4()));
        let valid = "1\n00:00:00,000 --> 00:00:00,500\nनमस्कार!\n\n2\n00:00:00,640 --> 00:00:01,250\nराजा भोज।\n";
        write_srt(&dest, valid).unwrap();
        assert_eq!(fs::read_to_string(&dest).unwrap(), valid);
        assert!(write_srt(&dest, valid).is_err());
        assert!(write_srt(Path::new("relative.srt"), valid).is_err());
        assert_eq!(fs::read_to_string(&dest).unwrap(), valid);
        fs::remove_file(dest).unwrap();
    }

    #[test]
    fn subtitle_validation_rejects_literal_backslashes_and_corrupt_timestamps() {
        assert!(validate_srt_content(r"1\n00:00:00,000 --> 00:00:00,500\nनमस्कार!").is_err());
        let invalid = [
            "1\nreplacement\n",
            "1\n00:00:00,000 --> 00:00:00,500\n",
            "1\n00:00:00,500 --> 00:00:00,000\nनमस्कार\n",
            "1\n00:00:00,000 --> 00:00:00,500\nनमस्कार\n\n2\n00:00:00,490 --> 00:00:01,000\nधन्यवाद\n",
            "1\n00:99:00,000 --> 00:99:01,000\nनमस्कार\n",
            "1\n00:00:00.000 --> 00:00:00.500\nनमस्कार\n",
            "1\n00:00:00,000 --> 00:20:00,001\nनमस्कार\n",
            "2\n00:00:00,000 --> 00:00:00,500\nनमस्कार\n",
            "1\r\n00:00:00,000 --> 00:00:00,500\r\nनमस्कार\r\n",
            "1\n00:00:00,000 --> 00:00:00,500\nनमस्कार\nऔर\n",
        ];
        for text in invalid {
            assert!(validate_srt_content(text).is_err(), "Invalid SRT unexpectedly passed.");
        }
    }

    #[test]
    fn large_pcm_wav_can_be_streamed_to_export_without_overwriting() {
        let folder = std::env::temp_dir().join(format!("kathasvara-long-wav-{}", Uuid::new_v4()));
        fs::create_dir_all(&folder).unwrap();
        let source = folder.join("source.wav");
        let exported = folder.join("export.wav");
        let sample_bytes: u32 = 26 * 1024 * 1024; // Over the 25 MiB inline preview cap.
        let mut writer = fs::File::create(&source).unwrap();
        writer.write_all(b"RIFF").unwrap();
        writer.write_all(&(sample_bytes + 36).to_le_bytes()).unwrap();
        writer.write_all(b"WAVEfmt ").unwrap();
        writer.write_all(&16_u32.to_le_bytes()).unwrap();
        writer.write_all(&1_u16.to_le_bytes()).unwrap();
        writer.write_all(&1_u16.to_le_bytes()).unwrap();
        writer.write_all(&24_000_u32.to_le_bytes()).unwrap();
        writer.write_all(&48_000_u32.to_le_bytes()).unwrap();
        writer.write_all(&2_u16.to_le_bytes()).unwrap();
        writer.write_all(&16_u16.to_le_bytes()).unwrap();
        writer.write_all(b"data").unwrap();
        writer.write_all(&sample_bytes.to_le_bytes()).unwrap();
        writer.set_len(44 + u64::from(sample_bytes)).unwrap();
        drop(writer);
        assert!(fs::metadata(&source).unwrap().len() > MAX_GENERATED_WAV);
        copy_validated_wav(&source, &exported).unwrap();
        assert_eq!(fs::metadata(&source).unwrap().len(), fs::metadata(&exported).unwrap().len());
        assert!(copy_validated_wav(&source, &exported).is_err());
        assert_eq!(fs::metadata(&source).unwrap().len(), fs::metadata(&exported).unwrap().len());
        let response = json!({"result": {
            "duration_seconds": 568.0,
            "sample_rate": 24000,
            "chunks": 1,
            "segments": [{
                "segment_id": "test", "start_seconds": 0.0,
                "end_seconds": 1.0, "effective_text": "नमस्कार"
            }]
        }});
        let metadata = finalize_rendered_story_wav(
            &source, Uuid::new_v4().to_string(), &response,
        ).unwrap();
        assert!(!metadata.preview_available);
        assert!(metadata.data_url.is_empty());
        assert_eq!(metadata.file_bytes, 44 + u64::from(sample_bytes));
        assert!(source.exists());
        // A WAV with missing/invalid worker metadata must not accumulate in
        // app data even when its audio samples pass structural validation.
        let orphan = folder.join("orphan.wav");
        fs::copy(&source, &orphan).unwrap();
        assert!(finalize_or_remove_rendered_wav(
            &orphan, Uuid::new_v4().to_string(),
            &json!({"result": {"segments": [], "duration_seconds": 568.0}}),
        ).is_err());
        assert!(!orphan.exists());
        assert!(source.exists());
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn measured_segment_timeline_enforces_bounds_and_order() {
        let good = json!({"segments": [
            {"segment_id":"one","start_seconds":0.0,"end_seconds":1.0,"effective_text":"नमस्कार"},
            {"segment_id":"two","start_seconds":1.14,"end_seconds":2.4,"effective_text":"हिंदी"}
        ]});
        assert_eq!(parse_segment_timings(&good).unwrap().len(), 2);
        let bad = json!({"segments": [
            {"segment_id":"one","start_seconds":0.0,"end_seconds":2.0,"effective_text":"नमस्कार"},
            {"segment_id":"two","start_seconds":1.0,"end_seconds":2.4,"effective_text":"हिंदी"}
        ]});
        assert!(parse_segment_timings(&bad).is_err());
        assert!(parse_segment_timings(&json!({"segments":[]})).is_err());
    }

    #[test]
    fn cache_budget_rejects_excessive_requests() {
        assert_eq!(cache_budget_bytes(512).unwrap(), 512 * 1024 * 1024);
        assert!(cache_budget_bytes(0).is_err());
        assert!(cache_budget_bytes(2_049).is_err());
    }

    #[test]
    fn oversized_response_is_fully_drained_without_growing_memory() {
        let payload = vec![b'a'; MAX_PYTHON_RESPONSE * 4];
        let mut input = std::io::Cursor::new(payload);
        assert!(read_bounded_response(&mut input).is_err());
        assert_eq!(input.position() as usize, MAX_PYTHON_RESPONSE * 4);
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
    fn wav_validation_rejects_wrong_byte_rate_without_truncation() {
        let mut wav = minimal_pcm_wav();
        wav[28..32].copy_from_slice(&1_u32.to_le_bytes());
        assert!(inspect_wav(&wav).is_err());
        wav[28..32].copy_from_slice(&48_000_u32.to_le_bytes());
        assert!(inspect_wav(&wav).is_ok());
    }

    #[test]
    fn wav_validation_rejects_duplicate_pcm_chunks_and_empty_data_chunk() {
        let original = minimal_pcm_wav();
        // Append another data chunk. The file is well-sized but ambiguous.
        let mut double_data = original.clone();
        double_data.extend_from_slice(b"data");
        double_data.extend_from_slice(&2_u32.to_le_bytes());
        double_data.extend_from_slice(&[0_u8; 2]);
        double_data[4..8].copy_from_slice(&((double_data.len() - 8) as u32).to_le_bytes());
        assert!(inspect_wav(&double_data).is_err());
        let mut double_fmt = original.clone();
        double_fmt.extend_from_slice(&original[12..36]);
        double_fmt[4..8].copy_from_slice(&((double_fmt.len() - 8) as u32).to_le_bytes());
        assert!(inspect_wav(&double_fmt).is_err());
        let mut empty_data = original;
        empty_data[40..44].copy_from_slice(&0_u32.to_le_bytes());
        assert!(inspect_wav(&empty_data).is_err());
    }

    #[test]
    fn wav_validation_rejects_bad_channel_count() {
        let mut wav = minimal_pcm_wav();
        wav[22..24].copy_from_slice(&2u16.to_le_bytes());
        assert!(inspect_wav(&wav).is_err());
    }
}
