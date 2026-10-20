KathaSvara v0.2.0 — Unsigned Windows developer executable candidate
==================================================================

THIS IS NOT A COMPLETE INSTALLER OR A RELEASE-READY APPLICATION.

This unsigned executable comes from a GitHub Actions test build (if that
workflow succeeds). It has not undergone end-user installation or manual
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
                          the development default is a path relative to the
                          compilation directory.

Installation guidance: docs/installation/development.md in the GitHub repo.
Repository: https://github.com/sanskarIN/KathaSvara
Release checklist: https://github.com/sanskarIN/KathaSvara/issues/3

Security and trust:
- Only download the executable from a verified KathaSvara GitHub Actions run.
- Validate its SHA256SUMS.txt, and consider it untrusted until tested locally.
- The file is not code-signed and is not an MSI/NSIS installer.
- Windows SmartScreen warnings may apply to unsigned builds.
- Do not bypass security protections to run unverified binaries.
- Compatible WebView2 and the Tauri Windows prerequisites may be necessary.
- Real Hindi speech and multiple distinct character voices are unverified.

No voice model, generated sample, or commercial voice-clone asset is bundled.
KathaSvara app sources are MPL-2.0; third-party dependencies/checkpoints have
separate license terms.

The v0.2.0 pre-release MUST NOT be published based only on this candidate.
Manual executable launch, playback, project persistence, save/export, source
archive and audio acceptance tests remain mandatory.
