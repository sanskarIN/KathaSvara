# SPDX-License-Identifier: MPL-2.0
# Read-only Windows candidate checks. Never launch an EXE, install software,
# change the registry, download a model, or access a microphone.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath,
    [string]$ChecksumPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Reject([string]$Advice) {
    throw ("KathaSvara Windows candidate check failed: " + $Advice)
}

if (-not [Environment]::Is64BitOperatingSystem) {
    Reject "This developer EXE requires a 64-bit Windows system."
}
if (-not [System.IO.Path]::IsPathRooted($ExecutablePath)) {
    Reject "Provide the absolute path to the trusted Windows developer EXE."
}
try {
    $exe = Get-Item -LiteralPath $ExecutablePath -ErrorAction Stop
} catch {
    Reject "The selected developer EXE does not exist or cannot be read."
}
if ($exe.PSIsContainer -or $exe.Extension.ToLowerInvariant() -ne ".exe" -or
    $exe.Length -lt 100000) {
    Reject "Choose a nonempty regular Windows .exe developer candidate."
}

# Read only the DOS/PE header and machine type. This does not execute the
# selected program or attest to publisher identity/code safety.
$stream = $null
$reader = $null
try {
    $stream = [System.IO.File]::Open($exe.FullName,
        [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read)
    $reader = [System.IO.BinaryReader]::new($stream)
    if ($reader.ReadUInt16() -ne 0x5A4D) {
        Reject "The selected file has no valid DOS executable header."
    }
    $reader.BaseStream.Position = 0x3c
    $peOffset = $reader.ReadInt32()
    if ($peOffset -lt 64 -or $peOffset -gt ($exe.Length - 6)) {
        Reject "The Windows executable header is malformed."
    }
    $reader.BaseStream.Position = $peOffset
    if ($reader.ReadUInt32() -ne 0x00004550 -or
        $reader.ReadUInt16() -ne 0x8664) {
        Reject "The candidate is not a Windows x64 PE executable."
    }
} catch {
    # Reject() messages are already fixed; never print an arbitrary .NET
    # exception because it may include the user's private file path.
    if ($_.Exception.Message -like "KathaSvara Windows candidate check failed:*") {
        throw
    }
    Reject "Unable to inspect the Windows executable header."
} finally {
    if ($null -ne $reader) {
        $reader.Dispose()
    } elseif ($null -ne $stream) {
        $stream.Dispose()
    }
}

$manifestPath = if ($ChecksumPath) {
    $ChecksumPath
} else {
    Join-Path $exe.DirectoryName "SHA256SUMS.txt"
}
if (-not [System.IO.Path]::IsPathRooted($manifestPath)) {
    Reject "Provide an absolute SHA256SUMS.txt path, or place it beside the EXE."
}
try {
    $manifest = Get-Item -LiteralPath $manifestPath -ErrorAction Stop
} catch {
    Reject "SHA256SUMS.txt is missing. Use the manifest from the same workflow artifact."
}
if ($manifest.PSIsContainer -or $manifest.Length -lt 64 -or
    $manifest.Length -gt 4096 -or $manifest.Name -ne "SHA256SUMS.txt") {
    Reject "The candidate SHA256SUMS.txt is invalid or oversized."
}
try {
    $content = [System.IO.File]::ReadAllText($manifest.FullName,
        [System.Text.Encoding]::UTF8)
} catch {
    Reject "The candidate SHA256SUMS.txt cannot be read."
}
$records = @($content -split '\r?\n' | Where-Object { $_ -ne "" })
$format = "^([0-9a-fA-F]{64})  " + [regex]::Escape($exe.Name) + "$"
if ($records.Count -ne 1) {
    Reject "SHA256SUMS.txt must contain one exact checksum for this EXE."
}
$match = [regex]::Match($records[0], $format)
if (-not $match.Success) {
    Reject "SHA256SUMS.txt does not identify the selected EXE by its exact filename."
}
try {
    $actual = (Get-FileHash -LiteralPath $exe.FullName -Algorithm SHA256).Hash
} catch {
    Reject "Unable to calculate the selected EXE SHA-256."
}
if ($actual -ne $match.Groups[1].Value.ToUpperInvariant()) {
    Reject "The EXE SHA-256 does not match its artifact manifest. Do not run it."
}
Write-Host "Windows x64 PE header: passed (not a signature or malware check)."
Write-Host "Same-artifact SHA-256 integrity: passed (not proof of safe code)."

# Microsoft's published read-only detection paths. The registry is not
# changed; absent/invalid registration indicates a setup issue, never proof
# about speakers, WebView2 rendering, permission prompts, or real Hindi audio.
$webviewKeys = @(
    'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'Registry::HKEY_CURRENT_USER\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
)
$webviewVersion = $null
foreach ($key in $webviewKeys) {
    try {
        $value = [string](Get-ItemProperty -LiteralPath $key -Name "pv" -ErrorAction Stop).pv
        if ($value -match '^\d+\.\d+\.\d+\.\d+$' -and $value -ne "0.0.0.0") {
            $webviewVersion = $value
            break
        }
    } catch {
        # Missing/inaccessible registration is a diagnostic, not a crash.
    }
}
if ($webviewVersion) {
    Write-Host ("WebView2 Runtime registration: detected version " + $webviewVersion + ".")
} else {
    Write-Warning ("WebView2 Runtime registration was not confirmed. " +
        "Check the official Microsoft WebView2 Runtime distribution instructions.")
}
Write-Host "No EXE launched. No registry change, microphone access, speech model, or download."
Write-Host "Windows UI launch, Hindi listening and actual STT quality: NOT TESTED."
