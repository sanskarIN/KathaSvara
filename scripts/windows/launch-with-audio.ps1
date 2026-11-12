# SPDX-License-Identifier: MPL-2.0
# Explicit development setup for the unbundled KathaSvara Windows EXE.
# No downloads, model loading or registry changes unless -InstallDependencies
# (packages only) or the user later explicitly presses Generate in the app.
[CmdletBinding()]
param(
    [string]$ExecutablePath = "",
    [string]$PythonPath = "",
    [switch]$InstallDependencies,
    [switch]$InstallSttDependencies,
    [switch]$DoctorOnly,
    [switch]$SttDoctorOnly,
    [string]$SttModelPath = "",
    [switch]$VerifyHindiSpeech,
    [switch]$CpuOnly,
    [switch]$ModelV3,
    [string]$ReferenceWavPath = "",
    [int]$RenderTimeoutMinutes = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ($DoctorOnly -and $VerifyHindiSpeech) {
    Write-Error "Choose either -DoctorOnly (no model) or -VerifyHindiSpeech (real model)."
    exit 1
}
if ($SttDoctorOnly -and ($DoctorOnly -or $VerifyHindiSpeech)) {
    Write-Error "Choose only one of -SttDoctorOnly, -DoctorOnly, or -VerifyHindiSpeech."
    exit 1
}
if ($SttModelPath -and -not $SttDoctorOnly) {
    Write-Error "Use -SttModelPath only with -SttDoctorOnly. A model is never loaded by the doctor."
    exit 1
}
if ($SttDoctorOnly -and $RenderTimeoutMinutes -ne 0) {
    Write-Error "RenderTimeoutMinutes applies only to desktop TTS jobs, not STT setup."
    exit 1
}
if ($RenderTimeoutMinutes -ne 0 -and
    ($RenderTimeoutMinutes -lt 10 -or $RenderTimeoutMinutes -gt 120)) {
    Write-Error "RenderTimeoutMinutes must be 10 through 120, or omit it for the 10-minute default."
    exit 1
}

function Fail([string]$Message) {
    Write-Error $Message
    exit 1
}

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$inference = Join-Path $root "services\inference"
$cli = Join-Path $inference "kathasvara\cli.py"
if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) {
    Fail "Inference sources were not found. Run this script from an intact KathaSvara source checkout."
}

$venvPython = Join-Path $inference ".venv\Scripts\python.exe"
$python = $null
if ($PythonPath) {
    if (-not [System.IO.Path]::IsPathRooted($PythonPath) -or
        -not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) {
        Fail "PythonPath must point to an existing absolute Python 3.11 executable."
    }
    $python = (Resolve-Path -LiteralPath $PythonPath).Path
} elseif (Test-Path -LiteralPath $venvPython -PathType Leaf) {
    $python = $venvPython
} elseif ($InstallDependencies -or $InstallSttDependencies) {
    if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
        Fail "Python 3.11 launcher 'py' is unavailable. Install Python 3.11 first."
    }
    Write-Host "Creating the Python 3.11 inference environment..."
    & py -3.11 -m venv (Join-Path $inference ".venv")
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
        Fail "Unable to create a Python 3.11 virtual environment."
    }
    $python = $venvPython
} else {
    Fail "No KathaSvara Python environment was found. Run this script with -InstallDependencies once, or pass -PythonPath pointing to a configured Python 3.11 interpreter."
}

$version = & $python -c "import sys; print(str(sys.version_info.major) + '.' + str(sys.version_info.minor))"
if ($LASTEXITCODE -ne 0 -or $version.Trim() -ne "3.11") {
    Fail "KathaSvara requires Python 3.11; the chosen interpreter reports $version."
}

