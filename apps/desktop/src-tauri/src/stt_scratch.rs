// SPDX-License-Identifier: MPL-2.0
//! Best-effort recovery of private microphone scratch WAVs after a process crash.
//!
//! Normal transcription deletes its own WAV through RAII. A hard Windows app
//! termination cannot run Drop, so UUID-owned scratch files might remain.
//! Startup only examines this dedicated directory. It never enters subfolders,
//! traverses symlinks, touches user-selected WAVs, or loads speech models.

use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};
use uuid::Uuid;

const DIRECTORY: &str = "stt-microphone";
const STALE_AFTER: Duration = Duration::from_secs(2 * 60 * 60);
const MAX_SCANNED: usize = 2_048;
const MAX_REMOVED: usize = 128;

/// Only this application's canonical UUID-v4 scratch basenames qualify.
/// Arbitrary .wav names, duplicate suffixes, uppercase UUIDs and directory
/// entries must never be interpreted as deletable private recordings.
fn is_owned_microphone_wav(name: &str) -> bool {
    let Some(id) = name.strip_suffix(".wav") else { return false };
    let bytes = id.as_bytes();
    if bytes.len() != 36 || bytes[14] != b'4'
        || !matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
        || [8, 13, 18, 23].iter().any(|&i| bytes[i] != b'-')
        || bytes.iter().enumerate().any(|(i, &b)| {
            ![8, 13, 18, 23].contains(&i) && !b.is_ascii_hexdigit()
        })
        || bytes.iter().any(|b| b.is_ascii_uppercase())
    {
        return false;
    }
    Uuid::parse_str(id).is_ok()
}

fn inspect_scratch_directory(root: &Path) -> Result<Option<PathBuf>, String> {
    const BAD_DIRECTORY: &str = "Private microphone recovery directory is unsafe.";
    if !root.is_absolute() {
        return Err(BAD_DIRECTORY.into());
    }
    let base = fs::symlink_metadata(root).map_err(|_| BAD_DIRECTORY)?;
    if !base.file_type().is_dir() {
        return Err(BAD_DIRECTORY.into());
    }
    let folder = root.join(DIRECTORY);
    let info = match fs::symlink_metadata(&folder) {
        Ok(info) => info,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(BAD_DIRECTORY.into()),
    };
    if !info.file_type().is_dir() {
        return Err(BAD_DIRECTORY.into());
    }
    Ok(Some(folder))
}

