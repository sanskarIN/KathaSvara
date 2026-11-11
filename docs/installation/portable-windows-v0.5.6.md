KathaSvara v0.5.6 — Experimental Windows x64 developer preview
================================================================

NOT A COMPLETE INSTALLER. NOT STABLE. UNSIGNED and UNBUNDLED.
The release may not have been published yet; verify the actual tag,
assets and SHA256 companions before sharing:
https://github.com/sanskarIN/KathaSvara/releases/tag/v0.5.6

No Python 3.11, NumPy, SoundFile, PyTorch, Chatterbox Multilingual,
speech model weights, verified GPU configuration or installer is
bundled. A working UI or passing synthetic checks do not prove
natural Hindi speech. Human listening, speaker playback, real WAV/SRT
quality and clean Windows acceptance are NOT TESTED.
Human Hindi acceptance issue #3: https://github.com/sanskarIN/KathaSvara/issues/3

To configure the experimental desktop:
1. Obtain trusted KathaSvara v0.5.6 source and compatible Python 3.11.
2. Review TTS package/model licenses, RAM, GPU, storage and network
   before independently installing/obtaining approved dependencies.
3. Use the repository Windows helper with -DoctorOnly for local
   no-model preflight. Automatic downloads are not part of the doctor.
   To install optional speech dependencies, separately opt in to
   -InstallDependencies only after reviewing package licenses and
   expected network activity; weights still require their own approval.
4. In Settings, choose a trusted Python executable and matching
   services/inference folder. A version/source check runs before
   activation; choices are session-only and reversible.
5. Use "Check speech readiness" for model-free Python/WAV/import checks.
   A passing readiness report does NOT establish real Hindi speech.
6. For real model speech, separately opt in after reviewing whether
   first model load may download large third-party weights. Listen to
   the resulting local Hindi test WAV; export to a new file and inspect
   it using a trusted player if the embedded player cannot play it.
7. Validate actual scene/story WAV and SRT timing with human listening.
   No automated WAV header or signal warning is an acceptance pass.

PowerShell EXE checksum for a downloaded file:
  Get-FileHash -Algorithm SHA256 .\KathaSvara-v0.5.6-dev-win64.exe
Compare the full digest with SHA256SUMS.txt from the SAME GitHub release.
Do not bypass Windows security protections for unsigned test software.
NOT STABLE. Full activation issue #129; real Hindi acceptance issue #3.
