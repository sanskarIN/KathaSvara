# Why Hindi audio may not generate in a Windows developer EXE

**Status:** KathaSvara's current published Windows EXE is an **unsigned, unbundled developer preview**, **not** a ready-to-use offline speech installer. It includes the desktop UI, but not the Python 3.11 inference service, Chatterbox package, PyTorch, or model checkpoints. Passing the project's model-free CI tests cannot prove real Hindi speech or reliable playback.

## What the generator is for

1. **Voice Studio:** narrate a short Hindi text as a WAV with Chatterbox Multilingual and the supported `hi` language ID.
2. **Characters & Scenes:** parse a labeled Hindi script, manually assign known speakers, render their lines, and export measured dialogue SRT. Different character labels **do not yet imply distinct voice identities**.
3. **Production review:** listen to the actual WAV, check pronunciation, timing, and readability. CI uses fake engines to test validation and I/O without downloading any model.

The adapter follows the upstream `ChatterboxMultilingualTTS.from_pretrained` / `generate(text, language_id="hi")` interface. **V2 remains the default** for backward compatibility. The optional V3 multilingual checkpoint uses `t3_model="v3"` and may require a newer `chatterbox-tts` package and additional approved weights. Selecting V3 does **not** certify Hindi quality, voice similarity, or model availability; only real local inference followed by listening can establish those on a specific system.

## Published v0.5.4: one next action for speech setup

The published [v0.5.4 experimental developer preview](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.5.4) adds a specific **Recommended next step** to the model-free TTS import probe in Settings. It prioritizes the first actionable blocker: Python 3.11, missing or broken speech imports, invalid device/model selection, an unusable local reference WAV, or an incompatible/unverifiable optional Chatterbox API. The advice is selected from fixed strings, so private interpreter paths, reference filenames, tokens, and native import errors are not echoed.

The Windows `-DoctorOnly` helper also prints the same fixed **Recommended next step**, including when preflight fails. When optional speech packages are missing, the helper now continues into the safe, model-free import probe instead of exiting before a recommendation appears. Installing packages is **opt-in** using `-InstallDependencies`; the doctor alone does not install packages, download weights or run the speech model. A green import probe recommends the **explicit real Hindi smoke test and listening**, not an automatic model download and not a claim that KathaSvara can already speak Hindi. This actionable setup diagnostic is included in the published **v0.5.4** developer EXE, but **not** the earlier v0.5.3 or v0.5.2 executables. A model-free preflight does not certify real Hindi narration.

## Post-v0.5.4 development: synthetic WAV I/O self-test (not in the published EXE)

The next development branch adds a **model-free PCM16 WAV round-trip** to the Windows audio helper. It writes a deterministic, quarter-second **synthetic signal** to the selected Python interpreter's temporary directory, reopens it with KathaSvara's bounded WAV structural inspector, verifies the shape and non-silent variation, and removes the temporary file. This uses only the Python standard library and existing local source; it **does not** install packages, load Chatterbox/PyTorch, download weights, play any sound or export any of your story/voice recordings.

