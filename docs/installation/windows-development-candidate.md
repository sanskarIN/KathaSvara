# Windows unreleased development candidate

**This is not the published v0.5.6 executable and is not a stable installer.**
Pull-request CI may create an unsigned, unbundled `KathaSvara-unreleased-dev-win64.exe`
file for developer testing. The source may now carry the `0.5.7`
development package version, but the latest published GitHub prerelease is
still `v0.5.6`. The candidate filename intentionally avoids confusing an
unreleased source snapshot with a published, tagged release asset.

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

## Check your Windows 11 PC without launching the app

A developer build may have a valid EXE but still show a blank window if its
required Windows WebView2 Runtime is absent or broken. Microsoft's official
[WebView2 Runtime distribution guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
documents the registry registration locations. To check the developer
candidate **without running it or loading Python/audio models**, use the
source-only script from the same trusted repository checkout in PowerShell:

```powershell
.\scripts\windows\inspect-desktop-candidate.ps1 `
  -ExecutablePath "C:\trusted-build\KathaSvara-unreleased-dev-win64.exe"
```

Keep the original `SHA256SUMS.txt` beside the EXE. The script rejects a
missing/mismatched manifest or malformed/non-x64 executable and reports
whether Microsoft's WebView2 registration is detected. It never downloads,
installs, launches, edits the registry or accesses the microphone. The
script only inspects the file you select and reports a fixed explanation
without printing private paths.

**WebView2 detection is a setup hint, not a successful launch test.** A
registered runtime could still be broken, a working runtime could be
unobservable through these checks, and a signed/hashed EXE could still
contain unsafe code. If WebView2 is not found, consult the official Microsoft
distribution guidance rather than changing the registry or disabling Windows
security settings. Neither passing diagnostics nor passing CI certifies a
functioning GUI or correct Hindi audio.

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
