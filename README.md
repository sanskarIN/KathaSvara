# KathaSvara · कथास्वर

**Give Every Story a Voice.** An open-source, offline-first Hindi storytelling and speech-production desktop project.

> **Published experimental pre-release (v0.2.0):** [KathaSvara v0.2.0](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.2.0) is **published on GitHub** with source archives and an unsigned Windows `.exe` developer candidate, SHA-256 checksums, and setup instructions. The [v0.1.1](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.1.1) and [v0.1.0](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.1.0) previews remain available. **v0.2.0 is not stable or self-contained**: it needs external Python/model dependencies, and real Hindi audio quality, distinct character voices and clean Windows launch remain unverified.

## v0.2.0 experimental pre-release — characters and scenes

**Published experimental developer pre-release:** [merged PR #4](https://github.com/sanskarIN/KathaSvara/pull/4) adds versioned scene/character models, a deterministic Hindi dialogue parser, manual speaker correction, supported per-character engine settings, and a multi-segment audio orchestration layer. It extends the existing React/Tauri/Rust/Python app and preserves the v0.1.x narrator project files separately. See [v0.2.0 architecture](docs/architecture/v0.2.0-story-pipeline.md) and [release gates](docs/releases/v0.2.0-development.md).

**This functionality is still being tested.** Identifying `राजा भोज:` and `मंत्री:` in a written script does not mean the installed Chatterbox model produces two distinctly recognizable voices. The engine currently exposes only documented Hindi expressiveness/guidance controls; real multi-speaker voice consistency and audio quality are not accepted.

The [v0.2.0 pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.2.0) includes an **unsigned, unbundled Windows EXE** compiled on its release commit, with a `SHA256SUMS.txt` checksum and a dependency-warning `README.txt`. It requires external Python and model dependencies; do not treat it as a verified standalone installer. Automated release CI passed, but interactive launch and real Hindi listening acceptance remain open.

## v0.2.1 reliability features in development

Project-local pronunciation rules, reversible user corrections, separately edited spoken text, exact no-model pre-TTS text preview, selective content-keyed audio cache reuse and stricter cached WAV checks are implemented in the v0.2.1 development source. They remain subject to PR CI and honest release gates. See [PR #5](https://github.com/sanskarIN/KathaSvara/pull/5). Separate characters still **do not imply verified distinct voices**.

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

This developer preview requires manual Python/Tauri setup and may need further integration fixes. No model weights or sample generated voices are bundled. See [v0.2.0 experimental pre-release notes](docs/releases/v0.2.0-notes.md) for precise limitations and what's changed.

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

## Implemented source versus independently verified acceptance

| Capability | State |
|---|---|
| Hindi input and local story storage | Implemented; exact release CI results and GUI acceptance must be checked separately |
| Chatterbox Hindi adapter | Implemented in source; **real synthesis unverified** |
| WAV writing, preview and export | Implemented in source; end-to-end unverified |
| Inspect Hindi text and import TXT / Markdown | Implemented in source; desktop interaction unverified |
| Python tests | Passing on both v0.1.0 and v0.1.1 release commits |
| Multi-character voices | Future milestone |
| Full audio timeline and music mixing | Future milestone |
| Managed Python runtime / signed Windows installer | Future milestone |

Our priority is natural Hindi output, not feature counts. No private text or reference audio is uploaded by KathaSvara's current local inference bridge.

## Release history and next work

- **v0.1.0:** published source-only experimental developer preview after automated checks.
- **v0.1.1:** published source-only experimental developer pre-release with model-free setup diagnostics.
- **v0.2.0:** [published experimental developer pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.2.0) with scene/character authoring, deterministic dialogue parsing, bounded multi-segment rendering, cache and cooperative cancellation. Unsigned unbundled Windows EXE compiled by GitHub Actions; no real-model listening or clean-machine launch is claimed.
- **v0.2.1:** experimental pronunciation and reliability work tracked in [PR #5](https://github.com/sanskarIN/KathaSvara/pull/5), [architecture](docs/architecture/v0.2.1-production-reliability.md) and [release notes](docs/releases/v0.2.1-notes.md). Check [GitHub Releases](https://github.com/sanskarIN/KathaSvara/releases) for actual publication status rather than assuming a version mention means the release is live.
- **Later:** independent speaker routing only after model API evidence, real Hindi audio quality tests, stable packaging, multitrack audio and additional engines.

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
