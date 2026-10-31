# SPDX-License-Identifier: MPL-2.0
# Explicit development setup for the unbundled KathaSvara Windows EXE.
# No downloads, model loading or registry changes unless -InstallDependencies
# (packages only) or the user later explicitly presses Generate in the app.
[CmdletBinding()]
param(
    [string]$ExecutablePath = "",
    [string]$PythonPath = "",
    [switch]$InstallDependencies,
    [switch]$DoctorOnly,
    [switch]$VerifyHindiSpeech,
    [switch]$CpuOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ($DoctorOnly -and $VerifyHindiSpeech) {
    Write-Error "Choose either -DoctorOnly (no model) or -VerifyHindiSpeech (real model)."
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
} elseif ($InstallDependencies) {
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

# These environment variables apply only to this shell and the child EXE.
# The Windows user's persistent environment and registry are untouched.
$env:KATHASVARA_PYTHON = $python
$env:KATHASVARA_INFERENCE_DIR = $inference

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
if (-not $diagnostic.result.dependencies_present) {
    $missing = @($diagnostic.result.dependencies.PSObject.Properties |
        Where-Object { -not $_.Value } | ForEach-Object { $_.Name })
    Fail ("Speech packages are missing: " + ($missing -join ", ") +
        ". Rerun with -InstallDependencies to install the optional TTS packages.")
}
if (-not $diagnostic.result.temporary_write_test_passed) {
    Fail "Python cannot write temporary files; speech synthesis cannot be used safely."
}
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
if (-not $importProbe.result.imports_ok) {
    $failed = @($importProbe.result.checks.PSObject.Properties |
        Where-Object { $_.Value -ne "ok" } |
        ForEach-Object { $_.Name + " (" + $_.Value + ")" })
    if (-not $importProbe.result.python_311) { $failed += "python_311 (required)" }
    Fail ("Required speech libraries cannot import: " + ($failed -join ", ") +
        ". Repair your Python 3.11 TTS environment before launching the app.")
}
Write-Host "Speech imports passed. Model weights, hardware capability and Hindi audio are NOT verified."
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
    $payload = @{
        action = "synthesize"
        text = "नमस्कार। यह कथास्वर की वास्तविक हिंदी आवाज़ जाँच है।"
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