if ($InstallDependencies) {
    Write-Warning "This explicitly downloads and installs substantial third-party Python packages; weights are NOT included. Check their respective licenses and terms."
    Push-Location $inference
    try {
        & $python -m pip install -e ".[tts]"
        if ($LASTEXITCODE -ne 0) { Fail "The Python speech dependency installation failed; review pip's output above." }
    } finally {
        Pop-Location
    }
}
if ($InstallSttDependencies) {
    # STT is a separately selected optional extra: never silently mix it into
    # the existing TTS dependency install or fetch recognition weights.
    Write-Warning "You explicitly opted into the offline STT Python package installation. pip may download packages. No recognition model weights are installed or fetched by this script."
    Push-Location $inference
    try {
        & $python -m pip install -e ".[stt]"
        if ($LASTEXITCODE -ne 0) { Fail "Offline STT Python dependency installation failed. Review pip output and retry." }
    } finally {
        Pop-Location
    }
}

# These environment variables apply only to this shell and the child EXE.
# The Windows user's persistent environment and registry are untouched.
$env:KATHASVARA_PYTHON = $python
$env:KATHASVARA_INFERENCE_DIR = $inference
if ($RenderTimeoutMinutes -ne 0) {
    # Only audio generation jobs receive this process-scoped timeout; no
    # registry modifications and no change to diagnostic command budgets.
    $env:KATHASVARA_TTS_JOB_TIMEOUT_SECONDS = [string]($RenderTimeoutMinutes * 60)
    Write-Host ("Audio job timeout set to " + $RenderTimeoutMinutes +
        " minutes. The desktop still supports explicit cancellation.")
}
if ($CpuOnly) {
    # Bypass a failing CUDA/MPS availability probe in the Python adapter.
    # Applies only to this script and the child EXE, not the user's registry.
    $env:KATHASVARA_TTS_DEVICE = "cpu"
    Write-Host "CPU-only TTS selected. Rendering may be slower; real speech is unverified."
}
if ($ModelV3) {
    # An explicitly opted-in multilingual checkpoint, not a silent migration.
    $env:KATHASVARA_TTS_MODEL = "v3"
    Write-Warning "Experimental multilingual V3 selected. First generation may download additional model weights; your chatterbox-tts must support t3_model=v3."
}
if ($ReferenceWavPath) {
    if (-not [System.IO.Path]::IsPathRooted($ReferenceWavPath) -or
        [System.IO.Path]::GetExtension($ReferenceWavPath).ToLowerInvariant() -ne ".wav" -or
        -not (Test-Path -LiteralPath $ReferenceWavPath -PathType Leaf)) {
        Fail "ReferenceWavPath must be an existing absolute local .wav file."
    }
    $env:KATHASVARA_TTS_REFERENCE_WAV = (Resolve-Path -LiteralPath $ReferenceWavPath).Path
    Write-Host "Local voice reference selected. Use only a recording you own or have permission to use; no audio has been uploaded."
}

