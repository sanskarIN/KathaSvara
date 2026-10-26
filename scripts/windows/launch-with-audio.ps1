# SPDX-License-Identifier: MPL-2.0
# Explicit development setup for the unbundled KathaSvara Windows EXE.
# No downloads, model loading or registry changes unless -InstallDependencies
# (packages only) or the user later explicitly presses Generate in the app.
[CmdletBinding()]
param(
    [string]$ExecutablePath = "",
    [string]$PythonPath = "",
    [switch]$InstallDependencies,
    [switch]$DoctorOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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
    if (-not [System.IO.Path]::IsPathFullyQualified($PythonPath) -or
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
Write-Host "Bridge and dependency discovery passed. REAL model inference and Hindi audio are NOT yet verified."
Write-Host "The first explicit Generate action may need an internet connection, model-weight access, storage, and compatible hardware."

if ($DoctorOnly) {
    Write-Host "DoctorOnly complete. No speech model was loaded and no WAV was generated."
    exit 0
}

if (-not $ExecutablePath) {
    Fail "Provide -ExecutablePath with the absolute path to the GitHub-built KathaSvara developer EXE, or use -DoctorOnly."
}
if (-not [System.IO.Path]::IsPathFullyQualified($ExecutablePath) -or
    -not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf) -or
    [System.IO.Path]::GetExtension($ExecutablePath).ToLowerInvariant() -ne ".exe") {
    Fail "ExecutablePath must be an existing absolute Windows .exe file."
}
$executable = (Resolve-Path -LiteralPath $ExecutablePath).Path
Write-Warning "Only run an EXE you trust and whose GitHub release checksums you verified; developer builds are unsigned."
Write-Host "Launching KathaSvara with this configured local Python environment..."
Start-Process -FilePath $executable -WorkingDirectory (Split-Path -Parent $executable) -ErrorAction Stop
Write-Host "Launched. Use the app's Settings diagnostics first, then generate a SHORT Hindi test line."
