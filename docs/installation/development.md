# Development environment (source only)

The latest [v0.4.2 experimental pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.4.2) includes an unsigned Windows x64 **developer executable**, but it is **not a self-contained installer**. The app still requires separately installed compatible Python 3.11, Chatterbox, supported model weights and Tauri/WebView2 prerequisites. The Chatterbox and PyTorch stack can require substantial disk and GPU memory; actual Hindi speech and an interactive clean-machine Windows launch are unverified.

The [v0.5.0 development branch](https://github.com/sanskarIN/KathaSvara) adds **model-free scene audits, matched WAV/SRT filename suggestions, manual WAV review and mocked desktop interaction tests**, but **v0.5.0 is not published**. None of these tests verifies installed model weights or real Hindi voice quality. Follow the [manual Windows/Hindi acceptance protocol](../qa/windows-hindi-acceptance.md) and [open issue #3](https://github.com/sanskarIN/KathaSvara/issues/3) before proposing stability.

## Windows 11 (first target)

Install Git, Node.js 20 or later, Rust stable (with Microsoft C++ build tools) and the Tauri 2 Windows WebView2 prerequisites. Install Python **3.11**, preferably from python.org.

Open PowerShell in the repository:

    cd services/inference
    py -3.11 -m venv .venv
    .\.venv\Scripts\Activate.ps1
    python -m pip install --upgrade pip
    python -m pip install -e ".[tts,test]"
    python -m pytest -q
    $env:KATHASVARA_PYTHON = (Resolve-Path .\.venv\Scripts\python.exe).Path
    cd ..\..\apps\desktop
    npm install
    npm run tauri dev

Keep that PowerShell session open because KATHASVARA_PYTHON is scoped to it. The desktop application starts the configured local Python runtime for each synthesis request. The first generation may be slower and may download weights.

## Linux

Install Python 3.11, stable Rust, Node.js and the system packages documented by the official Tauri 2 Linux prerequisites (WebKitGTK 4.1, appindicator, build essentials and system libraries). From the repository root:

    cd services/inference
    python3.11 -m venv .venv
    . .venv/bin/activate
    python -m pip install -e ".[tts,test]"
    python -m pytest -q
    export KATHASVARA_PYTHON="$(pwd)/.venv/bin/python"
    cd ../../apps/desktop
    npm install
    npm run tauri dev

## macOS

Install the Tauri 2 Xcode/Command Line Tools requirements, Node.js, stable Rust and Python 3.11. Follow the Linux Python and Node commands, noting that installed PyTorch and model acceleration compatibility vary by macOS release and hardware.

## Troubleshooting

- **Python interpreter not found:** set KATHASVARA_PYTHON to the absolute Python executable inside the environment with chatterbox-tts installed.
- **No inference source directory:** set KATHASVARA_INFERENCE_DIR to the absolute path of services/inference.
- **Module not found:** install inference extras in the same interpreter that the desktop uses.
- **Model permission/download failure:** check the official upstream model card, connectivity, permissions and available disk. Never bypass gated weights.
- **Out of memory:** use supported compatible hardware or shorter text. No platform-wide speed or VRAM guarantee is provided.
- **Export failed:** choose a new WAV filename that does not already exist (the exporter deliberately avoids overwriting files).
- **Windows packaging:** bundle.active is false until a managed Python runtime and validated installer are implemented.

## Dev-only standalone speech smoke test

After installing the optional TTS dependencies, use this explicit test. Replace OUTPUT with a unique absolute WAV filename in a directory you own. This runs the actual pretrained model and may download its weights:

    python -m kathasvara.cli

Provide a JSON request through stdin:

    {"action":"synthesize","text":"नमस्कार! कथास्वर में आपका स्वागत है।","output":"OUTPUT","exaggeration":0.5,"cfg_weight":0.5}

A successful response must include output WAV metadata. Listen to the file and independently check Hindi pronunciation, pauses and artifacts. A passing Python unit test or JSON health check alone does **not** establish model readiness.

## Dialogue-timed subtitles and safe shared cache\n\nAfter a successful Characters & Scenes render, the studio can export a UTF-8 `.srt` file with each dialogue segment's measured audio-frame start/end positions. Review the timing and readable Hindi text; this is not word-by-word forced alignment. Subtitles are saved to a **new** filename only.\n\nCache pruning is explicit and defaults to dry-run. Current Python workers sharing an app-data directory use a persistent OS advisory lock so rendering and destructive pruning fail closed when another participating worker is active. Never remove the `.kathasvara-cache-operation.lock` sentinel: the OS releases locks automatically when workers exit. Legacy or unrelated programs do not participate in this lock.\n\n## Story import and Hindi inspection

The Story editor can import a UTF-8 `.txt` or `.md` file using the operating system's file chooser. Only files up to 250 KB are accepted. Import starts a new unsaved project and asks before replacing the current editor. Larger stories can be preserved as text but must be split into smaller generation jobs (3000 Unicode code points per request).

Use **Inspect Hindi pronunciation text** to see the exact normalized text and speech chunks. This offline inspection requires the Python bridge but does not load or download a speech model. It does not change the story unless **Apply normalized text** is selected. Edits to text or voice controls invalidate the audio preview so stale audio cannot be accidentally exported. The current worker has a 10-minute speech-generation timeout; this is a safety limit rather than a performance guarantee.

## Inspect which local speech dependencies are available

The **Settings → Inspect local TTS setup** control asks the Python subprocess for a lightweight `diagnose` report. You can also call the same protocol manually from `services/inference`:

```sh
echo '{"action":"diagnose"}' | python -m kathasvara.cli
```

The response reports the detected Python version, host platform, and whether the `numpy`, `soundfile`, `torch`, and `chatterbox` packages are import-discoverable. It never downloads model weights, imports the heavy synthesis model, or suggests that real Hindi speech quality has been validated. Installed packages are **necessary but not sufficient** for functioning synthesis: CUDA, compatible model revisions, GPU memory, sample quality, and playback must be checked separately. This model-free diagnostic is available in the current v0.4.2 experimental developer preview; the presence of dependencies is not evidence of successful model inference.
