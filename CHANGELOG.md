# Changelog

## v0.2.2 — Unreleased development

- Add model-free inspection of the local SHA-256 speech-segment cache and opt-in bounded oldest-entry cleanup.
- Provide a dry-run plan before asking for explicit confirmation in the desktop Settings page; preserve recent cache entries and ignore symlinks, projects, and unrelated output files.
- Protect the Rust/Python bridge against oversized worker output deadlocks by continuing to drain stdout without exceeding the response memory cap.
- Stream composed story WAV output to a temporary file instead of retaining the full story waveform in memory; finalize the WAV and refuse to overwrite a new destination.
- Keep privacy-minimal, atomic per-job render journals with completed segment IDs, cached fingerprints and terminal states; show recent attempts per story with explicit retry guidance.
- Extend regression coverage for cache-assisted retries, cancellation and partial-file cleanup while maintaining the requirement for manual real-model acceptance.
- **Not yet published:** this development work does not change the verified v0.2.1 GitHub pre-release.

## [v0.2.1 — Published experimental developer pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.2.1)

- Add a validated project-local pronunciation glossary (NFC, Devanagari-aware word boundaries, escaped literal matching, deterministic nonrecursive overrides), plus no-model exact pre-TTS text preview.
- Support reversible editing of reviewed spoken text without altering original story scripts or stage directions.
- Keep schema v2 backwards-compatible with v0.2.0 projects that lack optional glossary records; preserve v0.1.x files separately.
- Add stricter cache format/sample checks and reuse unchanged effective speech after unrelated pronunciation corrections; mock-engine tests never count as human voice evidence.
- Improve redacted Environment Doctor for Python/inference directory configuration and local write readiness.
- Handle first-time story IDs and stale in-flight audio more cautiously; retain unsupported/unknown speaker labels honestly.
- Add Python/React/Rust regression coverage, and replace the v0.2.0 commit-message publisher with a guarded v0.2.1 SHA-pinned manual pre-release workflow.
- **Distribution:** published an unsigned, unbundled Windows x64 EXE after [passing exact-commit checks](https://github.com/sanskarIN/KathaSvara/actions/runs/39370507279) and SHA-256 asset verification; no packaged weights, signed installer, real Hindi listening claim, or verified separate character voices. See [acceptance issue #3](https://github.com/sanskarIN/KathaSvara/issues/3).


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
