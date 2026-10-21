KathaSvara v0.5.0 — Unsigned Windows x64 experimental developer executable
==================================================================

THIS IS NOT A COMPLETE INSTALLER OR A RELEASE-READY APPLICATION.

This unsigned v0.5.0 executable comes from a gated, exact-commit GitHub Actions
pre-release workflow only if all build, test and checksum checks succeed. It has not undergone end-user installation or manual
Hindi audio acceptance testing.

The desktop executable may open its React/Tauri UI, but real speech generation
REQUIRES a separately configured compatible Python 3.11 environment, the
KathaSvara inference sources, model dependencies, and downloaded model weights.
The executable does NOT bundle Chatterbox or a managed Python runtime.

Important environment variables:
  KATHASVARA_PYTHON       Absolute path to a Python 3.11 executable with
                          KathaSvara and Chatterbox dependencies installed.
  KATHASVARA_INFERENCE_DIR
                          Absolute path to services/inference source folder.
                          This is required outside the source checkout because
                          the developer build locates the source checkout only
                          when launched from an appropriate working directory.

Installation guidance: docs/installation/development.md in the GitHub repo.
Repository: https://github.com/sanskarIN/KathaSvara
Release checklist: https://github.com/sanskarIN/KathaSvara/issues/3

Environment Doctor (no downloads, no model loading):
- Open Settings > Inspect local TTS setup after launching the desktop UI.
- Check Python 3.11 compatibility, module discovery, configured interpreter and
  inference source paths, and local temporary-file write access.
- These are configuration hints, NOT proof that Chatterbox inference works.
- Review model license and approved weights separately before any synthesis.

Security and trust:
- Only download the executable from the verified KathaSvara GitHub prerelease or an authenticated project GitHub Actions build.
- Validate its SHA256SUMS.txt, and consider it untrusted until tested locally.
- The file is not code-signed and is not an MSI/NSIS installer.
- Windows SmartScreen warnings may apply to unsigned builds.
- Do not bypass security protections to run unverified binaries.
- Compatible WebView2 and the Tauri Windows prerequisites may be necessary.
- Real Hindi speech and multiple distinct character voices are unverified.
- SRT subtitle timestamps use measured speech-segment frame durations; these
  are not per-word alignments or independently verified subtitle timings.

No voice model, generated sample, or commercial voice-clone asset is bundled.
KathaSvara app sources are MPL-2.0; third-party dependencies/checkpoints have
separate license terms.

The guarded v0.5.0 release workflow can publish an experimental developer pre-release
only after tests, executable compilation and SHA-256 verification succeed.
This does NOT verify interactive launch or real Hindi narration on a clean machine.
The optional per-WAV review checklist does not verify voice identity by itself;
the offline WAV inspector checks file integrity and level warning hints only.
The latest documented manual QA procedure is in docs/qa/windows-hindi-acceptance.md.
Manual playback, project persistence, save/export, source compatibility and audio
acceptance remain open in issue #3.
