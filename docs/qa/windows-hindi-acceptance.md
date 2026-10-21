# Windows and Hindi narration acceptance protocol (manual, not yet passed)

**Project:** KathaSvara — experimental desktop. **First reviewed release:** [v0.4.2](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.4.2). **Tracking:** [issue #3](https://github.com/sanskarIN/KathaSvara/issues/3).

This checklist is deliberately **not an automated pass certificate**. Existing GitHub workflows compile/tests the source and unsigned developer EXE; they do **not** prove that the application launches on a clean Windows machine, that real Chatterbox model weights can be obtained and loaded, or that Hindi speech is natural. Do not close issue #3 or announce a stable release based only on mocked tests or these blank checklists.

## 1. Prepare a trusted test machine

Use Windows 11 x64 with a supported WebView2 runtime and Python 3.11. Record the OS build, RAM and model-compatible CPU/GPU/VRAM (coarse characteristics only). Do not include local usernames, sensitive file paths, access tokens or machine identifiers in public reports.

Use the developer executable only from the [verified GitHub release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.4.2) and inspect `README.txt`. Compare SHA-256 using PowerShell:

```powershell
Get-FileHash -Algorithm SHA256 .\KathaSvara-v0.4.2-dev-win64.exe
```

The expected digest is recorded in the release's `SHA256SUMS.txt`. This is an **unsigned, unbundled executable**, not an MSI/NSIS installer; do not bypass a security block or turn off Windows security measures. A clean-machine test must distinguish a refusal to run an unsigned test binary from an actual application defect.

The test operator is responsible for separately reviewing and accepting applicable voice-model terms. The EXE does **not** contain Python, PyTorch, Chatterbox or model weights.

## 2. Set up the supported runtime

From the checked-out repository root in PowerShell:

```powershell
cd services/inference
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[tts,test]"
python -m pytest -q
$env:KATHASVARA_PYTHON = (Resolve-Path .\.venv\Scripts\python.exe).Path
$env:KATHASVARA_INFERENCE_DIR = (Resolve-Path .).Path
echo '{"action":"diagnose"}' | python -m kathasvara.cli
```

Record whether Python 3.11 is found, whether `numpy`, `soundfile`, `torch` and `chatterbox` are discoverable, and whether the app's **Inspect local TTS setup** screen agrees. The diagnostic must report `audio_synthesis_verified: false`; module discovery alone is not a full model test.

For a *separately authorized real-model test*, run `scripts/smoke_hindi.py` from the repository root with the configured Python 3.11 executable, a **new absolute** WAV destination and the explicit `--allow-model-downloads` opt-in. This command may trigger a model download; it is not part of CI and must never run without checking available storage, expected network access and terms. It must not overwrite an existing recording.

## 3. Desktop feature walkthrough (actually click the controls)

| Gate | Human action | Pass criterion |
| --- | --- | --- |
| Launch | Open the developer EXE on the stated Windows machine | UI opens and controls are usable without crashing |
| Persist | Create a v2 Hindi story with two scenes, save, close, reopen | Title, exact original script, reviewed spoken lines and speaker IDs persist |
| Speech preparation | Include narrator + named actor + one stage direction | Direction is not voiced; invalid actor remains unassigned until manually fixed |
| Pronunciation | Add one reviewed local glossary substitution; inspect the plan | Original text stays intact, substitution is visible and not duplicated |
| Scene selection | Run **Inspect selected scene (no model)** | Correct selected lines and chunk counts, no synthesis or model loading |
| Readiness | Run **Audit scene readiness (no model)** | Per-scene and full-story results distinguish failures and total limits |
| Privacy | Export **privacy-safe audit JSON** | Only sequential scene numbers, fixed reason codes, counts and explicit false model/audio flags |
| Rendering | Generate full story, selected scene and one spoken line independently | Real WAV produced, ordered dialogue, no false stage-direction speech |
| Export | Export WAV and measured SRT from the same generated scene | Suggested stems match; cue timestamps reflect dialogue audio and SRT opens in a player/editor |
| Recovery | Cancel between speech segments; inspect **Recent render history** | Local journal exists; retry is explicit and uses a fresh job; caches reused only for unchanged text/profile |
| Audio hygiene | Discard a preview and inspect local cache maintenance | No stale finished preview or old audio falsely marked current; no unintended project deletion |
| Trust | Attempt to save WAV or SRT over an existing file | Existing file is retained; export failure is surfaced safely |

Record **pass / fail / blocked / not tested** for every row. A build-only run must use **not tested** for desktop and real-voice rows.

## 4. Real Hindi listening acceptance — human only

Use an original, authorized 30–60-second narration sample with a narrator, Raja Bhoj, a farmer and a short quoted village reply; include punctuation, a number and one Hindi-English mixed phrase. The script is test data, not proof of a historical event. Obtain rights/consent for any reference clips; do not add real people's private voice recordings to public issues.

Listen to an independently generated WAV on actual hardware (headphones and speakers if available) and check all these aspects **by ear**:

- Hindi phoneme clarity, number pronunciation, name pronunciation and word boundaries
- Natural pauses at `।`, commas and sentence endings, without missing/repeated phrases
- Stable pacing and intelligibility across the whole sample, without clipping or severe artefacts
- Segment ordering, direction omission and correct association with the selected actor
- Whether distinct character identities genuinely exist; **do not** mark distinct voices accepted merely because the UI has multiple named character profiles
- Human-reviewed dialogue SRT text and per-segment cue onset/end timing; **not** word-level alignment
- Full-length export / playback where the WAV exceeds the in-app 25 MiB preview cap

If any aspect is unverified, mark it as **blocked** or **not tested**; do not infer a pass from a fake/mocked engine test, file existence, waveform length, diagnostics, or a checked UI review box.

## 5. Minimal, safe acceptance record

For each acceptance session, note the exact application commit/tag, date, platform + version (coarse), model package/checkpoint identifier and license (no auth tokens), sample-rate/duration and a local SHA-256 digest of the reviewed audio, explicit test outcome for every gate, and a short description of any blocking problem. Do not publish script text, absolute paths, model credentials, speaker conditioning samples or full hardware serial numbers. Do not upload audio anywhere without the rights to do so.

**Disposition must be one of:** `pass`, `fail`, `blocked`, `not-tested`. A `pass` for real audio requires a named human reviewer who actually listened; an AI-generated synthetic test file alone cannot satisfy it. A pass on desktop controls does not imply that natural Hindi or distinct speaker voices passed.

Example private/local note template:

```text
Version/commit:
Review date:
Windows build and CPU/GPU class:
Python, Chatterbox and checkpoint versions:
Model license/weights authorized? Yes / No / Blocked
OS launch and controls: Not tested
Real Hindi speech listened to by human? No
Hindi pronunciation / pacing / artefacts: Not tested
Distinct voices: Not tested
Dialogue ordering / SRT alignment: Not tested
WAV export and clean-device usage: Not tested
Issues reproduced:
Release decision: BLOCKED until the manual requirements are verified
```

**Do not change these blank outcomes to Pass automatically.** Once there is genuine evidence, summarize it in [acceptance issue #3](https://github.com/sanskarIN/KathaSvara/issues/3) before proposing any stable release.
