# Windows unreleased development candidate

**This is not the published v0.5.6 executable and is not a stable installer.**
Pull-request CI may create an unsigned, unbundled `KathaSvara-unreleased-dev-win64.exe`
file for developer testing. The source may still have the `0.5.6` package
version because no next release version has been approved; the filename
intentionally avoids confusing the snapshot with an official release asset.

## Verify exactly what was built

1. Open the relevant GitHub pull request's **Build unsigned Windows EXE
   candidate** workflow run and access its retained artifact.
2. Read **README.txt** inside that artifact. It identifies the checked-out
   source SHA, PR head SHA and workflow run ID. GitHub's pull-request checkout
   SHA can be a temporary merge commit, not the PR head itself; keep both.
3. Check the **SHA256SUMS.txt from the same artifact** against the EXE with
   PowerShell:

   ```powershell
   Get-FileHash -Algorithm SHA256 .\KathaSvara-unreleased-dev-win64.exe
   ```

4. Treat a matching hash as a transport-integrity check only, not code signing,
   malware scanning, functioning Hindi audio or Windows compatibility proof.

The official v0.5.6 developer pre-release remains separately available at
https://github.com/sanskarIN/KathaSvara/releases/tag/v0.5.6.
Never substitute an unreleased candidate for that tagged release when
reporting installed versions or reproducible acceptance results.

## Honest runtime limits

The candidate does **not** bundle Python 3.11, speech libraries, Chatterbox,
faster-whisper, model weights or a managed installer. A successful React,
Python, Rust or Windows EXE CI run does **not** show that microphone
permissions work in WebView2, that an offline model can transcribe a real Hindi
recording, or that synthesized speech is audible and intelligible.

Use [audio troubleshooting](audio-troubleshooting.md) for explicit Python/TTS
configuration and [offline Hindi STT](../features/offline-hindi-stt.md) for
separate optional faster-whisper model setup. Package and model installation
or downloads are never implied by obtaining the developer EXE.

Manual Windows and Hindi acceptance remains open in
[issue #3](https://github.com/sanskarIN/KathaSvara/issues/3),
[issue #129](https://github.com/sanskarIN/KathaSvara/issues/129) and
[STT issue #142](https://github.com/sanskarIN/KathaSvara/issues/142).