/// Remove crash leftovers only after 2 hours, well beyond the 10-minute
/// transcription watchdog. Scan candidates completely before deleting any,
/// so an adversarial or corrupt directory cannot cause partial cleanup.
/// Never return file names or private paths to the frontend.
pub fn prune_old_microphone_wavs(root: &Path, now: SystemTime) -> Result<usize, String> {
    const FAILED: &str = "Private microphone recovery scan could not finish.";
    let Some(folder) = inspect_scratch_directory(root)? else { return Ok(0) };
    let mut candidates = Vec::new();
    let mut scanned = 0_usize;
    for entry in fs::read_dir(&folder).map_err(|_| FAILED)? {
        scanned += 1;
        if scanned > MAX_SCANNED {
            return Err("Private microphone recovery scan exceeded its safe limit.".into());
        }
        let entry = entry.map_err(|_| FAILED)?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !is_owned_microphone_wav(name) { continue }
        let file = entry.path();
        let info = match fs::symlink_metadata(&file) {
            Ok(info) => info,
            Err(_) => continue,
        };
        if !info.file_type().is_file() { continue }
        let Ok(modified) = info.modified() else { continue };
        if !now.duration_since(modified).is_ok_and(|age| age >= STALE_AFTER) {
            continue;
        }
        // Keep only bounded metadata, never microphone audio bytes.
        candidates.push((file, info.len(), modified));
    }
    let mut removed = 0;
    for (file, size, modified) in candidates.into_iter().take(MAX_REMOVED) {
        // Recheck the directory to avoid following a replaced symlink.
        if inspect_scratch_directory(root)?.as_ref() != Some(&folder) {
            return Err(FAILED.into());
        }
        let Ok(info) = fs::symlink_metadata(&file) else { continue };
        if !info.file_type().is_file() || info.len() != size
            || info.modified().ok() != Some(modified)
            || !now.duration_since(modified).is_ok_and(|age| age >= STALE_AFTER)
        {
            continue;
        }
        // On Windows an open in-use WAV cannot normally be unlinked.
        // A failure is safe: leave the file, do not break startup.
        if fs::remove_file(&file).is_ok() { removed += 1 }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn sandbox() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "kathasvara-mic-recovery-{}", Uuid::new_v4()
        ));
        fs::create_dir_all(root.join(DIRECTORY)).unwrap();
        root
    }

    fn sample(folder: &Path, name: &str, when: SystemTime) -> PathBuf {
        let path = folder.join(name);
        let mut file = fs::File::create(&path).unwrap();
        file.write_all(b"private fixture data").unwrap();
        file.set_modified(when).unwrap();
        path
    }

    #[test]
    fn crash_recovery_removes_only_old_owned_uuid_wavs() {
        let root = sandbox();
        let folder = root.join(DIRECTORY);
        let now = SystemTime::now();
        let old = now - STALE_AFTER - Duration::from_secs(60);
        let recent = now - Duration::from_secs(60);
        let stale = sample(&folder, &format!("{}.wav", Uuid::new_v4()), old);
        let fresh = sample(&folder, &format!("{}.wav", Uuid::new_v4()), recent);
        let unrelated = sample(&folder, "recording.wav", old);
        let wrong_version = sample(&folder, "00000000-0000-1000-8000-000000000000.wav", old);
        let upper = sample(&folder, "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.wav", old);
        let nested = folder.join("nested");
        fs::create_dir(&nested).unwrap();
        let nested_wav = sample(&nested, &format!("{}.wav", Uuid::new_v4()), old);

        assert_eq!(prune_old_microphone_wavs(&root, now).unwrap(), 1);
        assert!(!stale.exists());
        assert!(fresh.exists() && unrelated.exists() && wrong_version.exists());
        assert!(upper.exists() && nested_wav.exists());
        assert_eq!(prune_old_microphone_wavs(&root, now).unwrap(), 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_rejects_non_directory_and_never_touches_outside_wav() {
        let root = sandbox();
        let outsider = sample(
            &root, &format!("{}.wav", Uuid::new_v4()),
            SystemTime::now() - STALE_AFTER - Duration::from_secs(60),
        );
        let now = SystemTime::now();
        assert_eq!(prune_old_microphone_wavs(&root, now).unwrap(), 0);
        assert!(outsider.exists());
        fs::remove_dir_all(root.join(DIRECTORY)).unwrap();
        assert_eq!(prune_old_microphone_wavs(&root, now).unwrap(), 0);
        fs::write(root.join(DIRECTORY), b"not a directory").unwrap();
        assert!(prune_old_microphone_wavs(&root, now).is_err());
        assert!(outsider.exists());
        fs::remove_dir_all(root).unwrap();
        assert!(prune_old_microphone_wavs(Path::new("relative"), now).is_err());
    }

    #[test]
    fn rejects_noncanonical_microphone_scratch_names() {
        assert!(is_owned_microphone_wav(&format!("{}.wav", Uuid::new_v4())));
        for invalid in [
            "recording.wav", "invalid.wav", "00000000-0000-4000-8000-000000000000.wav.bak",
            "00000000-0000-3000-8000-000000000000.wav",
            "00000000-0000-4000-0000-000000000000.wav",
            "00000000-0000-4000-8000-000000000000.WAV",
        ] {
            assert!(!is_owned_microphone_wav(invalid), "{invalid}");
        }
    }
}
