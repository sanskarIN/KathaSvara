"""Guard the opt-in Windows STT setup helper without running a model.

These source-contract tests never execute PowerShell, install dependencies,
load recognition weights, or request microphone access.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HELPER = ROOT / "scripts/windows/launch-with-audio.ps1"


def test_windows_stt_extra_is_separate_from_tts_and_requires_opt_in() -> None:
    script = HELPER.read_text(encoding="utf-8")
    assert "[switch]$InstallSttDependencies" in script
    assert '[switch]$SttDoctorOnly' in script
    assert '[switch]$VerifyHindiSttWav' in script
    assert '[string]$SttWavPath = ""' in script
    assert '[string]$SttModelPath = ""' in script
    tts_install = script.index('if ($InstallDependencies) {')
    stt_install = script.index('if ($InstallSttDependencies) {')
    assert tts_install < stt_install
    assert '& $python -m pip install -e ".[tts]"' in script[tts_install:stt_install]
    assert '& $python -m pip install -e ".[stt]"' in script[stt_install:]
    assert '.venv\\Scripts\\python.exe' in script
    assert "3.11" in script
    # Only explicit installation switches can create a missing virtualenv.
    assert 'elseif ($InstallDependencies -or $InstallSttDependencies)' in script


def test_windows_stt_doctor_is_standalone_and_model_free() -> None:
    script = HELPER.read_text(encoding="utf-8")
    doctor = script.partition('if ($SttDoctorOnly) {')[2].partition(
        'Write-Host "Checking the configured Python bridge without loading a speech model..."'
    )[0]
    assert doctor
    assert 'Arguments = "-m kathasvara.stt_doctor"' in doctor
    assert 'EnvironmentVariables["KATHASVARA_STT_DOCTOR_MODEL_PATH"]' in doctor
    assert 'EnvironmentVariables.Remove("KATHASVARA_STT_DOCTOR_MODEL_PATH")' in doctor
    assert "RedirectStandardInput" not in doctor
    assert "ConvertTo-Json" not in doctor
    assert '[System.Text.UTF8Encoding]::new($false)' in doctor
    assert 'network_used -ne $false' in doctor
    assert 'model_loaded -ne $false' in doctor
    assert 'audio_transcribed -ne $false' in doctor
    assert 'PSObject.Properties[$key].Value -isnot [bool]' in doctor
    assert '$hints.ContainsKey($firstStep)' in doctor
    assert 'exit 0' in doctor
    # The doctor must exit before any TTS imports or model-generation step.
    assert 'probe_runtime' not in doctor
    assert 'synthesize' not in doctor
    assert 'VerifyHindiSpeech' not in doctor
    assert '& $python -m pip install' not in doctor
    assert 'Start-Process' not in doctor


def test_real_offline_stt_smoke_is_separate_opt_in_and_never_prints_transcript() -> None:
    script = HELPER.read_text(encoding="utf-8")
    smoke = script.partition('if ($VerifyHindiSttWav) {')[2].partition(
        'Write-Host "Checking the configured Python bridge without loading a speech model..."'
    )[0]
    assert smoke
    assert 'Arguments = "-m kathasvara.stt_smoke"' in smoke
    assert 'EnvironmentVariables["KATHASVARA_STT_SMOKE_WAV_PATH"]' in smoke
    assert 'EnvironmentVariables["KATHASVARA_STT_SMOKE_MODEL_PATH"]' in smoke
    assert 'WaitForExit(600000)' in smoke
    assert 'RedirectStandardError = $true' in smoke
    assert 'real_inference_attempted -ne $true' in smoke
    assert 'hindi_accuracy_verified -ne $false' in smoke
    assert "No transcript was printed or saved." in smoke
    assert 'exit 0' in smoke
    assert "Start-Process" not in smoke
    assert "synthesize" not in smoke
    assert "ConvertTo-Json" not in smoke
    assert 'pip install' not in smoke
    assert script.isascii()

    guide = (ROOT / "docs/installation/audio-troubleshooting.md").read_text(
        encoding="utf-8"
    )
    assert "-VerifyHindiSttWav" in guide
    assert "It never prints" in guide
    assert "ten-minute" in guide
    ci = (ROOT / ".github/workflows/windows-portable-candidate.yml").read_text(
        encoding="utf-8"
    )
    assert '"scripts/windows/launch-with-audio.ps1"' in ci
    assert "shell: powershell" in ci
    assert "Language.Parser]::ParseFile" in ci



def test_stt_wizard_has_no_implicit_model_download_or_tts_activation() -> None:
    script = HELPER.read_text(encoding="utf-8")
    assert 'Use -SttModelPath only with -SttDoctorOnly' in script
    assert 'Choose only one of -SttDoctorOnly, -DoctorOnly, or -VerifyHindiSpeech.' in script
    assert 'The offline STT setup probe returned an inconsistent report.' in script
    assert 'The local offline STT setup probe could not run.' in script
    assert '-m kathasvara.stt_doctor' in script
    assert 'RedirectStandardInput' not in script
    assert 'RedirectStandardError = $true' in script
    assert 'WaitForExit(90000)' in script
    assert 'GetAwaiter().GetResult()' in script
    assert 'select_python_311' in script
    assert 'install_stt_extra' in script
    assert 'select_local_model' in script
    assert 'run_transcription' in script

    guide = (ROOT / "docs/installation/audio-troubleshooting.md").read_text(
        encoding="utf-8"
    )
    for flag in ("-SttDoctorOnly", "-InstallSttDependencies", "-SttModelPath"):
        assert flag in guide
    assert "v0.5.6 EXE does not contain" in guide
    assert "no" in guide.lower() and "real model" in guide.lower()
