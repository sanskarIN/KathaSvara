"""Model-free checks for the Windows real-Hindi smoke-test WAV acceptance gate.

The synthetic PCM fixture is NOT speech, and no model weights are loaded.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import wave
from pathlib import Path

import pytest

from kathasvara.cli import handle


def test_smoke_wav_inspector_reports_structure_not_hindi_listening(tmp_path: Path) -> None:
    output = tmp_path / "smoke.wav"
    with wave.open(str(output), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(8_000)
        wav.writeframes(b"\\x00\\x08" * 8_000)

    response = handle({"action": "inspect_generated_wav", "path": str(output)})
    assert response["ok"] is True
    report = response["result"]
    assert report["structure_valid"] is True
    assert report["codec"] == "pcm_s16le"
    assert report["channels"] == 1
    assert report["frames"] == 8_000
    assert report["duration_seconds"] == 1.0
    assert len(report["sha256"]) == 64
    assert report["model_loaded"] is False
    assert report["hindi_listening_verified"] is False
    assert report["distinct_voices_verified"] is False


def test_smoke_wav_inspector_rejects_non_wav_even_if_file_is_large(tmp_path: Path) -> None:
    fake = tmp_path / "fake.wav"
    fake.write_bytes(b"not really a PCM16 recording" * 20)
    with pytest.raises(ValueError, match="WAV"):
        handle({"action": "inspect_generated_wav", "path": str(fake)})


def test_windows_real_smoke_mode_requires_full_wav_inspection() -> None:
    # Protect the release-path contract: a mere file-size check is insufficient.
    script = (
        Path(__file__).resolve().parents[3] / "scripts" / "windows"
        / "launch-with-audio.ps1"
    ).read_text(encoding="utf-8")
    smoke_section = script.split('if ($VerifyHindiSpeech) {', 1)[1]
    assert '"inspect_generated_wav"' in smoke_section
    assert "structure_valid" in smoke_section
    assert "hindi_listening_verified" in smoke_section
    assert "distinct_voices_verified" in smoke_section
    assert "signal_review_required" in smoke_section
    assert "near_silence_hint" in smoke_section
