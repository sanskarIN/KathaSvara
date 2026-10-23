// SPDX-License-Identifier: MPL-2.0
//! Validate the RIFF/PCM16 container without allocating the full audio payload.
//! Only local WAVs produced by KathaSvara are supported.
use std::{
    fs::{File, Metadata},
    io::{Read, Seek, SeekFrom},
};

const MAX_STORED_WAV: u64 = 512 * 1024 * 1024;

/// Compare the metadata of an already-open WAV file before and after a
/// streaming operation. Detects common same-size edits as well as truncation.
/// This is not a cryptographic immutable snapshot; timestamp spoofing or edits
/// after the final check still require stronger OS-level snapshot semantics.
pub fn wav_source_metadata_unchanged(before: &Metadata, after: &Metadata) -> bool {
    before.is_file() &&
        after.is_file() &&
        before.len() == after.len() &&
        before.modified().ok().zip(after.modified().ok())
            .is_some_and(|(first, last)| first == last)
}

/// Authoritative media details derived from the opened RIFF file, not from the
/// worker's JSON response or the currently displayed browser audio metadata.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WavHeader {
    pub file_bytes: u64,
    pub sample_rate_hz: u32,
    pub frames: u64,
}

pub fn inspect_wav_details(source: &mut File) -> Result<WavHeader, String> {
    const INVALID: &str = "Stored audio is not a valid mono 16-bit PCM WAV.";
    let length = source.metadata().map_err(|_| INVALID)?.len();
    if !(44..=MAX_STORED_WAV).contains(&length) {
        return Err("Stored WAV exceeds the 512 MiB safety limit or has no audio.".into());
    }
    source.rewind().map_err(|_| INVALID)?;
    let mut header = [0_u8; 12];
    source.read_exact(&mut header).map_err(|_| INVALID)?;
    if &header[..4] != b"RIFF" || &header[8..] != b"WAVE" ||
        u64::from(u32::from_le_bytes(header[4..8].try_into().map_err(|_| INVALID)?)) + 8 != length
    {
        return Err("Stored WAV RIFF size or header is invalid.".into());
    }

    let mut cursor = 12_u64;
    let mut rate = None;
    let mut data_frames = None;
    let mut chunks = 0_u32;
    while cursor + 8 <= length {
        chunks += 1;
        if chunks > 4096 {
            return Err("Stored WAV contains too many metadata chunks.".into());
        }
        let mut chunk = [0_u8; 8];
        source.read_exact(&mut chunk).map_err(|_| INVALID)?;
        cursor += 8;
        let size = u64::from(u32::from_le_bytes(chunk[4..].try_into().map_err(|_| INVALID)?));
        let padded = size.checked_add(size % 2).ok_or(INVALID)?;
        let next = cursor.checked_add(padded).ok_or(INVALID)?;
        if next > length {
            return Err("Stored WAV chunk exceeds file length.".into());
        }
        if &chunk[..4] == b"fmt " {
            if rate.is_some() || size < 16 {
                return Err(INVALID.into());
            }
            let mut fmt = [0_u8; 16];
            source.read_exact(&mut fmt).map_err(|_| INVALID)?;
            let codec = u16::from_le_bytes([fmt[0], fmt[1]]);
            let channels = u16::from_le_bytes([fmt[2], fmt[3]]);
            let sample_rate = u32::from_le_bytes(fmt[4..8].try_into().map_err(|_| INVALID)?);
            let byte_rate = u32::from_le_bytes(fmt[8..12].try_into().map_err(|_| INVALID)?);
            let block_align = u16::from_le_bytes([fmt[12], fmt[13]]);
            let bits = u16::from_le_bytes([fmt[14], fmt[15]]);
            if codec != 1 || channels != 1 || !(8_000..=192_000).contains(&sample_rate) ||
                byte_rate != sample_rate * 2 || block_align != 2 || bits != 16
            {
                return Err(INVALID.into());
            }
            rate = Some(sample_rate);
        } else if &chunk[..4] == b"data" {
            if data_frames.is_some() || size == 0 || size % 2 != 0 {
                return Err(INVALID.into());
            }
            data_frames = Some(size / 2);
        }
        cursor = next;
        source.seek(SeekFrom::Start(cursor)).map_err(|_| INVALID)?;
    }
    if cursor != length {
        return Err("Stored WAV has trailing bytes.".into());
    }
    let sample_rate = rate.ok_or(INVALID)?;
    let frames = data_frames.ok_or(INVALID)?;
    if frames > u64::from(sample_rate) * 1200 {
        return Err("Stored WAV exceeds the 20-minute narration limit.".into());
    }
    source.rewind().map_err(|_| INVALID)?;
    Ok(WavHeader {
        file_bytes: length,
        sample_rate_hz: sample_rate,
        frames,
    })
}

