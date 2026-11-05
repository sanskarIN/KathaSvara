KathaSvara v0.5.4 — Experimental Windows x64 developer preview
===============================================================

NOT A COMPLETE INSTALLER. NOT STABLE. This is an UNSIGNED, UNBUNDLED
Windows x64 developer executable. A source candidate or GitHub Actions
artifact is not a published release. Confirm publication only by
checking https://github.com/sanskarIN/KathaSvara/releases/tag/v0.5.4
and verifying the EXE against SHA256SUMS.txt.

The executable does NOT include Python 3.11, NumPy, SoundFile, PyTorch,
Chatterbox Multilingual, approved model/checkpoint weights, or a
configured Hindi speech runtime. An application window or a successful
no-model diagnostic does NOT mean narration will work. Real Hindi
listening, distinct voices and clean Windows acceptance remain
unverified in issue #3 at
https://github.com/sanskarIN/KathaSvara/issues/3

For local development you need:
- Windows 11 x64 and the supported WebView2 runtime.
- KathaSvara source checkout matching the developer EXE.
- Compatible Python 3.11 and source directory services/inference.
- Separate approved speech dependencies and authorized model weights.
- The settings KATHASVARA_PYTHON and KATHASVARA_INFERENCE_DIR pointing to
  your local interpreter and inference folder (private paths).

From an intact source checkout, use scripts/windows/launch-with-audio.ps1
with -DoctorOnly for model-free checks. If packages are missing, it
provides one recommended next step rather than downloading anything.
-InstallDependencies is an explicit separate opt-in that may install
large third-party packages; read their terms before proceeding.
Optional -CpuOnly and -ModelV3 modes require compatible dependencies.
A local voice reference must be your own recording or one you have
permission to use. Neither a doctor check nor WAV structural inspection
certifies actual spoken Hindi. An explicit -VerifyHindiSpeech may load
or download weights; inspect and listen to its real output independently.

Check the published release checksum (PowerShell):
  Get-FileHash -Algorithm SHA256 .\KathaSvara-v0.5.4-dev-win64.exe

Compare the full SHA-256 digest to SHA256SUMS.txt from that same release.
Do not turn off OS security checks to bypass unsigned-binary warnings.

NOT STABLE. Manual real Hindi listening and clean Windows QA: issue #3.
