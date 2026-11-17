KathaSvara v0.5.7 — Experimental Windows x64 developer preview
================================================================

NOT A COMPLETE INSTALLER. NOT STABLE. UNSIGNED and UNBUNDLED.
This note alone is not confirmation of a published release. Check the
actual GitHub tag and three assets before using any download:
https://github.com/sanskarIN/KathaSvara/releases/tag/v0.5.7

No Python 3.11, Chatterbox, PyTorch, faster-whisper, model weights or
managed installer is included. Hindi TTS/STT does not work out of the
box. Real Windows 11 microphone permission, listening and recognition
accuracy, and clean-machine usability are NOT TESTED.

1. Obtain trusted source and Python 3.11 separately.
2. Run scripts/windows/launch-with-audio.ps1 -DoctorOnly for model-free
   TTS checks. -InstallDependencies explicitly installs TTS libraries
   after your review; it may download packages, not weights.
3. For STT, explicitly choose -InstallSttDependencies and independently
   obtain a licensed multilingual local CTranslate2 faster-whisper model.
   -SttDoctorOnly -SttModelPath checks local setup without model load.
4. Open Settings, select matching Python/source and local STT model/WAV.
   Only record from the microphone after explicit OS/WebView2 permission.
5. With separate consent, transcribe; compare and correct Hindi text
   before inserting it into the story editor.
6. For TTS, approve model downloads separately and manually review real
   audio playback, exported WAV and SRT timing.

Checksum in PowerShell:
  Get-FileHash -Algorithm SHA256 .\KathaSvara-v0.5.7-dev-win64.exe
Compare with SHA256SUMS.txt from the SAME release.
Do not bypass Windows security safeguards for unsigned software.
Human Hindi acceptance issue #3:
https://github.com/sanskarIN/KathaSvara/issues/3
STT QA issue #142: https://github.com/sanskarIN/KathaSvara/issues/142
NOT STABLE.
