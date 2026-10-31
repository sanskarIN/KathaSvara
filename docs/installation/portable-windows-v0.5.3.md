KathaSvara v0.5.3 — Unsigned Windows x64 experimental developer executable
===========================================================================

NOT A COMPLETE INSTALLER. NOT STABLE. v0.5.3 is NOT published merely because
this documentation exists; always verify the actual GitHub prerelease and its
assets at https://github.com/sanskarIN/KathaSvara/releases/tag/v0.5.3.

This Windows x64 developer EXE is UNSIGNED and UNBUNDLED. It does not ship
Python 3.11, Chatterbox Multilingual TTS, PyTorch, model checkpoints,
voice weights, or any ready-to-use voice. No actual clean-Windows launch,
real Hindi narration, pronunciation quality, or distinct actor voices have
been manually verified (issue #3). Do not bypass Windows security warnings.

Required external setup:
  - A configured, compatible Python 3.11 interpreter and inference sources.
  - Compatible NumPy, SoundFile, PyTorch and chatterbox-tts packages.
  - Authorized, separately obtained model weights under upstream terms.
  - KATHASVARA_PYTHON (absolute interpreter path).
  - KATHASVARA_INFERENCE_DIR (absolute services/inference directory).

Optional developer-only CPU recovery:
  KATHASVARA_TTS_DEVICE=cpu
This skips CUDA/MPS detection in the speech adapter. It cannot fix missing
or incompatible CPU speech dependencies and may be substantially slower.
Unset or auto uses the ordinary CUDA -> MPS -> CPU selection.
The source helper scripts/windows/launch-with-audio.ps1 supports -CpuOnly
and -DoctorOnly (without loading weights). Real model speech requires an
explicit -VerifyHindiSpeech or an intentional in-app Generate action.
Never run weight downloads or dependency installations silently.

The actual audio generator should produce a genuine Hindi PCM16 WAV. Its
preflight/level/silence checks and automated synthetic fixtures do not
prove naturalness, intelligibility, correct pauses or unique speaker voices.
Subtitle cue timing is based on measured segment lengths, not per-word
forced alignment. Listen to real output and independently inspect SRT cues.

Release integrity (only if the prerelease is actually published):
  KathaSvara-v0.5.3-dev-win64.exe
  README.txt
  SHA256SUMS.txt
Download all three from the official prerelease and verify the EXE's SHA-256
against the checksum file before trusting the artifact. An EXE built by
GitHub Actions is not a signed installer or proof of Windows launch.

Documentation: https://github.com/sanskarIN/KathaSvara
Audio support: docs/installation/audio-troubleshooting.md
Manual acceptance: https://github.com/sanskarIN/KathaSvara/issues/3
Release ordering: https://github.com/sanskarIN/KathaSvara/issues/81
License: MPL-2.0 (app code); third-party model/dependency licenses separate.