# This is a standalone, opt-in STT setup path. It does not run the TTS
# runtime doctor, load recognition weights, request microphone access or
# transcribe any recording. All reported advice comes from fixed strings.
if ($SttDoctorOnly) {
    $selectedModel = $null
    if ($SttModelPath) {
        if (-not [System.IO.Path]::IsPathRooted($SttModelPath) -or
            -not (Test-Path -LiteralPath $SttModelPath -PathType Container)) {
            Fail "SttModelPath must be an existing absolute local model folder."
        }
        $selectedModel = (Resolve-Path -LiteralPath $SttModelPath).Path
    }
    # Use one *scalar* JSON string: Windows PowerShell 5.1 pipeline
    # conversion may enumerate dictionary entries instead of serializing
    # one request object. A missing model is a known literal JSON null.
    if ($null -eq $selectedModel) {
        $payload = '{"action":"probe_stt_setup","model_path":null}'
    } else {
        $payload = [string](ConvertTo-Json -InputObject @{
            action = "probe_stt_setup"
            model_path = $selectedModel
        } -Compress)
    }
    if (-not $payload -or $payload.Length -gt 16384) {
        Fail "The offline STT setup request is invalid or too large."
    }
    try {
        $checkRequest = $payload | ConvertFrom-Json
        if ($checkRequest.action -ne "probe_stt_setup") {
            Fail "The offline STT setup request is invalid."
        }
    } catch {
        Fail "The offline STT setup request could not be serialized."
    }
    Write-Host "Checking local STT imports and model file presence (no model load or transcription)..."
    # Windows PowerShell 5.1 can prepend a BOM or otherwise change piped
    # native-command stdin encoding, producing JSONDecodeError even for an
    # ASCII payload. Use a process-owned, BOM-free UTF-8 stream instead.
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $python
    $startInfo.Arguments = "-m kathasvara.cli"
    $startInfo.WorkingDirectory = $inference
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    $startInfo.StandardOutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        try {
            if (-not $process.Start()) {
                Fail "The local offline STT setup process could not start."
            }
        } catch {
            Fail "The local offline STT setup process could not start."
        }
        # Start reading both pipes before writing stdin to avoid deadlocks.
        # Never display raw stderr: it could contain private local paths.
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        # Bypass native-pipeline and text-writer transcoding entirely.
        # Exactly these UTF-8 bytes, with no BOM or newline, become stdin.
        $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes([string]$payload)
        $stdin = $process.StandardInput.BaseStream
        try {
            $stdin.Write($bytes, 0, $bytes.Length)
            $stdin.Flush()
        } finally {
            # EOF releases sys.stdin.read() in kathasvara.cli.
            $stdin.Close()
        }
        if (-not $process.WaitForExit(90000)) {
            try { $process.Kill() } catch { }
            Fail "Offline STT source preflight timed out. Check the Python interpreter."
        }
        $rawStt = $stdoutTask.GetAwaiter().GetResult()
        $null = $stderrTask.GetAwaiter().GetResult()
        $exitCode = $process.ExitCode
        if ($exitCode -ne 0 -or -not $rawStt) {
            # Only fixed categories from KathaSvara's JSON error envelope
            # are reported, never the raw response or native exception.
            $reason = "bridge_startup"
            if ($rawStt) {
                try {
                    $failure = ($rawStt | ConvertFrom-Json)
                    if ($failure.ok -eq $false -and $failure.error -eq "JSONDecodeError") {
                        $reason = "json_input_encoding"
                    } elseif ($failure.ok -eq $false -and $failure.error -eq "UnicodeDecodeError") {
                        $reason = "stdin_encoding"
                    } elseif ($failure.ok -eq $false) {
                        $reason = "request_rejected"
                    }
                } catch { $reason = "invalid_worker_response" }
            }
            Fail ("The local offline STT setup probe could not run (" + $reason +
                "). Verify Python 3.11 and matching inference sources.")
        }
        try { $stt = $rawStt | ConvertFrom-Json }
        catch { Fail "The offline STT setup probe did not return valid JSON." }
    } finally {
        $process.Dispose()
    }
    if (-not $stt.ok -or -not $stt.result -or
        $stt.result.model_loaded -ne $false -or
        $stt.result.audio_transcribed -ne $false -or
        $stt.result.network_used -ne $false) {
        Fail "The offline STT probe returned an invalid or non-offline status."
    }
    $firstStep = [string]$stt.result.next_action_code
    $hints = @{
        select_python_311 = "Select the Python 3.11 interpreter, then retry the STT doctor."
        install_stt_extra = 'Explicitly install the optional Python packages using -InstallSttDependencies -SttDoctorOnly.'
        select_local_model = "Select a separately installed, licensed multilingual CTranslate2 faster-whisper model with -SttModelPath."
        run_transcription = "STT imports and local files passed. Open the development desktop app and explicitly transcribe a short Hindi WAV; human review remains required."
    }
    foreach ($key in @("python_311", "stt_import_ok", "model_files_present", "ready_to_transcribe")) {
        if ($stt.result.PSObject.Properties[$key] -eq $null -or
            $stt.result.PSObject.Properties[$key].Value -isnot [bool]) {
            Fail "The offline STT setup probe returned an inconsistent report."
        }
    }
    $expectedReady = ($stt.result.python_311 -and $stt.result.stt_import_ok -and $stt.result.model_files_present)
    if (-not $hints.ContainsKey($firstStep) -or
        $stt.result.ready_to_transcribe -ne $expectedReady -or
        $stt.result.ready_to_transcribe -ne ($firstStep -eq "run_transcription")) {
        Fail "The offline STT setup probe returned an inconsistent report."
    }
    if ([bool]$stt.result.ready_to_transcribe) {
        Write-Host "STT source preflight passed. No model loaded, WAV inspected or Hindi speech recognized."
    } else {
        Write-Host "STT setup still needs attention. No model loaded or audio transcribed."
    }
    Write-Host ("Recommended next step: " + $hints[$firstStep])
    exit 0
}

