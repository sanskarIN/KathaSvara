"""Real STT smoke command contracts without downloading or loading model weights.

Tests use a fake existing ASR response, then a standalone missing-input process
that must not leak private path details to stdout or create a recording.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

import pytest

from kathasvara import stt_smoke


def test_smoke_uses_explicit_child_paths_but_redacts_recording_and_transcript(
    tmp_path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    wav = tmp_path / "private नमस्ते.wav"
    model = tmp_path / "private-model"
    monkeypatch.setenv(stt_smoke.WAV_ENV, str(wav))
    monkeypatch.setenv(stt_smoke.MODEL_ENV, str(model))
    calls: list[tuple[str, str]] = []

    def fake_transcribe(audio: str, weights: str) -> dict[str, object]:
        calls.append((audio, weights))
        return {
            "text": "नमस्ते भारत", "language": "hi",
            "duration_seconds": 1.25, "engine": "faster-whisper-local",
            "speech_detected": True, "human_review_required": True,
            "network_used": False,
        }

    monkeypatch.setattr(stt_smoke, "transcribe_hindi_wav", fake_transcribe)
    result = stt_smoke.probe_from_environment()
    assert calls == [(str(wav), str(model))]
    assert result == {
        "language": "hi", "engine": "faster-whisper-local",
        "duration_seconds": 1.25, "speech_detected": True,
        "transcript_characters": len("नमस्ते भारत"),
        "real_inference_attempted": True, "human_review_required": True,
        "hindi_accuracy_verified": False, "network_used": False,
    }
    assert str(wav) not in str(result)
    assert str(model) not in str(result)
    assert "नमस्ते" not in str(result)
    assert stt_smoke.main() == 0


@pytest.mark.parametrize("override", [
    {"network_used": True}, {"human_review_required": False},
    {"language": "en"}, {"engine": "remote-whisper"},
    {"speech_detected": False}, {"duration_seconds": float("nan")},
])
def test_smoke_fails_closed_on_inconsistent_engine_result(
    tmp_path, monkeypatch: pytest.MonkeyPatch, override: dict[str, object],
) -> None:
    monkeypatch.setenv(stt_smoke.WAV_ENV, str(tmp_path / "audio.wav"))
    monkeypatch.setenv(stt_smoke.MODEL_ENV, str(tmp_path / "model"))
    result = {
        "text": "नमस्ते", "duration_seconds": 1.0, "language": "hi",
        "engine": "faster-whisper-local", "speech_detected": True,
        "human_review_required": True, "network_used": False,
    }
    result.update(override)
    monkeypatch.setattr(stt_smoke, "transcribe_hindi_wav", lambda *_: result)
    with pytest.raises(ValueError, match="invalid result"):
        stt_smoke.probe_from_environment()


def test_smoke_rejects_missing_paths_without_loading_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(stt_smoke.WAV_ENV, raising=False)
    monkeypatch.delenv(stt_smoke.MODEL_ENV, raising=False)
    monkeypatch.setattr(stt_smoke, "transcribe_hindi_wav", lambda *_: (_ for _ in ()).throw(
        AssertionError("No model should load with missing input")
    ))
    with pytest.raises(ValueError, match="absolute local WAV"):
        stt_smoke.probe_from_environment()


def test_smoke_masks_native_exception_and_source_paths(
    tmp_path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    wav = str(tmp_path / "sensitive.wav")
    model = str(tmp_path / "sensitive-weights")
    monkeypatch.setenv(stt_smoke.WAV_ENV, wav)
    monkeypatch.setenv(stt_smoke.MODEL_ENV, model)

    def broken(*_: object) -> dict[str, object]:
        raise OSError("C:\\Private\\Native\\dll failure; " + wav + model)

    monkeypatch.setattr(stt_smoke, "transcribe_hindi_wav", broken)
    assert stt_smoke.main() == 1
    output = capsys.readouterr().out
    assert json.loads(output)["error"] == "LocalSttSmokeFailed"
    assert wav not in output and model not in output
    assert "Native" not in output


def test_standalone_smoke_without_input_does_not_download_or_trace_private_paths() -> None:
    env = os.environ.copy()
    env.pop(stt_smoke.WAV_ENV, None)
    env.pop(stt_smoke.MODEL_ENV, None)
    completed = subprocess.run(
        [sys.executable, "-m", "kathasvara.stt_smoke"],
        input="", text=True, capture_output=True, env=env, timeout=15, check=False,
    )
    assert completed.returncode == 1
    response = json.loads(completed.stdout)
    assert response["ok"] is False
    assert response["error"] == "LocalSttSmokeFailed"
    assert completed.stderr == ""
