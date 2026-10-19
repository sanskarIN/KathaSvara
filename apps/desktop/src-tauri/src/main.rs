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
    let max_wait = if request.get("action").and_then(Value::as_str) == Some("synthesize") {
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
        .last()
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
async fn check_engine() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| invoke_python(json!({"action":"health"})))
        .await.map_err(|e| e.to_string())??;
    Ok("Python bridge available. Model weights have not been verified.".into())
}

fn inspect_wav(data: &[u8]) -> Result<(), String> {
    if data.len() < 44 || &data[..4] != b"RIFF" || &data[8..12] != b"WAVE" {
        return Err("Output is not a valid RIFF/WAVE file.".into());
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
        let data = invoke_python(json!({
            "action":"synthesize",
            "text":text,
            "output":path,
            "exaggeration":exaggeration,
            "cfg_weight":cfg_weight
        }))?;
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
            save_project, load_project, list_projects, inspect_script, check_engine, synthesize, export_wav
        ])
        .run(tauri::generate_context!())
        .expect("KathaSvara failed to start");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn project_validates_title() {
        let project = StoryProject { id: String::new(), title: String::new(), text: String::new() };
        assert!(validate_project(&project).is_err());
    }
    #[test]
    fn riff_validation_rejects_invalid_bytes() {
        assert!(inspect_wav(&[0u8; 50]).is_err());
    }
}
