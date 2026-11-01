# Why Hindi audio may not generate in a Windows developer EXE

**Status:** KathaSvara's current published Windows EXE is an **unsigned, unbundled developer preview**, **not** a ready-to-use offline speech installer. It includes the desktop UI, but not the Python 3.11 inference service, Chatterbox package, PyTorch, or model checkpoints. Passing the project's model-free CI tests cannot prove real Hindi speech or reliable playback.

## What the generator is for

1. **Voice Studio:** narrate a short Hindi text as a WAV with Chatterbox Multilingual and the supported `hi` language ID.
2. **Characters & Scenes:** parse a labeled Hindi script, manually assign known speakers, render their lines, and export measured dialogue SRT. Different character labels **do not yet imply distinct voice identities**.
3. **Production review:** listen to the actual WAV, check pronunciation, timing, and readability. CI uses fake engines to test validation and I/O without downloading any model.

The adapter follows the upstream `ChatterboxMultilingualTTS.from_pretrained` / `generate(text, language_id="hi")` interface. **V2 remains the default** for backward compatibility. The optional V3 multilingual checkpoint uses `t3_model="v3"` and may require a newer `chatterbox-tts` package and additional approved weights. Selecting V3 does **not** certify Hindi quality, voice similarity, or model availability; only real local inference followed by listening can establish those on a specific system.

## Windows 11 — configure, diagnose, and start

Prerequisites: obtain KathaSvara's source tree from the official GitHub repository, install **Python 3.11**, and use a developer EXE downloaded from a verified KathaSvara GitHub release with its checksum validated. No administrator privileges or persistent environment-variable changes are required by this helper.

Open Windows PowerShell **from the repository root**. First inspect the available Python setup without generating audio or downloading weights:

```powershell
powershell -NoProfile -File .\scripts\windows\launch-with-audio.ps1 -DoctorOnly
```

If the Python inference virtual environment doesn't exist, **explicitly opt in** to installing the required open-source TTS packages (this can be a large network download):

```powershell
powershell -NoProfile -File .\scripts\windows\launch-with-audio.ps1 -InstallDependencies -DoctorOnly
```

If CUDA or MPS probing is broken but your Python and CPU PyTorch installations are compatible, opt in to CPU-only inference. This skips GPU availability probes; it is slower and **does not** establish that model weights or Hindi pronunciation work:

```powershell
powershell -NoProfile -File .\scripts\windows\launch-with-audio.ps1 -CpuOnly -DoctorOnly
powershell -NoProfile -File .\scripts\windows\launch-with-audio.ps1 -CpuOnly -VerifyHindiSpeech
```

For an already configured environment launched outside this helper, set `KATHASVARA_TTS_DEVICE=cpu` for the Python or EXE child process. The default `auto` retains CUDA → MPS → CPU detection. Invalid overrides fail safely; this option never installs CPU-compatible PyTorch automatically.

To opt in to **experimental Multilingual V3** without switching the default for existing projects, run:

```powershell
powershell -NoProfile -File .\scripts\windows\launch-with-audio.ps1 -ModelV3 -DoctorOnly
powershell -NoProfile -File .\scripts\windows\launch-with-audio.ps1 -ModelV3 -VerifyHindiSpeech
```

The first command checks Python imports, the requested checkpoint name **and whether the installed Chatterbox API declares the V3 `t3_model` option**, without downloading weights; the second intentionally runs real generation and may download large V3 weights. On an already configured environment use `KATHASVARA_TTS_MODEL=v3` in the **child process environment**. The default `v2` continues to call the legacy API without a new `t3_model` keyword. V2 and V3 have separate speech cache entries so switching does not silently reuse a prior checkpoint's WAV. The Settings preflight and DoctorOnly inspect the selected optional API keywords, but they cannot verify model loading or checkpoint access; if actual V3 loading fails, review the upstream Chatterbox version, approved model access, and local hardware.

### Longer local generation jobs on slow CPUs

