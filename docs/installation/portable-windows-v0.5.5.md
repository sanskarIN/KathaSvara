KathaSvara v0.5.5 — Experimental Windows x64 developer preview
===============================================================

NOT A COMPLETE INSTALLER. NOT STABLE. This is an UNSIGNED, UNBUNDLED
Windows x64 developer executable. A build artifact or source branch
does not imply a published release. Check the public GitHub tag and
three release companions before sharing:
https://github.com/sanskarIN/KathaSvara/releases/tag/v0.5.5

The executable does NOT contain Python 3.11, NumPy, SoundFile,
PyTorch, Chatterbox Multilingual, a configured runtime, or speech
model weights. Neither a working window nor a passing synthetic WAV
check means genuine Hindi narration works. Human listening, multi-
speaker identity and clean-Windows acceptance are still unverified
under issue #3: https://github.com/sanskarIN/KathaSvara/issues/3

To use all *implemented* features that require speech:
1. Install Python 3.11 and review the relevant Chatterbox and
   speech-model licenses, privacy requirements and hardware needs.
2. Get the corresponding KathaSvara v0.5.5 source checkout.
3. Use the explicit Windows helper from the repository root with
   -DoctorOnly to inspect the environment without downloads.
4. To install speech dependencies, consciously opt in to
   -InstallDependencies and review the software/network activity.
   Model weights are not included and may require separate approvals.
5. Open the desktop EXE, go to Settings, choose your trusted Python
   executable and the matching services/inference source folder.
   The selected paths exist only in this app session. Run the
   no-model import doctor and disposable WAV I/O check.
6. Start with a short real Hindi sample, listen to the WAV carefully,
   and only then review scene renders, exports and subtitles.
   No automated test certifies pronunciation, audio quality or
   individual character voice identity.

If the real TTS model cannot load, story editing and local project
features can still be used. The voice generation and dependent WAV
and SRT exports require successful audio rendering and valid timing.

PowerShell verification of the downloaded EXE:
  Get-FileHash -Algorithm SHA256 .\KathaSvara-v0.5.5-dev-win64.exe

Compare its full digest to SHA256SUMS.txt from the SAME GitHub Release.
Do not bypass Windows security protections to run an unsigned binary.
NOT STABLE. Full feature activation: issue #129. Hindi QA: issue #3.
