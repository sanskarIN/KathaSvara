// SPDX-License-Identifier: MPL-2.0
//! Strict export-only format for privacy-safe, model-free narration audits.
//! This module intentionally accepts no script, story ID, scene ID or name.
use serde::Deserialize;
use std::{
    fs,
    io::Write,
    path::Path,
};

const MAX_MANIFEST_BYTES: usize = 64_000;

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Reason {
    Ready,
    NoDialogue,
    UnassignedSpeaker,
    OverLimit,
    NeedsReview,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Scene {
    scene_number: usize,
    ready: bool,
    reason: Reason,
    segments: usize,
    chunks: usize,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    format: String,
    schema_version: u32,
    assessment: String,
    total_scenes: usize,
    ready_scenes: usize,
    full_story_ready: bool,
    full_story_reason: Reason,
    full_story_chunks: usize,
    scenes: Vec<Scene>,
    model_loaded: bool,
    audio_verified: bool,
    distinct_voices_verified: bool,
}

fn validate_manifest(content: &str) -> Result<(), String> {
    if content.is_empty() || content.len() > MAX_MANIFEST_BYTES {
        return Err("Production manifest exceeds the 64 KB review limit.".into());
    }
    let report: Manifest = serde_json::from_str(content)
        .map_err(|_| "Invalid production manifest JSON or unsupported fields.".to_string())?;
    if report.format != "kathasvara-production-audit" ||
        report.schema_version != 1 ||
        report.assessment != "model-free-script-structure-only" ||
        report.model_loaded || report.audio_verified || report.distinct_voices_verified ||
        report.total_scenes > 200 || report.scenes.len() != report.total_scenes ||
        report.ready_scenes > report.total_scenes ||
        report.full_story_chunks > 500 ||
        report.full_story_ready != (report.full_story_reason == Reason::Ready) ||
        (report.full_story_ready && (
            report.full_story_chunks == 0 || report.ready_scenes != report.total_scenes
        )) ||
        (!report.full_story_ready && report.full_story_chunks != 0)
    {
        return Err("Production manifest has invalid readiness or unverifiable audio claims.".into());
    }
    let mut ready_count = 0;
    for (index, scene) in report.scenes.iter().enumerate() {
        if scene.scene_number != index + 1 ||
            scene.ready != (scene.reason == Reason::Ready) ||
            scene.segments > 2000 || scene.chunks > 500 ||
            (scene.ready && (scene.segments == 0 || scene.segments > 256 || scene.chunks == 0)) ||
            (!scene.ready && scene.chunks != 0) ||
            (scene.segments == 0 && scene.reason != Reason::NoDialogue)
        {
            return Err("Production manifest has invalid scene order or counts.".into());
        }
        if scene.ready {
            ready_count += 1;
        }
    }
    if ready_count != report.ready_scenes {
        return Err("Production manifest ready-scene count is inconsistent.".into());
    }
    Ok(())
}

/// Never overwrite an existing destination (including symlink aliases).
/// An explicit desktop save dialog is required before this function is called.
pub(crate) fn write_production_manifest(destination: &Path, content: &str) -> Result<(), String> {
    if !destination.is_absolute() ||
        !destination.extension().and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
    {
        return Err("Choose an absolute new .json destination for the audit.".into());
    }
    validate_manifest(content)?;
    let mut file = fs::OpenOptions::new().write(true).create_new(true)
        .open(destination)
        .map_err(|e| format!("Cannot create new production report: {e}"))?;
    if let Err(error) = file.write_all(content.as_bytes()).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(destination);
        return Err(format!("Unable to write production report: {error}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use uuid::Uuid;

    fn sample() -> Value {
        json!({
            "format": "kathasvara-production-audit",
            "schema_version": 1,
            "assessment": "model-free-script-structure-only",
            "total_scenes": 2, "ready_scenes": 1,
            "full_story_ready": false, "full_story_reason": "unassigned_speaker",
            "full_story_chunks": 0,
            "scenes": [
                {"scene_number": 1, "ready": true, "reason": "ready", "segments": 2, "chunks": 3},
                {"scene_number": 2, "ready": false, "reason": "unassigned_speaker", "segments": 1, "chunks": 0}
            ],
            "model_loaded": false, "audio_verified": false,
            "distinct_voices_verified": false
        })
    }

    #[test]
    fn accepts_count_only_reports_and_rejects_private_or_unverified_fields() {
        let mut report = sample();
        assert!(validate_manifest(&report.to_string()).is_ok());
        report["script_text"] = json!("गोपनीय हिंदी कहानी");
        assert!(validate_manifest(&report.to_string()).is_err());
        let mut report = sample();
        report["audio_verified"] = json!(true);
        assert!(validate_manifest(&report.to_string()).is_err());
        let mut report = sample();
        report["scenes"][0]["character_name"] = json!("राजा भोज");
        assert!(validate_manifest(&report.to_string()).is_err());
        let mut report = sample();
        report["full_story_reason"] = json!("model_passed");
        assert!(validate_manifest(&report.to_string()).is_err());
    }

    #[test]
    fn refuses_forged_totals_and_invalid_scene_counts() {
        let mut report = sample();
        report["ready_scenes"] = json!(2);
        assert!(validate_manifest(&report.to_string()).is_err());
        let mut report = sample();
        report["scenes"][0]["scene_number"] = json!(2);
        assert!(validate_manifest(&report.to_string()).is_err());
        let mut report = sample();
        report["scenes"][0]["chunks"] = json!(0);
        assert!(validate_manifest(&report.to_string()).is_err());
        let mut report = sample();
        report["full_story_ready"] = json!(true);
        assert!(validate_manifest(&report.to_string()).is_err());
    }

    #[test]
    fn exports_only_to_new_json_files_and_never_overwrites() {
        let path = std::env::temp_dir()
            .join(format!("kathasvara-audit-{}.json", Uuid::new_v4()));
        let content = format!("{}\n", sample());
        assert!(write_production_manifest(&path, &content).is_ok());
        assert_eq!(fs::read_to_string(&path).unwrap(), content);
        let original = fs::read(&path).unwrap();
        assert!(write_production_manifest(&path, &content).is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn rejects_non_json_paths_and_oversized_payloads_without_files() {
        let folder = std::env::temp_dir();
        let path = folder.join(format!("kathasvara-{}.txt", Uuid::new_v4()));
        assert!(write_production_manifest(&path, &sample().to_string()).is_err());
        assert!(!path.exists());
        assert!(validate_manifest(&"X".repeat(MAX_MANIFEST_BYTES + 1)).is_err());
    }
}
