# Inspect a generated WAV without running the speech model

**KathaSvara v0.5.0 experimental developer pre-release / source tooling:** `kathasvara.wav_acceptance` is a read-only, standard-library-only WAV integrity checker. It does **not** require Chatterbox weights, a GPU, or network access. It is intended to collect bounded technical evidence for [manual acceptance issue #3](https://github.com/sanskarIN/KathaSvara/issues/3) after the creator has actually generated and exported an audio file.

## Run from the Python 3.11 inference environment

From `services/inference` after installing the project into the active virtual environment:

```powershell
python -m kathasvara.wav_acceptance --wav "C:\FULL\PATH\TO\NEW-EXPORT.wav"
```

Use a **real absolute path** to a local file you own. The command never synthesizes, modifies, deletes, uploads, or copies the WAV. Exit code `0` reports structurally valid WAV; exit code `2` reports absent, unsupported or structurally invalid input without echoing the local filename.

The report is printed as JSON to standard output. If you choose to save or share that output, inspect it first; the SHA-256 digest can reveal when two parties have the same recording.

Example report fields (values below are illustrative, not evidence of a real-model test):

```json
{
  "format": "kathasvara-wav-structural-inspection",
  "schema_version": 1,
  "structure_valid": true,
  "codec": "pcm_s16le",
  "channels": 1,
  "sample_rate_hz": 24000,
  "frames": 2400,
  "duration_seconds": 0.1,
  "file_bytes": 4844,
  "sha256": "illustrative-not-a-real-sha256",
  "level_hints": {
    "peak_dbfs": null,
    "rms_dbfs": null,
    "near_silence_hint": true,
    "possible_clipping_hint": false,
    "clipped_sample_percentage": 0.0,
    "longest_internal_quiet_span_seconds": 0.0,
    "longest_internal_quiet_span_start_seconds": null,
    "long_internal_pause_hint": false,
    "signal_review_required": true
  },
  "model_loaded": false,
  "hindi_listening_verified": false,
  "distinct_voices_verified": false,
  "human_review_required": true
}
```

## What the check actually establishes

- Absolute `.wav` path, non-symlink regular file, 44 bytes–512 MiB size bound.
- PCM16 *uncompressed, mono* WAV, 8–192 kHz sample rate, nonzero duration no longer than 20 minutes.
- Streamed frame reads to detect a truncated PCM data payload, using bounded chunks and a complete-file SHA-256 digest without holding the recording in RAM.
- Reject files whose opened-file identity, byte size, modification time or metadata-change time differs between the initial inspection and the end of hashing. This catches common **same-size edits during inspection**, but cannot prove an immutable snapshot against deliberate timestamp restoration or edits after the final check. Access time is intentionally excluded because reads can change it.
- Conservative `level_hints` computed from PCM amplitudes in the same bounded pass: peak and RMS dBFS (`null` for digital silence), percentage of samples at 16-bit full scale, `near_silence_hint` for RMS ≤ -60 dBFS, and `possible_clipping_hint` when at least 1% of samples reach ±32767/32768. These hints are **advisory**, not automated audio acceptance.
- **Unreleased post-v0.5.0 development source only:** bounded PCM16 internal-pause tracking now reports the longest span where every sample has absolute amplitude ≤ 32 (about -60 dBFS), **only when louder audio appears both before and after it**. `longest_internal_quiet_span_seconds` gives its duration and `longest_internal_quiet_span_start_seconds` gives a seek location in the WAV (or `null` if no enclosed span exists). `long_internal_pause_hint` triggers at 3 seconds or longer; `signal_review_required` combines this with existing RMS/clipping hints. Ordinary introductory/trailing silence does not become an internal-pause warning. No script text, voice ID, file path or waveform is exported by these numbers.
- A 3-second quiet passage can be intentional dramatic pacing, or it can indicate unwanted silence; a shorter gap can still be problematic. The amplitude threshold is fixed rather than adapting to the voice, so low-volume audio and background noise can cause false positives or false negatives. `human_review_required` is **always** true even when every automatic hint is false.
- No script, text, character/scene names, local file paths, voices, downloaded checkpoints or hardware identifiers are placed in the success JSON.

**What it explicitly cannot establish:** natural Hindi pronunciation, correct speaker identities, distinct character voices, emotional quality, absence of all clipping, subjective audio glitches, intended pauses, truthful script alignment, clean Windows desktop operation or model checkpoint authenticity. A warning-free file can still be poor narration or include pauses that evade these fixed thresholds. A file with a clipping/quiet hint may contain intentional silence or valid effects. All-zero WAVs still pass basic container validation but now trigger a quietness warning. These **simple level statistics are not a voice or speech-quality classifier**. Real human listening and the [Windows/Hindi acceptance protocol](windows-hindi-acceptance.md) are separate requirements.

Do not interpret `structure_valid: true` as `hindi_listening_verified: true`. The latter is always `false` in this automated result. No stable release or acceptance issue may be closed based on this report alone.
