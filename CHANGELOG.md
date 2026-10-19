# Changelog

## Unreleased — v0.1.0 development

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

### Not yet verified

Real Hindi synthesis, supported OS desktop launches, complete end-to-end export, dependency compatibility, Windows packaging and standalone release artifacts. No v0.1.0 GitHub Release is claimed here.
