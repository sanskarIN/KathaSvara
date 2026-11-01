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

The first command checks Python imports and the requested checkpoint name without downloading weights; the second intentionally runs real generation and may download large V3 weights. On an already configured environment use `KATHASVARA_TTS_MODEL=v3` in the **child process environment**. The default `v2` continues to call the legacy API without a new `t3_model` keyword. V2 and V3 have separate speech cache entries so switching does not silently reuse a prior checkpoint's WAV. The Settings preflight and DoctorOnly cannot detect an outdated installed API; if actual V3 loading fails, check the upstream Chatterbox version and approved checkpoint access.

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
| V3 selection accepted but model fails loading | A successful import probe does not verify the upstream `t3_model="v3"` API or V3 weights. Update compatible Chatterbox dependencies if needed and check model access before running the explicit WAV smoke test. |
| DoctorOnly passes but real speech test fails | Dependency discovery is not a model smoke test. Review the privacy-safe Python error hint for model access, incompatible PyTorch, network access or insufficient RAM/VRAM; run the explicit smoke test on the configured machine. |
| Error says "Local file or audio operation failed" | The Python bridge intentionally hides raw operating-system and audio-codec exceptions, which may contain private file paths. Check write permissions, free storage, the selected output folder and the local diagnostic probe. |
| Generated WAV exists but sounds wrong | Keep the human listening acceptance issue open; do not claim distinct characters or usable Hindi until actually reviewed. |
| Audio takes a long time or times out | Model loading and synthesis may be slow on CPU. The desktop bridge bounds a single synthesis job to 10 minutes. |

## What counts as working

A successful **real** smoke test must produce a valid, nonempty PCM WAV from an actual Chatterbox model with no injected fake engine, and the listener must hear recognizable Hindi speech. The executable itself must then generate, preview, and export a WAV on a separately tested Windows setup. Real audio has **not** been verified by GitHub Actions.

Track remaining interactive voice and clean-Windows acceptance in [issue #3](https://github.com/sanskarIN/KathaSvara/issues/3). Until a managed Python environment, licenses/weights distribution, and dependable installation are implemented, do not market the unsigned EXE as a ready-to-run audio generator.
