# Windows 11 offline Hindi STT — human acceptance protocol

**Status: unexecuted manual QA checklist for post-v0.5.6 development source.** The [published v0.5.6 developer preview](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.5.6) **does not contain speech-to-text or microphone transcription**. Do not run this protocol against that old executable and then report STT as missing. Use only a trusted, explicitly built post-v0.5.6 development candidate. Passing GitHub CI or this documentation alone does not prove Hindi recognition.

This protocol complements [Windows/full-feature activation #129](https://github.com/sanskarIN/KathaSvara/issues/129) and [human Hindi audio acceptance #3](https://github.com/sanskarIN/KathaSvara/issues/3). Both remain independently open until actual evidence is recorded.

## Before testing

1. Record the **exact development commit SHA**, local app/Windows 11 x64/WebView2 version, Python version, architecture and coarse CPU/RAM (no username, private paths, microphone IDs or private recordings in a public report).
2. Verify that a **trusted Python 3.11 interpreter** and matching `services/inference` sources are selected. The unsigned developer EXE does not include Python, recognition weights or STT dependencies.
3. **Separately and explicitly** install the supported `.[stt]` extra in the selected interpreter, and select a locally installed, licensed **multilingual CTranslate2 faster-whisper model** containing nonempty `config.json`, `model.bin` and `tokenizer.json`. Check provenance and licensing yourself; KathaSvara never automatically fetches model weights through STT.
4. Prepare a short **original recording of your own voice**, or a recording whose transcription you have permission to produce. Keep it private. For the file path, use mono PCM16 WAV at 8, 16, 24 or 48 kHz, at most 60 seconds / 6 MiB. A 16 kHz WAV is the simplest baseline.
5. Do not change Windows security settings to bypass access controls. A denied microphone permission is a valid test case; use the user-selected WAV path as a fallback.

## Test matrix

Mark each item **PASS / FAIL / BLOCKED / NOT TESTED**, and describe the observed behavior rather than assuming success.

| ID | Action | Expected observation |
|---|---|---|
| STT-01 | Open Settings → Speech to text without consent | No microphone start, transcription, model load or network request |
| STT-02 | Run **Check offline STT setup (no model load)** with a valid local model | Interpreter/import/regular nonempty file checks only; no transcript and no inference |
| STT-03 | Select an incomplete model folder or a zero-byte required model file | Fixed actionable setup failure; no claim of model readiness or private path shown |
| STT-04 | Choose a short valid Hindi PCM16 WAV and run **Check selected WAV signal (no model)** | WAV shape and conservative signal hints shown without recognized text or model load |
| STT-05 | With explicit consent, transcribe a genuine Hindi WAV offline | Actual model-returned Devanagari text appears for **human review**; verify against spoken words and note errors |
| STT-06 | Present silent/DC-only WAV input | No heavy recognition model started for unusable waveform; fixed guidance instead of invented text |
| STT-07 | Without microphone consent, select **Start microphone recording** | Control remains disabled; no native permission prompt or captured audio |
| STT-08 | Give microphone consent, then start/stop a short clearly spoken sample | Windows/WebView2 permission behavior observable; no automatic transcription; explicit button offered only when a usable WAV exists |
| STT-09 | With microphone muted, capture digital silence or near silence | No recorded-audio transcript button; input-level guidance and released microphone tracks |
| STT-10 | Capture a constant/DC-only test signal, where feasible | No transcript button; fixed missing-varying-signal guidance, no model load |
| STT-11 | Cancel a pending microphone permission prompt, or deny access | UI becomes idle; late permission grant does not retain a live recording |
| STT-12 | Disconnect input, withdraw consent, hide the window or leave Settings while capturing | Capture stops/discards, no partial WAV offered or private details exposed |
| STT-13 | Let an active capture reach the 30-second limit | Capture automatically stops, releases tracks and requires another explicit action before offline transcription |
| STT-14 | Explicitly transcribe a captured non-silent microphone WAV | Actual local model text requires review; no spontaneous insertion into the story editor |
| STT-15 | Use **Discard microphone audio** and clear/revoke the session | Memory-only recording is no longer offered; no retained temporary recording after normal completion |
| STT-16 | Recheck offline behavior with network disconnected after dependencies and weights are installed | Local transcription still works, or the exact offline dependency blocker is recorded; no automatic online model selection |
| STT-17 | Repeat with a noisy room, different speech volume and Windows input device | Record intelligibility, clipping, silence and microphone UX honestly; no automated audio-health result claims linguistic correctness |
| STT-18 | Repeat TTS separately with the existing real-Hindi smoke-test guide | Do not confuse STT recognition with Chatterbox TTS generation; verify actual speech playback and export independently |
| STT-19 | In an isolated disposable Windows test profile, force-exit during a consented microphone transcription, then after the two-hour minimum age restart a development build with crash recovery; also check a recent test scratch WAV and unrelated files | Old app-generated UUID-v4 scratch WAV is gone after restart; recent/nonmatching/user WAV files remain; no directory traversal, printed private paths or model/network activity from recovery. Record **BLOCKED** unless tested safely on real Windows; deletion is not secure erasure |

**Important:** A valid WAV signal does not prove that a person spoke Hindi. Near-silence and DC-only checks are heuristics, not speech activity detection, and a model can still produce wrong words for noisy or unusual audio. Do not call a machine transcript “accurate” without a human comparison.

## Safe evidence template

Copy into the appropriate manual acceptance issue **only after running the test**:

```text
KathaSvara source SHA:
App candidate (development build, not published v0.5.6):
Windows / WebView2 version (coarse):
Python 3.11 / STT package version:
Multilingual local-model variant/revision and license verified:
CPU / RAM (coarse); network enabled or disabled:
Test IDs with PASS / FAIL / BLOCKED / NOT TESTED:
Short Hindi transcript accuracy observations (no private recording attached):
Silent/muted/disconnected microphone results:
Temporary WAV cleanup and consent-withdrawal results:
Crash-leftover recovery STT-19 status (isolated Windows fixture, not secure erasure):
Known failures / next reproduction steps:
Human tester reviewed real Devanagari output? YES / NO
```

Do **not** post your microphone recording, private filenames, absolute paths, device identifiers, consented third-party voice references, access tokens or model files.

## Release decision

A passing 5/5 PR check and an unsigned EXE build only establish tested source/build integration. **Do not declare the application stable, standalone, fully offline out of the box, or Hindi-recognition verified** without a licensed real model, hands-on Windows permission testing, reviewed original speech/transcript pairs and documented results. Keep v0.5.7 publication as a separate manually controlled decision.