The desktop normally limits an individual speech job to **10 minutes of wall-clock time**. That is not a guaranteed completion time: genuine model downloads, CPU inference and longer story renders can take more. If you deliberately want a longer limit for the **desktop EXE launched from this helper**, choose 10–120 minutes:

```powershell
powershell -NoProfile -File .\scripts\windows\launch-with-audio.ps1 -CpuOnly -RenderTimeoutMinutes 60 -ExecutablePath "C:\YOUR\KathaSvara-dev.exe"
```

The switch sets the **child process** environment variable `KATHASVARA_TTS_JOB_TIMEOUT_SECONDS`; it does not edit the registry. The default remains 600 seconds, and allowed overrides are 600–7,200 seconds. Invalid/out-of-range environment values fall back to the default. **Only `synthesize` and `render_story` jobs are affected**; no-model diagnostics, WAV inspection and health requests retain shorter timeouts. This switch cannot overcome missing packages, incompatible hardware, unavailable weights, or bad input audio. Longer jobs still require available disk space and may consume substantial CPU/RAM. Explicit render cancellation remains available between inference chunks. `-VerifyHindiSpeech` uses a direct Python command rather than the desktop bridge and is not governed by the desktop timeout.

### Optional, user-consented voice reference WAV

Upstream Chatterbox may load a checkpoint **without bundled speaker conditionals**. Previously a model could load successfully but `generate()` would then fail without a speaker prompt. The adapter now identifies that case with a clear diagnostic. To provide your own voice recording or a recording you have permission to use, opt in with an absolute local WAV path:

```powershell
powershell -NoProfile -File .\scripts\windows\launch-with-audio.ps1 -ReferenceWavPath "C:\YOUR\OWN\VOICE.wav" -DoctorOnly
powershell -NoProfile -File .\scripts\windows\launch-with-audio.ps1 -ReferenceWavPath "C:\YOUR\OWN\VOICE.wav" -VerifyHindiSpeech
```

The first command inspects the local file, Python dependencies and whether Chatterbox supports `audio_prompt_path` without loading model weights. It does **not** load the model. The second deliberately loads the Chatterbox checkpoint and sends the local recording to its **on-device** audio conditioning path. An existing local WAV must be 16-bit uncompressed PCM, mono/stereo, 16–48 kHz, 2–20 seconds, and at most 24 MiB; symlinks and essentially silent or spike-only signals are rejected. The program does not upload or persist the clip or its path in render caches, journal metadata, or desktop diagnostics. Cache keys use an audio-content SHA-256 so different reference clips never reuse each other's synthesized segments. If the recording is replaced while Chatterbox is loading or preparing its first speech chunk, the adapter checks its content hash immediately before and after first use, rejects the changed recording, and does not publish audio under the old reference fingerprint. Restart with the intended recording rather than replacing the clip during an active generation.

**Scope:** this configures one reference voice for the entire running inference process. **It does not yet assign different real voice identities to individual characters.** Quality and consent must be checked by the operator; even a valid clip or model-generated WAV is not proof of recognizable Hindi speech or voice similarity. A modified reference file may require restarting the process before generating again.

To test the **real** model, explicitly request one short Hindi WAV. **This can download substantial model weights** and consumes machine resources. The command reports the unique output WAV path, which you must play and listen to yourself:

```powershell
powershell -NoProfile -File .\scripts\windows\launch-with-audio.ps1 -VerifyHindiSpeech
```

To launch your checked developer EXE with the runtime and source variables set for that child process, pass its actual full path (replace this illustrative location):

```powershell
powershell -NoProfile -File .\scripts\windows\launch-with-audio.ps1 -ExecutablePath "C:\PATH\TO\KathaSvara-v0.5.1-dev-win64.exe"
```

For a Python environment already created elsewhere, add `-PythonPath "C:\PATH\TO\python.exe"`. This must be an existing Python 3.11 executable with the speech dependencies installed.

