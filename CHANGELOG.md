# Changelog

## [v0.2.0 — Experimental developer pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.2.0)

- Add validated schema v2 for cast, voice profiles, scenes and dialogue segments, retaining v0.1.x project data without in-place rewrite.
- Parse explicitly labeled Hindi dialogue, narrator blocks, Markdown scene headings and stage directions; preserve unknown labels for manual resolution.
- Add Rust/Tauri v2 story persistence, Hindi parse bridge and a dedicated cast/scene editor.
- Add scene order, manual corrections, character duplication/reassignment and bounded per-character supported voice settings.
- Add model-reusing multi-segment PCM16 render orchestration, SHA-256 content cache, pause/fade assembly, progress, cooperative cancel signal and selective regeneration.
- Extend Python, Rust and TypeScript tests; start an unsigned Windows EXE candidate build workflow for internal verification.
- **Published as an experimental GitHub pre-release**, with an unsigned Windows EXE, checksum and explicit setup disclaimer. The EXE compiled in GitHub Actions, but real distinct-character voices, Chatterbox listening tests, clean Windows launch and production-ready installer remain unverified.


## [v0.1.1 — Source-only developer pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.1.1)

- Add a no-download diagnostics action that reports whether optional Python TTS dependencies are discoverable.
- Expose dependency findings in desktop Settings, while clearly marking model weights and Hindi audio playback **unverified**.
- Add deterministic diagnostic tests for missing and installed dependencies; no actual model downloads required.


## v0.1.0 — Source-only developer preview (pre-release candidate)

### Added

- Initial local inference module, Chatterbox Hindi adapter, Unicode processing and WAV assembly.
- Tauri Rust commands for local story projects, voice generation and WAV export.
- React Hindi story studio with basic voice controls and playback UI.
- Test foundation and CI workflow.
- Contributor, security, licensing, installation and model setup documents.

### Reliability and creator workflow improvements

- Added optional inspect-before-synthesize workflow showing exact normalized Hindi text and proposed speech chunks without model downloads.
- Added local TXT and Markdown story import with size/type validation.
- Remember supported voice parameters between desktop sessions.
- Invalidate generated-audio preview after changes to the script or voice settings.
- Reject NaN/Infinity voice parameters and use safer optional GPU-backend detection.
- Bound the local Python worker execution time and validate WAV chunk structure before playback/export.
- Added test cases and tightened CI scheduling to cancel superseded runs.
- Added explicit **Clear preview** handling and UUID-scoped deletion of cached WAV files when audio becomes stale.
- Clean up UUID-specific partial audio output if an inference worker fails or times out.

### Not yet verified

Real Hindi synthesis, supported OS desktop launches, complete end-to-end export, dependency compatibility, Windows packaging and standalone release artifacts. No v0.1.0 GitHub Release is claimed here.

> Publication is performed only by the passing v0.1.0 GitHub Actions release job. This changelog does not by itself confirm that a GitHub Release is live.
