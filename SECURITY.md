# Security policy

KathaSvara v0.1.0 is **development source**, not a security-reviewed production audio workstation.

## Reporting issues

Report privately using the [contact page](https://sanskarin.github.io/contact/#send-a-message) or email sanskarprogrammer@gmail.com. Please include the affected component, impact, reproduction steps and version. Do not publish proof-of-concept vulnerabilities exposing private user voices or scripts.

## Current trust boundary

- A Tauri desktop process starts a Python interpreter locally through an explicit subprocess; no local HTTP port is opened by the app.
- The Python executable can be configured with the KATHASVARA_PYTHON environment variable. Do not point it to untrusted executables.
- Model checkpoints may be downloaded by Chatterbox on first use. Review repository/model provenance, checkpoint formats and terms before installing.
- Current source is not a self-contained installer and has not been independently security audited.
- The desktop renderer is granted only core permissions and a save-file dialog; exported WAVs are restricted to generated audio IDs.
- User scripts and voices should remain private. Consent is required to use another person's voice samples.

Never disclose credentials, access tokens or private sample audio in issues, logs or pull requests.
