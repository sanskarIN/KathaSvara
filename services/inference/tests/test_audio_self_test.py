"""Offline WAV plumbing checks; no model weights, PyTorch or playback."""
from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path

import pytest

from kathasvara import audio_self_test


def test_pcm16_roundtrip_is_bounded_private_and_cleans_up(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    visited: list[Path] = []
    real_inspector = audio_self_test.inspect_wav_candidate

    def inspect(sample: Path) -> dict[str, object]:
        visited.append(sample)
        report = real_inspector(sample)
        assert sample.stat().st_size < 10_000
        assert report["duration_seconds"] == 0.25
        return report

    monkeypatch.setattr(audio_self_test, "inspect_wav_candidate", inspect)
    result = audio_self_test.probe_audio_io()
    assert result["status"] == "passed"
    assert result["failed_stage"] is None
    assert result["temporary_wav_roundtrip_ok"] is True
    assert len(visited) == 1
    assert visited[0].is_absolute()
    assert not visited[0].exists()
    assert str(visited[0]) not in str(result)
    for key in ("model_loaded", "audio_playback_verified", "hindi_listening_verified"):
        assert result[key] is False


def test_missing_temporary_directory_is_a_safe_fixed_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unavailable(**_kwargs: object) -> None:
        raise OSError(r"C:\Users\private-person\Audio is inaccessible")

    monkeypatch.setattr(audio_self_test.tempfile, "TemporaryDirectory", unavailable)
    result = audio_self_test.probe_audio_io()
    assert result["status"] == "failed"
    assert result["failed_stage"] == "temporary_directory"
    assert result["temporary_wav_roundtrip_ok"] is False
    assert "private-person" not in str(result)


def test_wav_write_error_never_leaks_local_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def write_broken(*_args: object, **_kwargs: object) -> None:
        raise PermissionError(r"C:\Users\someone\secret-audio.wav")

    monkeypatch.setattr(audio_self_test.wave, "open", write_broken)
    result = audio_self_test.probe_audio_io()
    assert result["status"] == "failed"
    assert result["failed_stage"] == "write_pcm16"
    assert "someone" not in str(result)
    assert "secret-audio.wav" not in str(result)


def test_inspection_failure_never_claims_audio_works(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def inspect_broken(_path: Path) -> dict[str, object]:
        raise ValueError("/home/private/hindi-story.wav is corrupt")

    monkeypatch.setattr(audio_self_test, "inspect_wav_candidate", inspect_broken)
    result = audio_self_test.probe_audio_io()
    assert result["status"] == "failed"
    assert result["failed_stage"] == "inspect_pcm16"
    assert result["temporary_wav_roundtrip_ok"] is False
    assert "private" not in str(result)
    assert result["model_loaded"] is False


def test_wrong_or_silent_inspection_result_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(audio_self_test, "inspect_wav_candidate", lambda _path: {
        "structure_valid": True, "codec": "pcm_s16le", "channels": 1,
        "sample_rate_hz": 16_000, "frames": 4_000,
        "duration_seconds": 0.25,
        "level_hints": {"near_silence_hint": True, "dc_only_hint": False},
    })
    result = audio_self_test.probe_audio_io()
    assert result["status"] == "failed"
    assert result["failed_stage"] == "inspect_pcm16"


def test_cleanup_error_cannot_be_misreported_as_pass(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_temporary_directory = audio_self_test.tempfile.TemporaryDirectory

    @contextmanager
    def broken_cleanup(*_args: object, **kwargs: object):
        with real_temporary_directory(**kwargs) as folder:
            yield folder
        raise OSError(r"C:\Users\private-person\cleanup failure")

    monkeypatch.setattr(
        audio_self_test.tempfile, "TemporaryDirectory", broken_cleanup,
    )
    result = audio_self_test.probe_audio_io()
    assert result["status"] == "failed"
    assert result["failed_stage"] == "cleanup"
    assert "private-person" not in str(result)


def test_cli_can_run_offline_audio_io_probe_without_model() -> None:
    from kathasvara.cli import handle

    response = handle({"action": "probe_audio_io"})
    assert response["ok"] is True
    report = response["result"]
    assert report["status"] == "passed"
    assert report["temporary_wav_roundtrip_ok"] is True
    assert report["model_loaded"] is False
    assert report["audio_playback_verified"] is False
