# Why Hindi audio may not generate in a Windows developer EXE

**Status:** KathaSvara's current published Windows EXE is an **unsigned, unbundled developer preview**, **not** a ready-to-use offline speech installer. It includes the desktop UI, but not the Python 3.11 inference service, Chatterbox package, PyTorch, or model checkpoints. Passing the project's model-free CI tests cannot prove real Hindi speech or reliable playback.

## What the generator is for

1. **Voice Studio:** narrate a short Hindi text as a WAV with Chatterbox Multilingual and the supported `hi` language ID.
2. **Characters & Scenes:** parse a labeled Hindi script, manually assign known speakers, render their lines, and export measured dialogue SRT. Different character labels **do not yet imply distinct voice identities**.
3. **Production review:** listen to the actual WAV, check pronunciation, timing, and readability. CI uses fake engines to test validation and I/O without downloading any model.

The current adapter follows the upstream `ChatterboxMultilingualTTS.from_pretrained` / `generate(text, language_id="hi")` interface, but only actual local model inference can establish whether it works on a specific system.

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

To test the **real** model, explicitly request one short Hindi WAV. **This can download substantial model weights** and consumes machine resources. The command reports the unique output WAV path, which you must play and listen to yourself:

```powershell
powershell -NoProfile -File .\scripts\windows\launch-with-audio.ps1 -VerifyHindiSpeech
```

To launch your checked developer EXE with the runtime and source variables set for that child process, pass its actual full path (replace this illustrative location):

```powershell
powershell -NoProfile -File .\scripts\windows\launch-with-audio.ps1 -ExecutablePath "C:\PATH\TO\KathaSvara-v0.5.1-dev-win64.exe"
```

For a Python environment already created elsewhere, add `-PythonPath "C:\PATH\TO\python.exe"`. This must be an existing Python 3.11 executable with the speech dependencies installed.

**Important:** The helper intentionally does not download weights in DoctorOnly mode, auto-accept upstream terms, modify Windows PATH, install system-wide applications, start synthesis automatically, or bypass security warnings for unsigned apps. It does not bundle any model or fix unsuitable hardware. Model download occurs only after the user runs `-VerifyHindiSpeech` or explicitly generates inside the app.

## Failure diagnosis

| Symptom | Likely cause / next action |
|---|---|
| App opens but Generate fails immediately with inference directory error | An EXE launched without the inference source directory. Launch it through the script, or set `KATHASVARA_INFERENCE_DIR` to the absolute `services/inference` folder. |
| Python not found or bridge fails | Select a Python 3.11 interpreter; run the script's DoctorOnly action. |
| `chatterbox`, `torch`, `numpy` or `soundfile` missing | Use `-InstallDependencies` explicitly with the source checkout. |
| DoctorOnly passes but real speech test fails | Dependency discovery is not a model smoke test. Inspect the Python response for model downloads, permissions, incompatible PyTorch, network access or insufficient RAM/VRAM. |
| Generated WAV exists but sounds wrong | Keep the human listening acceptance issue open; do not claim distinct characters or usable Hindi until actually reviewed. |
| Audio takes a long time or times out | Model loading and synthesis may be slow on CPU. The desktop bridge bounds a single synthesis job to 10 minutes. |

## What counts as working

A successful **real** smoke test must produce a valid, nonempty PCM WAV from an actual Chatterbox model with no injected fake engine, and the listener must hear recognizable Hindi speech. The executable itself must then generate, preview, and export a WAV on a separately tested Windows setup. Real audio has **not** been verified by GitHub Actions.

Track remaining interactive voice and clean-Windows acceptance in [issue #3](https://github.com/sanskarIN/KathaSvara/issues/3). Until a managed Python environment, licenses/weights distribution, and dependable installation are implemented, do not market the unsigned EXE as a ready-to-run audio generator.
