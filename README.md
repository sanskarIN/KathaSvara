# KathaSvara · कथास्वर

**Give Every Story a Voice.** An open-source, offline-first Hindi storytelling and speech-production desktop project.

> **Audio does NOT work out of the box in the published Windows EXE.** The experimental developer binary does not bundle the Python 3.11 speech runtime, Chatterbox dependencies or model weights, and needs the inference source directory configured. A launchable UI and passing no-model tests are not successful TTS. For Windows setup, a no-download runtime check, an explicitly requested **real Hindi WAV smoke test**, and a launcher that configures the EXE without modifying system settings, see the [audio troubleshooting and launch guide](docs/installation/audio-troubleshooting.md). Real Hindi audio and clean-Windows acceptance remain unverified.


> **v0.5.2 release-candidate development (NOT PUBLISHED):** Source manifests, Windows unsigned candidate packaging and a manually dispatched exact-SHA release workflow are prepared for the next developer pre-release, alongside privacy-safe recovery improvements, Hindi subtitle cue preview and local caption search. These changes are **not in the published v0.5.1 binary**. Read [v0.5.2 draft notes](docs/releases/v0.5.2-notes.md) and [development details](docs/releases/v0.5.2-development.md). Do not call this version released until its tag and assets exist on GitHub; manual Hindi/Windows acceptance #3 remains open.

