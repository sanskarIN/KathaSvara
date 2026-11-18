# Offline Hindi speech-to-text — experimental source feature

**Status: draft source implementation; not in published v0.5.6.** The
[v0.5.6 developer EXE](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.5.6)
has text-to-speech and WAV review, but does **not** include a speech-to-text
engine. Do not confuse the TTS import probe, synthetic WAV doctor or the real
Hindi TTS smoke test with speech recognition.

## Switching the local Python runtime

When you successfully select or clear the Python interpreter and matching
inference folder in Settings, any old STT transcript draft, previous setup/WAV
preflight and microphone recording are discarded, and STT consent is reset.
Running transcription finishes with its existing single-flight lock, but a
late reply from the previous runtime cannot restore private words in the UI.
Recheck the new runtime and grant fresh consent before transcribing again.
Canceling a file picker or rejecting an invalid interpreter does not change
the active runtime or automatically discard a previously reviewed draft.

## Private transcript and consent lifecycle

In the development source, selecting a **new WAV** or **new STT model folder**
retires any previous transcript review draft and any microphone sample, and
unchecks the permission-to-transcribe box. You must review the selected input,
recheck the separate local STT setup as appropriate, and grant fresh consent
before transcription. Canceling a file or folder picker leaves the existing
selection, consent and reviewed text unchanged. A pending native recognition
job keeps its busy lock until it exits; its result cannot restore a draft
invalidated by a later selection.

When the desktop window becomes hidden, the development source also withdraws
STT consent, retires previous private transcript/review and setup results, and
discards microphone capture. An in-flight old result is ignored when the
recognizer eventually finishes. This is a privacy safeguard, not a claim that
Windows or WebView2 has passed physical microphone tests.

## Transcript text integrity at the three trust boundaries

Recognized words are **untrusted model output**, even when processing is
entirely offline. Development-source Python, native Rust IPC and React
now reject C0/C1 control characters (except newlines and tabs), and
invisible Unicode directional formatting controls (Arabic letter mark,
left-to-right/right-to-left marks, bidi embeddings and overrides, and
isolate controls). Such characters can otherwise disguise the visible
reading order of words copied into a story script. If the model emits
these characters, the result is rejected with fixed error guidance;
the app does **not** silently strip or rewrite recognition output.

**Indic shaping stays intact:** U+200C (zero-width non-joiner), U+200D
(zero-width joiner) and Devanagari combining vowel/virama marks are
allowed so Hindi conjuncts are not damaged. The **editable transcript review**
also checks the same unsafe controls after every manual correction or paste.
If detected, the review-confirmation checkbox and copy-to-story action remain
disabled and a fixed, non-leaking guidance message explains that hidden
characters must be removed. Because these characters are difficult to locate
visually, an explicit **Remove unsupported text formatting** button is offered.
Only clicking that button removes the known rejected characters; it does not
delete Hindi ZWNJ/ZWJ or ordinary Devanagari marks. The corrected text stays
editable and requires a **fresh manual review** before copying. The click
handler rechecks the text, not just the button state. No pasted text is silently
stripped, rewritten or copied into the story without fresh approval. This is a text-integrity check, not proof
of correct Hindi recognition, audio quality or full Unicode spoofing
resistance; human transcript review is still required.

## Desktop file-picker regression and no-model setup checks

The published v0.5.6 build predates speech-to-text and cannot recognize
spoken input. A subsequent audit also found that the Tauri v2 main-window
capability listed `dialog:allow-save` but omitted `dialog:allow-open`,
blocking the local file and folder pickers in a compiled desktop EXE.
The merged post-v0.5.6 development source now grants only `dialog:allow-open`
and `dialog:allow-save` to the app's main window. This is a source change,
**not** a retroactive update to the published v0.5.6 EXE; it does not grant
general filesystem read/write permissions or OS microphone access.

After opening **Settings → Speech to text**, select an existing local model
folder and choose **Check offline STT setup (no model load)**. This checks
Python 3.11, whether the selected environment can import the installed
faster-whisper package, and whether the user-chosen model folder contains
the three expected **nonempty regular model files** (not symlinks).
File presence and nonzero size cannot prove model integrity or language support.
If a required model file is absent or zero bytes, the local Python worker and
desktop can now select **fixed, actionable incomplete-model guidance** rather
than a generic inference error. Only exact KathaSvara-owned error messages
are mapped; unknown native errors, private filesystem paths, credentials,
and malformed worker text are not echoed into Settings. The error explains
setup, not actual model integrity, compatibility or Hindi accuracy.
The check does **not** load model weights, transcribe, create
a recording, contact a model repository or verify Hindi recognition quality.

Follow the first reported action: correct the Python interpreter, explicitly
install `.[stt]` in that interpreter, or choose a complete already-installed
local model. A green preflight means **only** imports and file checks passed.
The actual WAV and recognition model still require a separate consented run.

**Hindi model compatibility (development source):** An installed CTranslate2
checkpoint must genuinely support multilingual recognition. Certain
faster-whisper versions silently interpret `language="hi"` as English when
given an English-only model. The offline transcription worker now checks the
loaded model's CTranslate2 multilingual capability **before** attempting
recognition. If the model is English-only or cannot confirm its capability, the
user receives fixed, private-path-free guidance to select a multilingual
model instead. The no-model folder/import readiness probe cannot know this;
the runtime check does **not** assert actual Hindi transcription accuracy,
download a replacement model, or bypass the need for human review.

## Initial local recording → Hindi text workflow