**Desktop Settings (PR #126 development branch):** Use **Test temporary WAV I/O (no model or playback)** to run the same check through the native Windows/Python bridge. The result shows a pass or a fixed failure stage, without the temporary filename or reference-voice path. An unavailable Python bridge produces a generic setup error, not raw OS exception text. Running this button never invokes the narration command, TTS preflight, or model downloads.

From the repository's `services/inference` directory in a configured Python environment, run the standalone protocol check:

```powershell
'{"action":"probe_audio_io"}' | python -m kathasvara.cli
```

A passing `temporary_wav_roundtrip_ok` means only that **temporary PCM16 file writing and structural read-back worked in that interpreter**. It does not confirm the app's final export path, Windows speakers, TTS packages, correct Hindi speech, voice identity or listening quality. A failure returns a fixed `failed_stage` code (`temporary_directory`, `write_pcm16`, `inspect_pcm16`, or `cleanup`) without revealing private paths. In the development branch, the `-DoctorOnly` helper performs this check before probing speech imports, so an import failure cannot be mistaken for a WAV-file failure.

The desktop presents one fixed remediation for each failure stage: `temporary_directory` means check Python's temporary-folder access and free space; `write_pcm16` means check write permissions, free space and local security restrictions; `inspect_pcm16` means verify the matching KathaSvara source and retry the structural read; `cleanup` means check whether the temporary directory permits removing its own test file. The native bridge validates status, flags and stage against an allowlist and replaces free-form worker messages with fixed public wording; contradictory responses fail closed.

This feature is **post-v0.5.4 source development only**. It is absent from the published v0.5.3 and v0.5.4 executables. The branch has passing no-model CI, but no synthetic test replaces issue #3's real Hindi listening and clean-Windows acceptance.

## Next development: choose the local runtime from desktop Settings

**Post-v0.5.4 source development only (not in the v0.5.4 download).** A new Settings section lets users choose a **trusted Python 3.11 executable** and the matching **`services/inference` folder** through local OS file and directory dialogs. A Rust command checks that the executable exists with a Python filename and the chosen folder contains `kathasvara/cli.py`. The selection overrides launcher defaults **for new Python jobs in this app session only**; it is never stored in a story, browser localStorage, project metadata or the OS registry, and the paths are not displayed to other users.

This feature helps when the Windows developer EXE is launched by double-clicking instead of through `launch-with-audio.ps1`. It does **not** install Python, `chatterbox-tts`, PyTorch or model weights. Choose an interpreter you trust; executable selection is a deliberate local program execution choice. Configure the source folder from the **same source version as the EXE**, then run **Check Python bridge**, **Inspect local TTS setup**, **Verify speech library imports (no model load)**, and **Test temporary WAV I/O**. Model inference remains an explicit separate action and may require approved checkpoint downloads.

Clearing the session selection restores launcher environment values or source discovery for subsequent jobs. Existing jobs already spawned with an older interpreter are not retroactively changed. If the source folder or interpreter was moved, reselect the current paths. Missing dependencies or incorrect Python versions will be reported by the no-model doctor; successful setup does not establish actual Hindi pronunciation or speech playback.

## Next development: one-click model-free speech readiness

**Not included in the published v0.5.4 executable or the prepared v0.5.5 release candidate.** After v0.5.5 is finalized, the next development branch adds **Settings → Check speech readiness (no model load)**. This runs the already-available Python environment doctor, synthetic WAV write/read check and optional Chatterbox import/API preflight **in that order**. It stops early when Python is not 3.11 or synthetic WAV I/O fails; successful WAV plumbing proceeds to the model-free speech-library check.

The result shows the first practical blocker using fixed, path-free guidance. Individual speech import diagnostics also display only known package names and fixed, locally defined repair text; unknown worker-provided help strings, environment values and exception paths are not echoed into the UI. Native exception messages are never displayed, and changing the session voice reference or local interpreter selection retires a stale readiness report. A passing readiness result means **only** that the interpreter, temporary-file system, and configured optional imports responded as expected. It does not download weights, load Chatterbox checkpoints, synthesize speech, test speakers, prove character voice identity, or check exported WAV/SRT content. Real Hindi narration must still be explicitly generated and listened to under [manual issue #3](https://github.com/sanskarIN/KathaSvara/issues/3).

## Next development: verify real Voice Studio audio metadata and clean interrupted WAVs

**Not in the published v0.5.4 executable or the frozen v0.5.5 source candidate.** After an explicit Voice Studio Generate action, the native desktop verifies that the actual saved WAV is mono PCM16, correctly bounded, and has the same sample rate and duration as the Python worker reported. The player duration comes from the measured number of PCM frames, not unchecked Python JSON. Invalid, missing or contradictory chunk metadata fails closed; only the new job's UUID-named output is removed, with no change to saved stories or previous exported audio. Larger valid recordings still remain exportable when the WebView's 25 MiB inline preview limit is exceeded.

On failure or completion of a Python synthesis process, the desktop also looks for temporary files matching **that specific job's UUID plus the random hexadecimal suffix** generated by `StreamingWav`. It deletes only matching regular files, does not follow symlinks and does not touch other projects, unrelated recordings or voice references. This closes a cleanup gap where the old guessed temporary name did not match the writer's real filename. These checks improve disk hygiene and metadata integrity; neither a structurally valid WAV nor a successful CI build proves that the output is intelligible Hindi.

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

### Python startup and large story requests

If Chatterbox/PyTorch imports are slow or a long story produces a large JSON request, the desktop bridge now sends Python stdin and drains stdout on worker threads **before enforcing the configured job timeout**. A full stdin pipe therefore cannot block the main watchdog; an unresponsive worker is terminated and reaped when the job's deadline expires. Diagnostics remain separately bounded, and a timeout still does not prove whether models, checkpoint weights or actual Hindi audio work. Retry a short sentence, inspect Settings diagnostics, and only then attempt the longer render or explicitly opt in to a longer supported timeout.

### Longer local generation jobs on slow CPUs

The desktop normally limits an individual speech job to **10 minutes of wall-clock time**. That is not a guaranteed completion time: genuine model downloads, CPU inference and longer story renders can take more. If you deliberately want a longer limit for the **desktop EXE launched from this helper**, choose 10–120 minutes:

```powershell
powershell -NoProfile -File .\scripts\windows\launch-with-audio.ps1 -CpuOnly -RenderTimeoutMinutes 60 -ExecutablePath "C:\YOUR\KathaSvara-dev.exe"
```

The switch sets the **child process** environment variable `KATHASVARA_TTS_JOB_TIMEOUT_SECONDS`; it does not edit the registry. The default remains 600 seconds, and allowed overrides are 600–7,200 seconds. Invalid/out-of-range environment values fall back to the default. **Only `synthesize` and `render_story` jobs are affected**; no-model diagnostics, WAV inspection and health requests retain shorter timeouts. This switch cannot overcome missing packages, incompatible hardware, unavailable weights, or bad input audio. Longer jobs still require available disk space and may consume substantial CPU/RAM. Explicit render cancellation remains available between inference chunks. `-VerifyHindiSpeech` uses a direct Python command rather than the desktop bridge and is not governed by the desktop timeout.

### If model output becomes flat after PCM clipping

When a model returns floating-point samples beyond the legal [-1, +1] audio range, KathaSvara clamps them before WAV writing. A waveform that changes in raw values but ends up at a single fixed level after clamping (for example, 1.2 then 1.8 repeatedly) now fails the same **effectively silent** gate used for already-flat output. Such a failure does not publish a narration WAV or cache a corrupted story segment. Try shorter script text, a compatible installed model and consented reference if required, and run the real-model listening acceptance. A normal WAV signal alone does not guarantee understandable Hindi.

### Loud WAV but no changing speech signal

A generated WAV may be structurally valid, have a normal RMS volume, and still contain only a fixed positive/negative PCM offset rather than voice. The independent WAV inspector now reports a `dc_only_hint` and marks such output for review, while the real Hindi smoke helper fails the sample instead of implying that loudness proves speech. This is calculated from bounded PCM16 streaming statistics and does **not** reveal private filenames or load a model. Run the no-model TTS import check, verify your installed checkpoint/reference API, try the explicit short real Hindi smoke test, and listen carefully. Neither a clean waveform nor the absence of numerical warnings certifies pronunciation or character voices.

### When a WAV is generated but has no useful sound

KathaSvara rejects numerically silent, nearly silent, and constant DC-offset generated audio before publishing a finished WAV; the same check applies when reusing cached story segments. An old corrupted cache entry with flat DC audio is regenerated rather than reused. This is a **signal-level gate only**: it cannot detect mispronounced Hindi, robotic rhythm, wrong language, a mistaken speaker, or excessive pauses. If a generation is rejected as effectively silent, run the model-free import diagnostics, confirm model weights/device compatibility, retry a short Hindi sample, and listen manually. Synthetic unit tests do not certify actual speech quality.

### When a selected Chatterbox API is unsupported

Before loading a large checkpoint, KathaSvara checks for definitively unsupported installed Chatterbox optional interfaces: `t3_model` for explicitly selected V3, and `audio_prompt_path` when a user-owned or consented reference WAV is configured. A confirmed mismatch gives fixed, private-path-free help suggesting a compatible package, switching to V2, or clearing the reference. A generic `**kwargs` wrapper is **unverifiable**, not automatically declared working or rejected; a user can still deliberately attempt the optional mode. Neither these checks nor the import doctor download weights or verify real Hindi quality. Resolve Python 3.11/Chatterbox installation problems first.

### Reference recording changes during generation

Keep the consented local PCM16 WAV unchanged for the entire generation job. KathaSvara validates the waveform before hashing its content for the segment-cache key; rewriting or replacing that file (even with another WAV of the **same byte length**) during inspection now fails with a fixed, path-free change message. A new generation must reselect/revalidate the updated recording. These checks detect ordinary filesystem mutations and help prevent use of mismatched reference audio; they do not prove voice identity, consent or speech intelligibility.

### Optional, user-consented voice reference WAV

**Desktop app (published v0.5.3 and newer experimental previews):** open **Settings → Choose local reference WAV** and select an existing recording that you own or have consent to use. Click **Verify speech library imports (no model load)** to check its format and installed Chatterbox reference API, then generate a short preview or cast/story render. The chosen file path is held **only in app memory for this session**, is never shown in the Settings panel or saved to a project, and is passed only to the local Python child for that action; no voice audio is uploaded. **Clear session voice selection** restores the launcher-provided default (if set). The app picker applies a *single reference to the entire render*, not different speaker identities to character profiles. Real audible Hindi still needs the manual listening gate. This UI option is included in the published v0.5.3 and v0.5.4 experimental previews; it was absent from the earlier v0.5.1 and v0.5.2 releases.

Upstream Chatterbox may load a checkpoint **without bundled speaker conditionals**. Previously a model could load successfully but `generate()` would then fail without a speaker prompt. The adapter now identifies that case with a clear diagnostic. To provide your own voice recording or a recording you have permission to use, opt in with an absolute local WAV path:

```powershell
powershell -NoProfile -File .\scripts\windows\launch-with-audio.ps1 -ReferenceWavPath "C:\YOUR\OWN\VOICE.wav" -DoctorOnly
powershell -NoProfile -File .\scripts\windows\launch-with-audio.ps1 -ReferenceWavPath "C:\YOUR\OWN\VOICE.wav" -VerifyHindiSpeech
```

The first command inspects the local file, Python dependencies and whether Chatterbox supports `audio_prompt_path` without loading model weights. It does **not** load the model. The second deliberately loads the Chatterbox checkpoint and sends the local recording to its **on-device** audio conditioning path. An existing local WAV must be 16-bit uncompressed PCM, mono/stereo, 16–48 kHz, 2–20 seconds, and at most 24 MiB; symlinks, effectively silent or spike-only signals, and constant DC-offset recordings are rejected. Stereo recordings are assessed **per channel** and after mono downmix, so opposing left/right DC offsets or phase-cancelling waveforms cannot be mistaken for a usable voice signal. The program does not upload or persist the clip or its path in render caches, journal metadata, or desktop diagnostics. Cache keys use an audio-content SHA-256 so different reference clips never reuse each other's synthesized segments. If the recording is replaced while Chatterbox is loading or preparing its first speech chunk, the adapter checks its content hash immediately before and after first use, rejects the changed recording, and does not publish audio under the old reference fingerprint. Restart with the intended recording rather than replacing the clip during an active generation.

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
| Reference WAV invalid | Check PCM16 format, allowed sample rate, duration, and whether the file has varying audio (not only silence or a constant offset) using `-DoctorOnly -ReferenceWavPath`. The private local filename is not echoed in the report; passing the signal gate does not prove intelligible speech. |
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