Write-Host "Checking the configured Python bridge without loading a speech model..."
Push-Location $inference
try {
    $raw = '{"action":"diagnose"}' | & $python -m kathasvara.cli
    if ($LASTEXITCODE -ne 0 -or -not $raw) { Fail "The local Python inference bridge failed. Check package installation and source paths." }
    try { $diagnostic = ($raw | Select-Object -Last 1) | ConvertFrom-Json }
    catch { Fail "The Python bridge did not return a readable diagnostic JSON object." }
} finally { Pop-Location }
if (-not $diagnostic.ok -or -not $diagnostic.result.python_311) {
    Fail "The local Python bridge failed its Python 3.11 check."
}
# Missing packages are common on a clean installation. Let the import probe
# return one fixed repair action instead of exiting before the audio doctor.
# Imports are model-free and do not download package or checkpoint weights.
if (-not $diagnostic.result.dependencies_present) {
    Write-Host "Some optional speech packages are absent; running the model-free import doctor for a recommended repair."
}
if (-not $diagnostic.result.temporary_write_test_passed) {
    Fail "Python cannot write temporary files; speech synthesis cannot be used safely."
}
# This separate, disposable PCM16 round-trip uses only the Python standard
# library and the KathaSvara structural inspector. It helps distinguish WAV
# filesystem problems from TTS package/model problems, but not speaker output.
Write-Host "Testing temporary PCM16 WAV write and read-back (no model, no playback)..."
Push-Location $inference
try {
    $rawWavProbe = '{"action":"probe_audio_io"}' | & $python -m kathasvara.cli
    if ($LASTEXITCODE -ne 0 -or -not $rawWavProbe) {
        Fail "The offline WAV I/O doctor did not respond."
    }
    try { $wavProbe = ($rawWavProbe | Select-Object -Last 1) | ConvertFrom-Json }
    catch { Fail "The offline WAV I/O doctor returned unreadable JSON." }
} finally { Pop-Location }
if (-not $wavProbe.ok -or -not $wavProbe.result -or
    -not $wavProbe.result.temporary_wav_roundtrip_ok) {
    $stage = "unknown"
    if ($wavProbe.result -and $wavProbe.result.failed_stage) {
        $stage = [string]$wavProbe.result.failed_stage
    }
    Fail ("Temporary PCM16 WAV I/O self-test failed at " + $stage +
        ". Check temporary folder permissions, free disk space and local file access.")
}
Write-Host "Offline WAV I/O check passed. This does NOT verify Chatterbox, Hindi speech or audio playback."
# Discoverable packages can still fail to import because of incompatible native
# PyTorch/SoundFile DLLs or a missing Chatterbox multilingual entrypoint.
# This optional-import command NEVER calls from_pretrained or downloads weights.
Write-Host "Checking actual speech library imports (no model weights loaded)..."
Push-Location $inference
try {
    $rawProbe = '{"action":"probe_runtime"}' | & $python -m kathasvara.cli
    if ($LASTEXITCODE -ne 0 -or -not $rawProbe) {
        Fail "Unable to check speech imports. Verify the configured Python interpreter and inference source."
    }
    try { $importProbe = ($rawProbe | Select-Object -Last 1) | ConvertFrom-Json }
    catch { Fail "The speech import probe returned unreadable JSON." }
} finally { Pop-Location }
if (-not $importProbe.ok -or -not $importProbe.result) {
    Fail "The speech import probe failed. Check your Python 3.11 environment."
}
if (-not $importProbe.result.preflight_ok) {
    $failed = @($importProbe.result.checks.PSObject.Properties |
        Where-Object { $_.Value -ne "ok" } |
        ForEach-Object { $_.Name + " (" + $_.Value + ")" })
    if (-not $importProbe.result.python_311) { $failed += "python_311 (required)" }
    if (-not $importProbe.result.device_configuration_valid) {
        $failed += "KATHASVARA_TTS_DEVICE (must be auto or cpu)"
    }
    if (-not $importProbe.result.model_configuration_valid) {
        $failed += "KATHASVARA_TTS_MODEL (must be v2 or v3)"
    }
    if ($importProbe.result.reference_voice_status -eq "invalid") {
        $failed += "KATHASVARA_TTS_REFERENCE_WAV (must be valid 16-bit PCM WAV)"
    }
    if (-not $importProbe.result.upstream_api_compatible) {
        switch ($importProbe.result.upstream_api_status) {
            "v3_unsupported" { $failed += "Chatterbox V3 API missing (update chatterbox-tts)" }
            "reference_unsupported" { $failed += "Chatterbox reference WAV API missing (update chatterbox-tts)" }
            "unverifiable" { $failed += "Chatterbox selected API cannot be verified" }
            default { $failed += "Chatterbox selected API unavailable" }
        }
    }
    Fail ("Speech runtime preflight failed: " + ($failed -join ", ") +
        ". Recommended next step: " + $importProbe.result.next_action)
}
Write-Host ("Speech preflight passed (device: " + $importProbe.result.tts_device_mode +
    "; model: " + $importProbe.result.tts_model_variant +
    "; voice reference: " + $importProbe.result.reference_voice_status +
    "; upstream API: " + $importProbe.result.upstream_api_status +
    "). Model weights, hardware capability and Hindi audio are NOT verified.")
