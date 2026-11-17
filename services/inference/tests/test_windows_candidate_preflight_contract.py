"""Model-free Windows portable candidate preflight source safety contracts.

These tests inspect PowerShell and GitHub Actions text only. Windows CI
separately executes the inspector against the compiled candidate.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DOCTOR = ROOT / "scripts/windows/inspect-desktop-candidate.ps1"
WORKFLOW = ROOT / ".github/workflows/windows-portable-candidate.yml"
GUIDE = ROOT / "docs/installation/windows-development-candidate.md"


def test_candidate_doctor_never_runs_or_installs_anything() -> None:
    script = DOCTOR.read_text(encoding="utf-8")
    assert "[Parameter(Mandatory = $true)]" in script
    assert "[string]$ExecutablePath" in script
    assert "[System.PlatformID]::Win32NT" in script
    assert "[Environment]::Is64BitOperatingSystem" in script
    assert '[string]$ChecksumPath = ""' in script
    assert "Get-Item -LiteralPath $ExecutablePath" in script
    assert "BinaryReader" in script
    assert "0x00004550" in script
    assert "0x8664" in script
    assert "Get-FileHash -LiteralPath $exe.FullName -Algorithm SHA256" in script
    assert "SHA256SUMS.txt must contain one exact checksum" in script
    assert "No EXE launched" in script
    for forbidden in (
        "Start-Process", "Invoke-WebRequest", "Invoke-RestMethod", "Install-Package",
        "Set-ItemProperty", "Remove-ItemProperty", "New-ItemProperty", "reg add",
        "pip install", "synthesize", "transcribe_hindi_wav", "GetUserMedia",
    ):
        assert forbidden not in script


def test_webview_registry_probe_uses_only_documented_registration_keys() -> None:
    script = DOCTOR.read_text(encoding="utf-8")
    guid = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    assert script.count(guid) == 2
    assert "Registry::HKEY_LOCAL_MACHINE" in script
    assert "Registry::HKEY_CURRENT_USER" in script
    assert 'Get-ItemProperty -LiteralPath $key -Name "pv"' in script
    assert "0.0.0.0" in script
    assert "NOT TESTED" in script


def test_windows_ci_runs_read_only_candidate_preflight_before_upload() -> None:
    script = WORKFLOW.read_text(encoding="utf-8")
    assert '"scripts/windows/inspect-desktop-candidate.ps1"' in script
    after_package = script.partition("- name: Package test EXE with dependency disclosure")[2]
    preflight = after_package.index("- name: Read-only Windows x64, SHA256 and WebView2 preflight")
    upload = after_package.index("- uses: actions/upload-artifact@v7")
    assert preflight < upload
    assert "KathaSvara-unreleased-dev-win64.exe" in after_package
    assert "& ./scripts/windows/inspect-desktop-candidate.ps1" in after_package
    # A PowerShell-only script can succeed with no LASTEXITCODE defined.
    assert "if ($LASTEXITCODE -ne 0)" not in after_package
    assert "SHA256SUMS.txt" in after_package
    assert "workflow_dispatch:" in script


def test_readme_explains_scope_and_official_webview_runtime_check() -> None:
    guide = GUIDE.read_text(encoding="utf-8")
    assert "inspect-desktop-candidate.ps1" in guide
    assert "learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution" in guide
    assert "without running it" in guide
    assert "WebView2 detection is a setup hint" in guide
    assert "No" in guide or "never" in guide
