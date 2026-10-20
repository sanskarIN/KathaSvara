# KathaSvara · कथास्वर

**Give Every Story a Voice.** An open-source, offline-first Hindi storytelling and speech-production desktop project.

> **Latest pre-release:** [v0.1.1 — Developer Preview (Source Only)](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.1.1) is **published on GitHub**. The previous [v0.1.0 preview](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.1.0) remains available. Both are source-only developer releases; model weights, Windows installers, audible Hindi voice-quality acceptance, and standalone desktop packaging remain **unverified or unavailable**.

## What the development source implements

- Tauri 2 + Rust desktop bridge and React + TypeScript Hindi-first studio.
- Hindi story editing, Unicode-safe character counts and local project save/load.
- Local Python subprocess calling Chatterbox Multilingual with Hindi language tagging.
- Configurable model-supported expressiveness and guidance.
- Actual synthesis-to-WAV pipeline, format verification, desktop playback and user-requested WAV export.
- Dark/light appearance, saved story list, helpful errors, About and support links.
- v0.1.1: no-download TTS dependency diagnosis through the Python bridge and desktop Settings, with clear unverified model/audio flags.
- Review normalized Hindi and speech segments **before** synthesis without loading a model; changes require explicit approval.
- Import locally selected UTF-8 `.txt` / `.md` stories (250 KB maximum); voice settings persist in local UI preferences.
- Detect stale audio when the script or voice settings change; bound Python inference runtime and validate WAV chunk integrity.
- Python, Rust and TypeScript unit-test foundations.

This developer preview requires manual Python/Tauri setup and may need further integration fixes. No model weights or sample generated voices are bundled. See [v0.1.1 pre-release notes](docs/releases/v0.1.1-notes.md) for precise limitations and what's changed.

## Quick start (development mode only)

**Prerequisites:** Python 3.11 (recommended by upstream model authors), Node.js 20+, Rust stable, the Tauri 2 platform prerequisites, disk and memory for the model. Windows 11 is the primary target.

1. Enter the services/inference directory and create/activate a Python 3.11 virtual environment.
2. Install the inference module and optional model with: python -m pip install -e ".[tts,test]"
3. Run Python tests with: python -m pytest -q
4. Set the KATHASVARA_PYTHON environment variable to your virtual environment's absolute Python executable path (especially important on Windows).
5. Enter apps/desktop, run npm install, then npm run tauri dev.
6. Enter Hindi text, press Generate Hindi Voice and inspect the result before exporting.
7. First real generation can download large model weights; use only after checking the upstream terms and verifying free storage.

Detailed Windows, Linux and macOS instructions: [development setup](docs/installation/development.md). Troubleshooting and compatibility: [v0.1.0 development notes](docs/releases/v0.1.0.md).

## Verified implementation versus planned work

| Capability | State |
|---|---|
| Hindi input and local story storage | Implemented in source; desktop build unverified |
| Chatterbox Hindi adapter | Implemented in source; **real synthesis unverified** |
| WAV writing, preview and export | Implemented in source; end-to-end unverified |
| Inspect Hindi text and import TXT / Markdown | Implemented in source; desktop interaction unverified |
| Python tests | Passing on both v0.1.0 and v0.1.1 release commits |
| Multi-character voices | Future milestone |
| Full audio timeline and music mixing | Future milestone |
| Managed Python runtime / signed Windows installer | Future milestone |

Our priority is natural Hindi output, not feature counts. No private text or reference audio is uploaded by KathaSvara's current local inference bridge.

## Next milestones

- **v0.1.0:** source-only developer pre-release published with Python, React and Windows Rust checks passing.
- **v0.1.1:** source-only pre-release published after passing Python, React and Windows Rust CI; adds model-free Python TTS diagnostics and clearer developer setup.
- **Next:** real Hindi model smoke test, interactive desktop verification, reliable model worker lifecycle and installation packaging.
- **v0.2.0:** speaker/character assignment and persistent voice profiles.
- **Later:** multi-engine support, timeline, cinematic audio production, packaging and distribution.

## Creator and community

Designed for creators including **[कहानी वाली शाम](https://www.youtube.com/@KahaniWaliShaam)** — हर शाम, एक नई कहानी।

[Project source](https://github.com/sanskarIN/KathaSvara) · [Developer GitHub](https://github.com/sanskarIN) · [Personal website](https://sanskarin.github.io) · [Contact](https://sanskarin.github.io/contact/#send-a-message) · [Email](mailto:sanskarprogrammer@gmail.com).

### Support development (entirely voluntary)

- [Buy Me a Coffee](https://buymeacoffee.com/SanskarCodes)
- [Razorpay](https://razorpay.me/@SanskarCodes)
- [PayPal.me](https://paypal.me/SanskarCodes)

Donations never unlock or restrict open-source functionality.

### License, security and contributing

Source code: **[Mozilla Public License 2.0](LICENSE)**. Chatterbox, Python packages and any downloaded checkpoints retain their separate license requirements; see [third-party notices](THIRD_PARTY_NOTICES.md). Please read [CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md), and our [Code of Conduct](CODE_OF_CONDUCT.md).

Website preview: [KathaSvara GitHub Pages](https://sanskarin.github.io/KathaSvara/) (only when GitHub Pages is enabled; not currently asserted live).