**Important:** DoctorOnly checks that the speech device is `auto`/`cpu` and checkpoint is `v2`/`v3`; it does **not** query CUDA hardware, ensure the installed Chatterbox package supports V3, or run model inference. The helper intentionally does not download weights in DoctorOnly mode, auto-accept upstream terms, modify Windows PATH, install system-wide applications, start synthesis automatically, or bypass security warnings for unsigned apps. It does not bundle any model or fix unsuitable hardware. Model download occurs only after the user runs `-VerifyHindiSpeech` or explicitly generates inside the app.

## Failure diagnosis

| Symptom | Likely cause / next action |
|---|---|
| App opens but Generate fails immediately with inference directory error | An EXE launched without the inference source directory. Launch it through the script, or set `KATHASVARA_INFERENCE_DIR` to the absolute `services/inference` folder. |
| Python not found or bridge fails | Select a Python 3.11 interpreter; run the script's DoctorOnly action. |
| `chatterbox`, `torch`, `numpy` or `soundfile` missing | Use `-InstallDependencies` explicitly with the source checkout. |
| TTS device override is invalid | Use only `KATHASVARA_TTS_DEVICE=auto` or `cpu`. The no-model import preflight, Settings panel, and Windows DoctorOnly helper reject other values without echoing their raw contents. |
| TTS model variant is invalid | Use `KATHASVARA_TTS_MODEL=v2` (default) or `v3` (experimental). The probe rejects other values without reflecting raw environment content. |
| Built-in speaker conditionals are missing | Provide an optional voice recording you own or have permission to use with `-ReferenceWavPath`; Chatterbox's `generate` needs a reference when `conds.pt` is absent. |
| Reference WAV invalid | Check PCM16 format, allowed sample rate and duration using `-DoctorOnly -ReferenceWavPath`. The private local filename is not echoed in the report. |
| Reference WAV changed while model loaded | Keep the original local recording unchanged until the first chunk has been conditioned; restart the audio job after replacing a reference. A fixed safe error prevents associating a changed recording with an earlier cache digest. |
| V3 selection accepted but model fails loading | The no-model doctor now checks the installed `from_pretrained` signature for `t3_model`, but it cannot confirm checkpoint access, hardware suitability or genuine Hindi speech. Update compatible Chatterbox dependencies if needed and check model access before running the explicit WAV smoke test. |
| Chatterbox API mismatch before generation | With `-ModelV3` the doctor checks for `t3_model`; with `-ReferenceWavPath` it checks for `audio_prompt_path`. Old versions that lack these keywords fail with a specific diagnostic before downloading model weights. Opaque or uninspectable wrappers (including generic `**kwargs` proxies with no explicit named parameter) are marked **unverifiable**, not approved. The default V2/no-reference path preserves legacy behavior. |
| DoctorOnly passes but real speech test fails | Dependency discovery is not a model smoke test. Review the privacy-safe Python error hint for model access, incompatible PyTorch, network access or insufficient RAM/VRAM; run the explicit smoke test on the configured machine. |
| Error says "Local file or audio operation failed" | The Python bridge intentionally hides raw operating-system and audio-codec exceptions, which may contain private file paths. Check write permissions, free storage, the selected output folder and the local diagnostic probe. |
| Generated WAV exists but sounds wrong | Keep the human listening acceptance issue open; do not claim distinct characters or usable Hindi until actually reviewed. |
| Audio takes a long time or times out | Model loading and synthesis may be slow on CPU. The desktop bridge bounds a single synthesis job to 10 minutes. |

## What counts as working

A successful **real** smoke test must produce a valid, nonempty PCM WAV from an actual Chatterbox model with no injected fake engine, and the listener must hear recognizable Hindi speech. The executable itself must then generate, preview, and export a WAV on a separately tested Windows setup. Real audio has **not** been verified by GitHub Actions.

Track remaining interactive voice and clean-Windows acceptance in [issue #3](https://github.com/sanskarIN/KathaSvara/issues/3). Until a managed Python environment, licenses/weights distribution, and dependable installation are implemented, do not market the unsigned EXE as a ready-to-run audio generator.