/// Existing export/inspection callers need just the bounded byte length.
pub fn inspect_wav_file(source: &mut File) -> Result<u64, String> {
    Ok(inspect_wav_details(source)?.file_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn accepts_streaming_pcm_and_rejects_corrupt_header() {
        let file = std::env::temp_dir().join(format!("kathasvara-{}.wav", uuid::Uuid::new_v4()));
        let mut data = Vec::new();
        let samples = [0_u8; 400];
        data.extend_from_slice(b"RIFF");
        data.extend_from_slice(&(36_u32 + samples.len() as u32).to_le_bytes());
        data.extend_from_slice(b"WAVEfmt ");
        data.extend_from_slice(&16_u32.to_le_bytes());
        data.extend_from_slice(&1_u16.to_le_bytes());
        data.extend_from_slice(&1_u16.to_le_bytes());
        data.extend_from_slice(&24_000_u32.to_le_bytes());
        data.extend_from_slice(&48_000_u32.to_le_bytes());
        data.extend_from_slice(&2_u16.to_le_bytes());
        data.extend_from_slice(&16_u16.to_le_bytes());
        data.extend_from_slice(b"data");
        data.extend_from_slice(&(samples.len() as u32).to_le_bytes());
        data.extend_from_slice(&samples);
        std::fs::write(&file, &data).unwrap();
        let mut reader = File::open(&file).unwrap();
        let inspected = inspect_wav_details(&mut reader).unwrap();
        assert_eq!(inspected.file_bytes, data.len() as u64);
        assert_eq!(inspected.sample_rate_hz, 24_000);
        assert_eq!(inspected.frames, 200);
        assert_eq!(reader.stream_position().unwrap(), 0);
        assert_eq!(inspect_wav_file(&mut reader).unwrap(), data.len() as u64);
        drop(reader);
        data[4] ^= 0x01;
        std::fs::write(&file, data).unwrap();
        let mut reader = File::open(&file).unwrap();
        assert!(inspect_wav_file(&mut reader).is_err());
        drop(reader);
        std::fs::remove_file(file).unwrap();
    }

    #[test]
    fn rejects_inconsistent_pcm_byte_rate_even_with_correct_riff_length() {
        let path = std::env::temp_dir().join(format!(
            "kathasvara-byte-rate-{}.wav", uuid::Uuid::new_v4(),
        ));
        // A valid 1-frame, 24 kHz mono PCM16 header except the byte rate.
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&38_u32.to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16_u32.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes());
        wav.extend_from_slice(&24_000_u32.to_le_bytes());
        wav.extend_from_slice(&1_u32.to_le_bytes()); // Must be 48_000.
        wav.extend_from_slice(&2_u16.to_le_bytes());
        wav.extend_from_slice(&16_u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&2_u32.to_le_bytes());
        wav.extend_from_slice(&[0_u8; 2]);
        std::fs::write(&path, &wav).unwrap();
        let mut source = File::open(&path).unwrap();
        assert!(inspect_wav_file(&mut source).is_err());
        drop(source);
        wav[28..32].copy_from_slice(&48_000_u32.to_le_bytes());
        std::fs::write(&path, &wav).unwrap();
        let mut source = File::open(&path).unwrap();
        assert!(inspect_wav_file(&mut source).is_ok());
        drop(source);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn same_length_metadata_change_invalidates_wav_export_snapshot() {
        let path = std::env::temp_dir().join(format!(
            "kathasvara-export-guard-{}.wav", uuid::Uuid::new_v4(),
        ));
        std::fs::write(&path, b"test-wave-bytes").unwrap();
        // Windows requires write-attributes access for set_modified; keep
        // the test deterministic without sleeping for filesystem clock ticks.
        let file = std::fs::OpenOptions::new()
            .read(true).write(true).open(&path).unwrap();
        let original = file.metadata().unwrap();
        assert!(wav_source_metadata_unchanged(&original, &file.metadata().unwrap()));
        file.set_modified(original.modified().unwrap() + std::time::Duration::from_secs(10))
            .unwrap();
        let edited = file.metadata().unwrap();
        assert_eq!(edited.len(), original.len());
        assert!(!wav_source_metadata_unchanged(&original, &edited));
        drop(file);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn rejects_truncated_pcm_payload_and_empty_audio() {
        let file = std::env::temp_dir().join(format!("kathasvara-{}.wav", uuid::Uuid::new_v4()));
        let mut out = File::create(&file).unwrap();
        out.write_all(b"RIFF\x24\x00\x00\x00WAVEfmt ").unwrap();
        drop(out);
        let mut reader = File::open(&file).unwrap();
        assert!(inspect_wav_file(&mut reader).is_err());
        std::fs::remove_file(file).unwrap();
    }
}