1. Build a trusted **post-v0.5.6 development source commit** that contains
   STT. Use a trusted Python **3.11** interpreter and matching inference sources.
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
   Review every word against your recording. In the **editable transcript
   review field**, correct incorrect Hindi words, compare with the original
   audio and explicitly confirm review. Changing the text revokes that
   confirmation until you review it again. Only then may you copy a
   nonempty, at-most-3000-character reviewed draft to the story editor, with
   an additional overwrite confirmation if the editor already has text.
   **Discard transcript** clears the in-memory review draft without changing
   the story. Recognition results never silently overwrite story text.

On development builds containing the recording-integrity guard, the worker
checks that the WAV's SHA-256 content still matches the original inspected
recording after the model loads and again after transcription. If the file
changed while recognition was running, it discards the transcript and asks
you to reselect the WAV. This protects against ordinary concurrent edits; it
does not lock the file against malicious replacement or prove Hindi accuracy.
The fingerprint remains internal and is not added to public setup results.

The first post-v0.5.6 STT development change supported an **existing file** only.
Later development added a short microphone capture path with
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
   to send the bounded WAV to local Tauri IPC. The Rust bridge independently
   checks the canonical WAV, then rejects a silent/near-silent or DC-only
   recording **before any temporary file is created**. It also checks that
   the separately selected offline model folder contains the expected
   nonempty regular files; this does not load or verify model weights.
   For otherwise eligible input, the native bridge creates a random private
   temporary WAV, invokes the previously configured local offline recognizer,
   then deletes the temporary WAV on completion or failure. If Windows
   forcibly terminates the app or machine before normal cleanup, a private
   scratch file may remain. On a subsequent app launch, a bounded local scan
   best-effort removes only its own regular UUID-v4 WAV files aged at least
   two hours from the dedicated `stt-microphone` scratch directory. It will
   not traverse symlinks, enter subfolders or touch user-selected recordings,
   and cleanup never starts a model or contacts the network. Deletion is not
   secure file erasure, and this mitigation still needs real Windows crash
   acceptance testing. It does not save audio into a project, upload data,
   or download recognition model weights.
5. **Discard microphone audio** removes the in-memory recording. Navigating
   away from Settings, hiding or closing the window and withdrawing
   consent also stop active microphone tracks; invalid/oversized recordings
   are rejected with fixed user-facing guidance.

## Cancel active offline Hindi transcription (development source)

When a user explicitly starts recognition from either **Selected Hindi WAV**
or the **short microphone recording**, Settings now offers **Cancel active
Hindi recognition**. The desktop sends a fresh cryptographic UUID-v4 with
each native transcription request; the cancel command targets **only that
matching STT job**. A cancellation arriving before native startup is
remembered briefly in a bounded UUID-specific registry, so a queued start
cannot unexpectedly load the model after the user cancels. A stale cancel
cannot interrupt a newer STT request or an unrelated TTS/story-render job.

On cancellation, the frontend immediately withdraws STT consent and discards
any draft or captured in-memory microphone WAV. It keeps recognition controls
locked until the existing native worker actually exits. Rust's child process
watchdog checks the cancellation signal during the STT request and asks the
OS to terminate the local Python recognizer; the Rust microphone scratch WAV
is removed through its existing guard on both cancellation and normal exit.
The request does **not** delete any user-selected original WAV or installed
model folder, and no audio, private path or recognized words appear in
the cancellation response. A fixed message is used for cancellation failure.

Cancellation is best-effort for process termination: real Windows process
termination timing, CPU/memory release and temporary scratch cleanup still
need hands-on Windows/WebView2 acceptance, including cancel during a slow
model load and near-completion. A Python process may not stop instantaneously.
**No model load, real microphone or Hindi recognition is exercised by the
new automated cancellation tests.**

## No-permission microphone API availability check (development source)

Settings → **Speech to text → Record Hindi from microphone** now offers
**Check microphone API availability (no permission)**. This button checks
only whether the current WebView appears to support a secure context,
`navigator.mediaDevices.getUserMedia`, Web Audio `AudioContext`, and the
local PCM capture compatibility API. The result explains the first missing
browser capability and suggests checking Windows WebView2, or choosing an
existing local WAV instead. The report contains no microphone name, input
device identifier, path or recording.

**It does not call `getUserMedia`, enumerate devices, construct an
`AudioContext`, request OS permission, record any audio, start Python or load
an STT model.** A report of **APIs present** means only that the JavaScript
interfaces exist. It does not demonstrate that Windows privacy permissions
are granted, a microphone is connected, audio can be captured, or that Hindi
recognition works. Actual permission and capture can only be tested with
the separate consented **Start microphone recording** action and a real
Windows 11/WebView2 device. The availability check cannot fix hardware
or install missing speech dependencies.

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

- Review is explicitly user-controlled. The app cannot determine if a human
  actually listened, and checking the review box never verifies transcription
  accuracy. An unreviewed, empty or overlong transcript cannot replace a
  story. Editing after review requires reconfirmation, and revoking processing
  consent or leaving Settings discards the review draft. A late recognition
  result cannot reopen the review after Settings is left; the running local
  worker still finishes or times out under its native timeout guard.

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

## Reproducible human acceptance on Windows 11

Use the [offline Hindi STT Windows acceptance matrix](../qa/windows-offline-hindi-stt-acceptance.md)
for exact real-device checks, expected observations, and a privacy-safe evidence
template. It is an **unexecuted procedure**, not acceptance evidence. Record
results under the existing [Windows activation issue #129](https://github.com/sanskarIN/KathaSvara/issues/129)
and keep real-Hindi playback acceptance separately in [issue #3](https://github.com/sanskarIN/KathaSvara/issues/3).
