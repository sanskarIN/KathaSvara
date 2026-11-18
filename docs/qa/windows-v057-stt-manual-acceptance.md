# KathaSvara v0.5.7 — Windows 11 and real Hindi STT acceptance matrix

**DRAFT / UNEXECUTED — NOT STABLE / NOT PUBLISHED.**
The current public experimental prerelease remains
[v0.5.6](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.5.6).
This protocol is for future, explicitly authorized Windows x64 **developer
candidates** containing post-v0.5.6 STT. It is not evidence that anyone has
performed the checks. No model or recording is downloaded by reading this file.

## Preconditions and evidence handling

- Test on a Windows 11 x64 system with Microsoft Edge WebView2 Runtime.
- Obtain the trusted candidate through its original GitHub Actions run and
  retain **README.txt**, **SHA256SUMS.txt**, source SHA and workflow run ID.
  Its unsigned, unbundled EXE is not a complete installer or trusted publisher
  signature; never disable Windows security protections to use it.
- Have an independent **Python 3.11** environment, matching v0.5.7
  `services/inference` checkout and explicit opt-in speech dependencies.
  Separately obtain only model weights you are authorized to use. STT requires
  a multilingual local CTranslate2 faster-whisper model. The selected
  `config.json`, `model.bin` and `tokenizer.json` must be nonempty.
- Use a brief recording of your own voice (or one with clear consent).
  For WAV/file STT, supply mono PCM16 audio of at most 60 seconds and 6 MiB.
  The desktop microphone path is capped at 30 seconds.
- Record only generic outcomes and the workflow/source SHA in shared issue
  reports. Do not paste your private WAV, model paths, transcript, device
  identifiers, credentials or unauthorized third-party recordings into
  public logs. Keep human listening/word comparisons local.

## Stage A — candidate integrity and Windows UI

Run this read-only source helper with the EXE and its same-artifact checksum
manifest side by side:

```powershell
.\scripts\windows\inspect-desktop-candidate.ps1 `
  -ExecutablePath "C:\trusted-candidate\KathaSvara-unreleased-dev-win64.exe"
```

Expected: Windows x64 PE and SHA-256 checks pass; WebView2 registration
is a **diagnostic hint**, not proof of a working rendered window. Start only
a trusted candidate afterwards. Verify the UI actually appears, Settings
opens, native Python/source/model/WAV pickers work, and Windows permission
prompts behave as expected. Inspect the console or Windows logs locally if
the app is blank, but do not publish private paths. A successful compile or
WebView2 registration is **not** a pass for this stage.

## Stage B — model-free Python and STT preflight

From an intact v0.5.7 source checkout, select a configured Python 3.11
interpreter and run the standalone STT setup doctor:

```powershell
.\scripts\windows\launch-with-audio.ps1 -SttDoctorOnly `
  -SttModelPath "C:\your-licensed-multilingual-model"
```

Expected: fixed next-step guidance for the Python version, optional STT
package imports, and nonempty model files. It performs **no recognition**,
microphone capture, network access or model-weight load. If necessary,
explicit `-InstallSttDependencies` is the separate user-selected package
installation operation and may download Python packages, not model weights.
Do not confuse a green setup report with working Hindi recognition.

## Stage C — actual offline STT without WebView2

With a user-selected short mono PCM16 Hindi WAV and compatible installed
local model, deliberately opt into **real CPU inference**:

```powershell
.\scripts\windows\launch-with-audio.ps1 -VerifyHindiSttWav `
  -SttWavPath "C:\your-private-recording.wav" `
  -SttModelPath "C:\your-licensed-multilingual-model"
```

Expected: the real local faster-whisper worker completes within its
ten-minute bound, reports `language: hi`, a real-inference status, duration,
a speech-detected boolean and **only the transcript character count**.
The helper masks private path exceptions and never prints or stores the
recognized words. It cannot demonstrate that those words are correct.
Silence, DC-only WAVs, malformed files, incomplete local models, or unknown
Hindi support should fail before producing a purported successful transcript.
No remote transcription service or model-weight download is allowed here.

## Stage D — explicitly consented desktop speech-to-text

In Settings, independently verify:

1. Consent is required before microphone capture or transcription.
2. Selecting a local PCM16 WAV, a local model folder and running separate
   model-free STT/WAV preflight never silently loads weights or captures audio.
3. Start/stop/discard and the 30-second microphone cap work on the actual
   Windows audio input device. Test permission denial, device disconnection
   and near-silent input; no private WAV should remain after discard.
4. After explicit recognition, compare the resulting Hindi text with the
   original recording. Fix misheard words in the **review-only** draft and
   reconfirm before transferring to the story editor. Reject unsupported
   claims of 100% Hindi accuracy. Confirm replacing an existing story still
   prompts first.
5. Start recognition, then switch/clear the Python runtime. The previous
   private transcript, consent and microphone sample must be retired, and a
   late old-runtime result must never reappear.
6. Restart the app and verify that unreviewed text and private session paths
   were not persisted. Inspect only the app-owned scratch directory for
   expected cleanup; do not inspect other users' files.

## Stage E — independent text-to-speech, audio and export checks

This is **separate** from the STT result. Run the model-free TTS doctor, then
only with explicit consent and licensed model access run the real Hindi TTS
smoke test. Listen to the actual synthesized WAV for intelligible Hindi,
silence, clipping, voice consistency and pauses. Verify preview playback and
WAV/SRT exports on Windows; do not infer audio quality from RIFF structure,
signal levels, CI or successful STT.

## Evidence matrix — all results initially NOT TESTED

| Gate | Expected evidence | Actual result |
| --- | --- | --- |
| A1 | EXE and same-artifact SHA256 match; source SHA identified | NOT TESTED |
| A2 | WebView2 and native desktop UI actually function on Windows 11 | NOT TESTED |
| A3 | Native file/folder pickers work | NOT TESTED |
| B1 | Correct Python 3.11/source and model-free STT doctor status | NOT TESTED |
| C1 | Real local model successfully transcribes a short consented Hindi WAV | NOT TESTED |
| C2 | No download, transcript exposure or unrequested microphone access | NOT TESTED |
| D1 | Windows microphone permissions and capture/stop/discard | NOT TESTED |
| D2 | Human checks and corrects recognized Hindi words before story import | NOT TESTED |
| D3 | Runtime switch/clear invalidates old STT consent and text | NOT TESTED |
| D4 | No unintended persisted STT recording or transcript after restart | NOT TESTED |
| E1 | Real Hindi narration is understandable when played locally | NOT TESTED |
| E2 | Exported WAV and SRT are valid and manually checked | NOT TESTED |

**Acceptance rule:** do not turn an unchecked gate into PASS based on a
source test, synthetic WAV, checksum, import-only probe, or model-free CI.
Record the actual Windows build SHA, date, independent observations and any
failed stage, without exposing private user data. Keep [manual acceptance
issue #3](https://github.com/sanskarIN/KathaSvara/issues/3) and
[Windows activation issue #129](https://github.com/sanskarIN/KathaSvara/issues/129)
open until the relevant real-device evidence exists.
