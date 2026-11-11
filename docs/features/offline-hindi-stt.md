# Offline Hindi speech-to-text — experimental source feature

**Status: draft source implementation; not in published v0.5.6.** The
[v0.5.6 developer EXE](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.5.6)
has text-to-speech and WAV review, but does **not** include a speech-to-text
engine. Do not confuse the TTS import probe, synthetic WAV doctor or the real
Hindi TTS smoke test with speech recognition.

## Desktop file-picker regression and no-model setup checks

The published v0.5.6 build predates speech-to-text and cannot recognize
spoken input. A subsequent audit also found that the Tauri v2 main-window
capability listed `dialog:allow-save` but omitted `dialog:allow-open`,
blocking the local file and folder pickers in a compiled desktop EXE.
The next development change explicitly grants only `dialog:allow-open` and
`dialog:allow-save` to the app's main window; it does not grant general
filesystem read/write permissions or OS microphone access.

After opening **Settings → Speech to text**, select an existing local model
folder and choose **Check offline STT setup (no model load)**. This checks
Python 3.11, whether the selected environment can import the installed
faster-whisper package, and whether the user-chosen model folder has the
expected local files. It does **not** load model weights, transcribe, create
a recording, contact a model repository or verify Hindi recognition quality.

Follow the first reported action: correct the Python interpreter, explicitly
install `.[stt]` in that interpreter, or choose a complete already-installed
local model. A green preflight means **only** imports and file checks passed.
The actual WAV and recognition model still require a separate consented run.

## Initial local recording → Hindi text workflow

1. Build the source after this feature PR has passed CI and merged. Use a
   trusted Python **3.11** interpreter and the matching inference sources.
2. Review the independent license and hardware requirements for an installed
   CTranslate2-converted **multilingual faster-whisper** model. Obtain it
   separately under its applicable terms. The feature does **not** download,
   select a remote model name or contact an online API.
3. Install the optional STT dependencies in the chosen local Python
   environment: `python -m pip install -e ".[stt]"` in `services/inference`.
   This is a separate, explicit dependency installation; it is not part of
   the shipped EXE, no-model TTS checks or STT execution.
4. In Settings → **Speech to text**, select a short WAV recording you own or
   have permission to transcribe, then the existing local faster-whisper model
   folder containing `model.bin`, `config.json` and `tokenizer.json`.
5. Read and check the local processing consent box, then choose **Transcribe
   Hindi WAV offline**. The engine uses CPU INT8, language `hi`, and
   `local_files_only=True`, and displays only model-returned text.
   Review every word against your recording. The editor can accept a reviewed
   transcript of at most 3000 characters after overwrite confirmation.

The first version supports an **existing file**, not live microphone
recording. It requires **mono, 16-bit PCM WAV**, sample rate 8, 16, 24 or
48 kHz, duration **1 frame to 60 seconds**, and size **44 bytes to 6 MiB**.
Larger/multichannel/compressed recordings must be converted externally with
trusted local tooling. Paths remain session-local and are never displayed in
UI status. Input audio is never uploaded by KathaSvara, and no transcript is
silently written to the story editor or persistent project.

## Limits and acceptance

- Neither tests with mocked Whisper nor a passing build prove actual Hindi
  recognition accuracy or performance on an end-user machine.
- Real-model accuracy and CPU/RAM consumption need explicit Windows 11 test
  evidence; transcripts require human review before story use.
- The local model and STT Python dependencies are **not bundled**, just as
  TTS dependencies and weights are not bundled in the developer EXE.
- Microphone capture, continuous dictation, translation, SRT generation from
  recognized words and long recordings remain **future separate features**.
  Do not advertise them as implemented.
- The release process for the next version remains manually controlled; this
  source PR does not publish an executable or create a tag.

See [Windows full-feature activation #129](https://github.com/sanskarIN/KathaSvara/issues/129)
and [human Hindi acceptance #3](https://github.com/sanskarIN/KathaSvara/issues/3).
