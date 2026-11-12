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
faster-whisper package, and whether the user-chosen model folder contains
the three expected **nonempty regular model files** (not symlinks).
File presence and nonzero size cannot prove model integrity or language support.
The check does **not** load model weights, transcribe, create
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

The original v0.5.6 STT source supported an **existing file** only.
The new development branch adds a short microphone capture path with
explicit permission and a separate transcription action. It requires **mono, 16-bit PCM WAV**, sample rate 8, 16, 24 or
48 kHz, duration **1 frame to 60 seconds**, and size **44 bytes to 6 MiB**.
Larger/multichannel/compressed recordings must be converted externally with
trusted local tooling. Paths remain session-local and are never displayed in
UI status. Input audio is never uploaded by KathaSvara, and no transcript is
silently written to the story editor or persistent project.

## Experimental microphone capture (post-v0.5.6 development source)

A separate, opt-in **microphone → short Hindi transcript** path is now
implemented in the development source. It is **NOT present in the already
published v0.5.6 Windows executable**, and native WebView2 / Windows
microphone permissions and real Hindi recognition have not been verified on
a user's machine.

1. In Settings → Speech to text, choose an existing local offline
   faster-whisper model and run **Check offline STT setup (no model load)**.
2. Read the separate permission checkbox. Clicking **Start microphone
   recording** uses the webview's `getUserMedia({audio:...})` and asks the
   operating system/webview for microphone access when required. It does
   **not** bypass a denied permission or access the camera.
   While Windows/WebView2 is requesting access, **Cancel microphone permission
   request** withdraws the app's capture request. The OS permission dialog
   itself may remain open because browser APIs do not guarantee cancellation
   of the native prompt. If the OS grants access afterward, KathaSvara stops
   that late stream before creating a recording. The same cleanup applies when
   consent is withdrawn, Settings is left, the window is hidden or the app
   closes. Pending Web Audio startup is also aborted to release tracks.
3. A visible recording indicator stays on screen. Click **Stop recording**
   or let the 30-second cap stop capture. The next development source
   uses bounded Web Audio raw PCM capture, then converts the samples directly
   to 16 kHz mono PCM16 WAV, avoiding MediaRecorder's compressed-container
   decoding step. When input is 44.1/48 kHz, a bounded windowed-sinc
   low-pass filter reduces out-of-band aliasing before downsampling.
   Filter coefficients are cached per recording to avoid repeating costly
   trigonometric calculations for every output frame; phase rounding is
   bounded and tested against a direct numerical reference. This improves
   capture responsiveness but does not prove Hindi recognition accuracy.
   An unsupported Web Audio capture graph fails safely and releases
   microphone tracks. If an already recording input device disconnects or
   access is revoked, the capture discards partial audio, releases tracks
   and reports a fixed error instead of presenting an incomplete WAV.
   The completed 16 kHz WAV also receives a **model-free microphone signal
   check** before any transcription is offered. Digital or near-silent input
   (raw RMS at or below -60 dBFS) and DC-only signal are discarded with
   fixed Windows input-device guidance rather than loading a model that could
   hallucinate words. These numerical hints cannot establish that speech
   occurred, that Hindi is intelligible, or that a microphone works on real
   Windows hardware.
   Captured audio is held in memory only when the signal preflight passes;
   **it does not automatically launch the STT model**.
4. With consent still checked, click **Transcribe recorded Hindi offline**
   to send the bounded WAV to local Tauri IPC. The native bridge creates a
   random private temporary WAV, invokes the previously configured local
   offline recognizer, then deletes the temporary WAV on completion or
   failure. It does not save audio into a project, upload data, or
   download recognition model weights.
5. **Discard microphone audio** removes the in-memory recording. Navigating
   away from Settings, hiding or closing the window and withdrawing
   consent also stop active microphone tracks; invalid/oversized recordings
   are rejected with fixed user-facing guidance.

## Microphone permission and device error guidance (development source)

A denied or unsupported recording request now produces **fixed, actionable
guidance**, based only on the browser's standardized error category. Windows
privacy blocking, absence of a usable input device, a busy or unreadable
microphone, unsupported constraints, an inactive window and unsupported
WebView2 capture APIs have separate user-facing hints. The app never renders
raw browser/OS error text, device identifiers, file paths, stack traces or
constraint details. Unknown errors use generic guidance.

These messages are troubleshooting *hints*, not a diagnosis of a user's
particular Windows permissions. They cannot change Windows settings, force
access to a microphone, substitute for consent or certify that STT works.
A user may instead select a short existing PCM16 WAV and transcribe it
without granting any microphone access.

The Web Audio compatibility capture uses ScriptProcessorNode, which is
deprecated but currently supported by the targeted WebView2 runtime. It
feeds silence to the audio output; it never monitors recorded microphone
audio through the speakers. Replace it with AudioWorklet only after
hardware permission and cancellation behavior are manually accepted.
Passing mocked Web Audio tests or a Windows build is not evidence that
WebView2 or Windows actually granted a microphone.

The Tauri bridge validates canonical PCM16 WAV headers, mono 16 kHz sample
rate, encoded size and short duration independently of the webview.
WebView2's microphone permission prompt and the Windows Settings →
Privacy & security → Microphone options must be checked manually when the
browser engine denies access. Windows audio input device availability is a
separate dependency. No microphone access is added to the Tauri
`dialog:allow-open` capability: it is a separate webview/OS permission.

**Human acceptance still required:** Windows microphone permission prompt,
start/stop indicator, track release after Cancel/Discard/navigation,
automatic timeout, device unplug/revocation, silent and DC-only rejection, audibility, noise handling, actual Hindi
accuracy, CPU/memory, temporary-file cleanup and transcription into the
editor. A JS test or Windows compilation is not evidence these work on
a real user's microphone.

## Model-free WAV signal preflight (post-v0.5.6 development)

With a user-selected WAV, the new **Check selected WAV signal (no model)**
action examines the actual RIFF layout, sample frames and conservative
level hints locally, before recognition. It flags near-silence, a DC-only
signal, possible clipping and long internal pauses. No microphone access,
download, model load, transcript generation or network request is performed
by this preflight. The returned report does not expose the private file path
or its SHA-256.

If a recording is effectively silent or DC-only, actual transcription
refuses to load a model, helping avoid hallucinated words from silent audio.
These are simple waveform heuristics, **not speech activity detection or
Hindi intelligibility measurement**. A readable WAV or absence of hints
never establishes that a person spoke or that the text will be correct.
Clipping/long pauses are advisory warnings, not automatic rejections.

## Limits and acceptance

- Neither tests with mocked Whisper nor a passing build prove actual Hindi
  recognition accuracy or performance on an end-user machine.
- Real-model accuracy and CPU/RAM consumption need explicit Windows 11 test
  evidence; transcripts require human review before story use.
- The local model and STT Python dependencies are **not bundled**, just as
  TTS dependencies and weights are not bundled in the developer EXE.
- Continuous dictation, translation, SRT generation from recognized
  words, advanced recording management and long recordings remain
  **future separate features**. Do not advertise them as implemented.
- The release process for the next version remains manually controlled; this
  source PR does not publish an executable or create a tag.

See [Windows full-feature activation #129](https://github.com/sanskarIN/KathaSvara/issues/129)
and [human Hindi acceptance #3](https://github.com/sanskarIN/KathaSvara/issues/3).