> **Latest experimental developer pre-release: [KathaSvara v0.5.1](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.5.1).** GitHub published this version after the [guarded release workflow](.github/workflows/release-v0.5.1.yml) passed its exact-SHA Python, React, Windows Rust/Clippy, Windows model-free journal/cache and unsigned EXE build checks, then verified the three downloadable attachments and SHA-256 digest. Read the [v0.5.1 release notes](docs/releases/v0.5.1-notes.md). **This is an unsigned, unbundled developer executable, not an installer or verified natural-Hindi narration.** Python 3.11, Chatterbox dependencies and approved model weights must be configured separately. Manual audio and clean-Windows acceptance remain open in [issue #3](https://github.com/sanskarIN/KathaSvara/issues/3).

> **Previous experimental developer pre-release: [KathaSvara v0.5.0](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.5.0).** The [guarded v0.5.0 workflow](.github/workflows/release-v0.5.0.yml) checks the exact main-branch commit, runs Python, React, Windows Rust, Windows Python cache-lock and Windows EXE build tests, then uploads the unsigned developer EXE, setup README and verified SHA-256 file. **This is not a standalone installer, signed binary, verified distinct-character TTS, or human-accepted natural Hindi narration.** Separately install compatible Python 3.11, approved Chatterbox model dependencies and weights. See [release notes](docs/releases/v0.5.0-notes.md), [Windows setup](docs/installation/portable-windows-candidate.md), [human acceptance issue #3](https://github.com/sanskarIN/KathaSvara/issues/3) and [npm dependency tracking #33](https://github.com/sanskarIN/KathaSvara/issues/33).

## Post-v0.5.1 development — subtitle cue review (not released)

Source development now adds **Preview dialogue cues** to the Character and Scene Studio after a generated WAV becomes available. It displays validated, glossary-adjusted Hindi captions and rounded timestamps ten at a time, lets the creator search captions locally and seek the inline WAV to a cue, and refuses duplicate, unknown-story, out-of-WAV or otherwise inconsistent timing metadata. Preview is local-only: **it does not export an SRT, claim a listening pass, or unlock the manual subtitle checklist**. Export dialogue SRT remains an explicit separate action. See [v0.5.2 development notes](docs/releases/v0.5.2-development.md); the latest published build is still v0.5.1, and [manual acceptance #3](https://github.com/sanskarIN/KathaSvara/issues/3) remains open.

## Post-v0.5.0 development (not a new release)

Source builds now use **React 19.3.1 / React DOM 19.3.1 with matching types**, TypeScript 7.0.2, Vite 8.3.5, React plugin 6.1.2 and Vitest 5.0.5, from the npm v3 lockfile under Node 22 `npm ci`. The React runtime/types upgrade was tested as one consistent dependency graph because updating React or React DOM alone fails locked peer installation. The migrated suite passed all 55 React tests, a TypeScript build, and an npm security audit reporting zero known vulnerabilities at check time. Active frontend CI checks high-severity npm advisories and weekly Dependabot updates are configured. This does **not** update the already-published v0.5.0 executable, certify long-term dependency security, or prove real Hindi narration quality. Review the [npm maintenance policy](docs/maintenance/npm-dependencies.md) and [security-update tracking issue #33](https://github.com/sanskarIN/KathaSvara/issues/33).

## v0.5.0 experimental pre-release — scene-by-scene readiness checks

Included WAV acceptance tooling can now flag unusually quiet recordings or many full-scale samples using bounded PCM statistics, without running a voice model. The warnings are diagnostic hints only; actual Hindi listening and clean-machine tests remain open in [issue #3](https://github.com/sanskarIN/KathaSvara/issues/3). See [offline WAV inspection](docs/qa/offline-wav-inspection.md).


New validation work includes **jsdom-based React interaction tests** of the desktop story controls using a mocked Tauri bridge. They exercise selected-scene rendering, measured SRT export, privacy-safe readiness reporting, stale-dialog protection and explicit recovery retry without downloading speech models. They do **not** verify real Hindi synthesis or a Windows desktop launch. Follow the [manual Windows and Hindi narration acceptance protocol](docs/qa/windows-hindi-acceptance.md) for evidence needed before any stable release.


Export usability in the v0.5.0 experimental preview: successful narration renders propose paired, Hindi-friendly `.wav`/`.srt` filenames with the generated full-story, scene or line scope captured at synthesis time. File dialogs are guarded against edits/new audio and existing destinations are never overwritten. This does not add an installer or prove real Hindi audio quality.


Also included in the experimental preview: **Retry current full story** (only after explicit confirmation from an interrupted/failed/cancelled history record, with a new job and unchanged cache reuse) and an **optional per-WAV human QA checklist**. The checklist does not persist or automatically verify Hindi pronunciation or distinct character voices. Subtitle review can be marked only after exporting SRT for the current WAV. See [v0.5.0 development notes](docs/releases/v0.5.0-development.md).


New **Export privacy-safe audit JSON** is available after a user runs the model-free scene readiness audit. It saves an explicitly requested JSON report of scene numbers, counts and fixed readiness codes; no script content, character names, scene/story IDs, model paths or recordings are exported. The native exporter validates the schema, rejects invalid claims and refuses to overwrite existing files. These experimental capabilities are **not** real-Hindi voice testing or evidence of stable release readiness. See [development details](docs/releases/v0.5.0-development.md).


Included in the v0.5.0 **experimental** developer preview: a no-model production audit inspects every Hindi scene independently and reports structural issues such as missing speaker assignments, scene size limits and stage-direction-only scenes. It separately reports whether the **whole story** can be rendered in one bounded job. Only aggregate counts and fixed reason codes cross the Python/Rust IPC; scene names stay in the local UI. This is not proof of real Hindi speech quality. See [v0.5.0 development plan](docs/releases/v0.5.0-development.md).

## v0.4.2 experimental developer preview — Hindi preflight and cache bounds

The next engineering batch adds **Inspect render plan (no model)** in Characters & Scenes. It validates dialogue selection and profiles, counts planned Hindi engine chunks after pronunciation rules, and shows aggregate bounds without loading a TTS model, generating speech or storing a new recovery journal. This is **unreleased development** and does not establish voice quality, real duration or clean Windows usability. See [v0.4.2 development notes](docs/releases/v0.4.2-development.md).

## v0.4.1 experimental developer preview — export, subtitles and recovery

- Preserve valid WAVs above the inline 25 MiB preview limit, offer export-only status, and stream new-file export safely with native WAV header checks.
- Match dialogue SRT text to the reviewed, glossary-adjusted text synthesized, validate real SubRip line breaks and millisecond cue ordering, and remove rejected post-render outputs.
- Preview then explicitly confirm bounded cleanup of old temporary WAV files and job-specific progress/cancellation files without touching final speech, stories or caches.
- Prevent incorrect segment re-render selection, honor early cancellation and keep overlong PCM and pause budgets out of the reusable speech cache.
- Developer preview only: no bundled Python/weights, stable installation or manually accepted voice-quality guarantee.

## v0.4.0 published experimental developer preview — subtitles and cross-process safety

**Published on GitHub as an experimental developer pre-release, not a stable installer.** v0.4.0 adds two creator-facing reliability capabilities beyond the [published v0.3.0 preview](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.3.0):

- **Safer shared cache across app instances:** participating Python 3.11 workers now acquire a persistent operating-system file lock while rendering or destructively pruning the segment cache. If another worker uses the same cache, the operation fails instead of racing. Lock release is owned by Windows or POSIX when the worker stops, even after an ungraceful exit. Legacy/nonparticipating programs are outside the guarantee.
- **Measured Hindi SubRip subtitles:** after completing a Characters & Scenes WAV render, export a matching `.srt` file with dialogue-by-dialogue cues based on actual PCM sample timings, not reading-speed guesses. This is not word-level forced alignment or automatically quality-checked Hindi transcription. Export never overwrites an existing file.

v0.4.0 release checks additionally exercise Windows Python cross-process locking. The final binary is still an **unsigned, unbundled developer EXE** requiring external compatible Python 3.11, Chatterbox model and separately obtained weights; no distinct-character voice or real Hindi listening result is claimed. See [v0.4.0 release notes](docs/releases/v0.4.0-notes.md) and [issue #3](https://github.com/sanskarIN/KathaSvara/issues/3).

## v0.3.0 published experimental pre-release — recoverable production workflow

**[Published on GitHub](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.3.0) as an experimental pre-release, not a stable product.** The v0.3.0 source gathers the v0.2.2 development work from [PR #7](https://github.com/sanskarIN/KathaSvara/pull/7), [PR #8](https://github.com/sanskarIN/KathaSvara/pull/8), and [PR #9](https://github.com/sanskarIN/KathaSvara/pull/9). The version-specific workflow verified the exact merge commit `3b5c810c3f535c86cc522e1879d600f231641fd6`, passed Python, React, Windows Rust and Windows EXE compilation checks, and verified the uploaded checksum assets. See [v0.3.0 release notes](docs/releases/v0.3.0-notes.md).

- Keep local speech caches bounded and inspectable, with explicit dry-run and confirmation before deleting old entries.
- Stream composed PCM16 story audio to a temporary file rather than hold the full mixed waveform in memory.
- Record text-free, per-job render journals, distinguish interrupted attempts, and manually retry to reuse unchanged cached speech.
- Show project-specific history with a confirmed delete for one inactive journal, without touching story scripts or audio.
- Avoid cache pruning and rendering at the same time **in one KathaSvara process**. This is not a cross-process filesystem lock.

**Experimental limits remain:** no confirmed distinct character voices; no model weights, signed installer or packaged Python; real Hindi audio listening and clean Windows launch are unverified. Final desktop base64 previews remain capped at 25 MiB.

## v0.2.0 experimental pre-release — characters and scenes

**Published experimental developer pre-release:** [merged PR #4](https://github.com/sanskarIN/KathaSvara/pull/4) adds versioned scene/character models, a deterministic Hindi dialogue parser, manual speaker correction, supported per-character engine settings, and a multi-segment audio orchestration layer. It extends the existing React/Tauri/Rust/Python app and preserves the v0.1.x narrator project files separately. See [v0.2.0 architecture](docs/architecture/v0.2.0-story-pipeline.md) and [release gates](docs/releases/v0.2.0-development.md).

**This functionality is still being tested.** Identifying `राजा भोज:` and `मंत्री:` in a written script does not mean the installed Chatterbox model produces two distinctly recognizable voices. The engine currently exposes only documented Hindi expressiveness/guidance controls; real multi-speaker voice consistency and audio quality are not accepted.

The [v0.2.0 pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.2.0) includes an **unsigned, unbundled Windows EXE** compiled on its release commit, with a `SHA256SUMS.txt` checksum and a dependency-warning `README.txt`. It requires external Python and model dependencies; do not treat it as a verified standalone installer. Automated release CI passed, but interactive launch and real Hindi listening acceptance remain open.

## v0.2.1 published developer preview — pronunciation and reliability

The [v0.2.1 experimental pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.2.1) delivers project-local pronunciation corrections, separately reviewed spoken text, exact no-model pre-TTS preview, selective content-keyed audio cache reuse, safe single-line retry, stronger cached-WAV checks and more reliable bounded Python subprocess IO. [PR #5](https://github.com/sanskarIN/KathaSvara/pull/5) was merged, and [the exact-commit release workflow](https://github.com/sanskarIN/KathaSvara/actions/runs/39370507279) passed all Python, React, Windows Rust, executable build, checksum and publication checks. **Distinct character voices, real Hindi listening and clean-machine interactive Windows acceptance remain unverified**.

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

This developer preview requires manual Python/Tauri setup and may need further integration fixes. No model weights or sample generated voices are bundled. See [v0.3.0 experimental release notes](docs/releases/v0.3.0-notes.md) for new source features and unreconciled manual acceptance checks.

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
| Python tests | Passing in the [v0.3.0 release workflow](https://github.com/sanskarIN/KathaSvara/actions/runs/39380201497); fake-model tests do not verify real model weights or Hindi audio |
| Multi-character voices | Future milestone |
| Full audio timeline and music mixing | Future milestone |
| Managed Python runtime / signed Windows installer | Future milestone |

Our priority is natural Hindi output, not feature counts. No private text or reference audio is uploaded by KathaSvara's current local inference bridge.

## Release history and next work

- **v0.4.0:** [published experimental developer pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.4.0) with measured spoken-segment Hindi SRT export and OS-managed Python cross-process cache safety; unsigned Windows developer EXE, SHA-256 companion and gated publication checks. Real voice quality and clean Windows acceptance remain in [issue #3](https://github.com/sanskarIN/KathaSvara/issues/3).
- **v0.3.0:** [published experimental developer pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.3.0) on tested commit [`3b5c810`](https://github.com/sanskarIN/KathaSvara/commit/3b5c810c3f535c86cc522e1879d600f231641fd6) with 10,412,032-byte unsigned Windows developer EXE, published SHA-256 companion, streaming combined WAV, cache controls, manual retry and interruption-aware journals. [Gated publication checks](https://github.com/sanskarIN/KathaSvara/actions/runs/39380201497) passed; real model listening and a clean-machine installer remain open.
- **v0.2.2:** development-only steps (PRs #7–#9) incorporated into v0.3.0, never published as a separate GitHub tag.
- **v0.1.0:** published source-only experimental developer preview after automated checks.
- **v0.1.1:** published source-only experimental developer pre-release with model-free setup diagnostics.
- **v0.2.0:** [published experimental developer pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.2.0) with scene/character authoring, deterministic dialogue parsing, bounded multi-segment rendering, cache and cooperative cancellation. Unsigned unbundled Windows EXE compiled by GitHub Actions; no real-model listening or clean-machine launch is claimed.
- **v0.2.1:** [published as an experimental developer pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.2.1) with verified Windows x64 EXE build/checksum, model-free pronunciation preview and selective retry. [Implementation PR #5](https://github.com/sanskarIN/KathaSvara/pull/5) is merged; manual tests remain tracked in [issue #3](https://github.com/sanskarIN/KathaSvara/issues/3).
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