Write-Host ("Recommended next step: " + $importProbe.result.next_action)
Write-Host "The first explicit Generate action may need an internet connection, model-weight access, storage, and compatible hardware."

if ($DoctorOnly) {
    Write-Host "DoctorOnly complete. No speech model was loaded and no WAV was generated."
    exit 0
}

if ($VerifyHindiSpeech) {
    # This is an EXPLICIT real TTS test: it may download large model weights,
    # consume RAM/VRAM, and take time. It never runs in no-model CI checks.
    $output = Join-Path ([System.IO.Path]::GetTempPath()) (
        "kathasvara-hindi-smoke-" + [guid]::NewGuid().ToString("N") + ".wav")
    # Windows PowerShell 5.1 reads BOM-less .ps1 files as ANSI. Keep the
    # source ASCII-only and decode the Hindi sample from JSON Unicode escapes.
    $hindiText = '"\u0928\u092e\u0938\u094d\u0915\u093e\u0930\u0964 \u092f\u0939 \u0915\u0925\u093e\u0938\u094d\u0935\u0930 \u0915\u0940 \u0935\u093e\u0938\u094d\u0924\u0935\u093f\u0915 \u0939\u093f\u0902\u0926\u0940 \u0906\u0935\u093e\u091c\u093c \u091c\u093e\u0901\u091a \u0939\u0948\u0964"' | ConvertFrom-Json
    $payload = @{
        action = "synthesize"
        text = $hindiText
        output = $output
        exaggeration = 0.5
        cfg_weight = 0.5
    } | ConvertTo-Json -Compress
    # Windows PowerShell 5.1 would otherwise send non-ASCII stdin as ASCII.
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    Write-Host "Running a REAL Hindi synthesis test. First use may download model weights."
    Push-Location $inference
    try {
        $rawSmoke = $payload | & $python -m kathasvara.cli
        if ($LASTEXITCODE -ne 0 -or -not $rawSmoke) {
            Fail ("Real Hindi speech test failed. Examine the local Python message: " +
                (($rawSmoke | Select-Object -Last 1) -join ""))
        }
        $result = ($rawSmoke | Select-Object -Last 1) | ConvertFrom-Json
        if (-not $result.ok -or -not (Test-Path -LiteralPath $output -PathType Leaf)) {
            Fail "The model did not create a valid output WAV. Check model access and hardware."
        }
        # A file larger than 44 bytes is not necessarily valid PCM audio.
        # Reuse the same bounded, read-only WAV inspector used by the app; it
        # checks the actual RIFF structure and all declared audio frames.
        $inspectionPayload = @{
            action = "inspect_generated_wav"
            path = $output
        } | ConvertTo-Json -Compress
        $rawInspection = $inspectionPayload | & $python -m kathasvara.cli
        if ($LASTEXITCODE -ne 0 -or -not $rawInspection) {
            Fail "The generated WAV failed structural inspection; do not use it as a Hindi audio acceptance sample."
        }
        try { $inspection = ($rawInspection | Select-Object -Last 1) | ConvertFrom-Json }
        catch { Fail "The WAV inspector returned unreadable JSON." }
        if (-not $inspection.ok -or -not $inspection.result -or
            -not $inspection.result.structure_valid -or
            $inspection.result.codec -ne "pcm_s16le" -or
            $inspection.result.channels -ne 1 -or
            $inspection.result.frames -le 0 -or
            $inspection.result.duration_seconds -le 0 -or
            $inspection.result.hindi_listening_verified -or
            $inspection.result.distinct_voices_verified) {
            Fail "The WAV inspector did not confirm valid PCM16 output with manual acceptance still pending."
        }
        if ([Math]::Abs([double]$result.result.duration_seconds -
                [double]$inspection.result.duration_seconds) -gt 0.02) {
            Fail "Reported synthesis duration does not match the inspected WAV."
        }
        if ($inspection.result.level_hints.near_silence_hint) {
            Fail "The Hindi smoke-test WAV is almost silent. Check model output and audio dependencies before accepting it."
        }
        if ($inspection.result.level_hints.dc_only_hint) {
            Fail "The Hindi smoke-test WAV has no meaningful varying audio (DC-only signal). Check model output before accepting it."
        }
        Write-Host ("Structurally validated WAV: " + $output)
        Write-Host ("Measured length: " + $inspection.result.duration_seconds +
            " seconds; sample rate: " + $inspection.result.sample_rate_hz +
            " Hz; SHA-256: " + $inspection.result.sha256)
        if ($inspection.result.level_hints.signal_review_required) {
            Write-Warning "The generated WAV has a level or long-pause warning. Review the recorded audio carefully."
        }
        Write-Warning "Listen critically to the WAV; structure, duration and levels do not prove Hindi pronunciation, intelligibility or distinct voices."
    } finally {
        Pop-Location
    }
}
if (-not $ExecutablePath) {
    if ($VerifyHindiSpeech) { exit 0 }
    Fail "Provide -ExecutablePath with the absolute path to the GitHub-built KathaSvara developer EXE, or use -DoctorOnly."
}
if (-not [System.IO.Path]::IsPathRooted($ExecutablePath) -or
    -not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf) -or
    [System.IO.Path]::GetExtension($ExecutablePath).ToLowerInvariant() -ne ".exe") {
    Fail "ExecutablePath must be an existing absolute Windows .exe file."
}
$executable = (Resolve-Path -LiteralPath $ExecutablePath).Path
Write-Warning "Only run an EXE you trust and whose GitHub release checksums you verified; developer builds are unsigned."
Write-Host "Launching KathaSvara with this configured local Python environment..."
Start-Process -FilePath $executable -WorkingDirectory (Split-Path -Parent $executable) -ErrorAction Stop
Write-Host "Launched. Use the app's Settings diagnostics first, then generate a SHORT Hindi test line."
