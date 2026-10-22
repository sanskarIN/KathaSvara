"""No-model regression checks for the read-only WAV acceptance inspector.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import hashlib
import json
import os
import struct
import wave
from pathlib import Path

import pytest

from kathasvara.wav_acceptance import inspect_wav_candidate, main


def wav_file(path: Path, *, channels: int = 1, width: int = 2,
             rate: int = 24000, samples: int = 2400) -> Path:
    with wave.open(str(path), "wb") as out:
        out.setnchannels(channels)
        out.setsampwidth(width)
        out.setframerate(rate)
        out.writeframes(bytes(samples * channels * width))
    return path


def test_structural_wav_metadata_and_sha_have_no_private_paths(tmp_path: Path) -> None:
    path = wav_file(tmp_path / "गोपनीय-राजा-भोज.wav")
    result = inspect_wav_candidate(path)
    assert result["structure_valid"] is True
    assert result["codec"] == "pcm_s16le"
    assert result["sample_rate_hz"] == 24000
    assert result["frames"] == 2400 and result["duration_seconds"] == 0.1
    assert result["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert result["human_review_required"] is True
    assert result["model_loaded"] is False
    assert result["hindi_listening_verified"] is False
    assert result["distinct_voices_verified"] is False
    assert result["level_hints"] == {
        "peak_dbfs": None,
        "rms_dbfs": None,
        "near_silence_hint": True,
        "possible_clipping_hint": False,
        "clipped_sample_percentage": 0.0,
        "signal_review_required": True,
    }
    assert "गोपनीय" not in str(result)
    assert str(tmp_path) not in str(result)


def test_cli_returns_private_path_free_json_only_for_valid_pcm(
    tmp_path: Path, capsys: pytest.CaptureFixture[str],
) -> None:
    path = wav_file(tmp_path / "test.wav")
    assert main(["--wav", str(path)]) == 0
    out = capsys.readouterr()
    report = json.loads(out.out)
    assert report["structure_valid"] is True
    assert out.err == ""
    assert "test.wav" not in out.out


@pytest.mark.parametrize(("channels", "width", "rate"), [
    (2, 2, 24000), (1, 1, 24000), (1, 2, 7999), (1, 2, 192001),
])
def test_rejects_unsupported_wav_encoding(
    tmp_path: Path, channels: int, width: int, rate: int,
) -> None:
    with pytest.raises(ValueError, match="mono PCM16"):
        inspect_wav_candidate(wav_file(
            tmp_path / "unsupported.wav", channels=channels, width=width, rate=rate,
        ))


def test_rejects_empty_missing_relative_non_wav_and_corrupt_files(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="absolute"):
        inspect_wav_candidate(Path("relative.wav"))
    with pytest.raises(ValueError, match="absolute"):
        inspect_wav_candidate(tmp_path / "not-wav.txt")
    with pytest.raises(ValueError, match="Cannot open"):
        inspect_wav_candidate(tmp_path / "missing.wav")
    empty = tmp_path / "empty.wav"
    empty.touch()
    with pytest.raises(ValueError, match="regular audio"):
        inspect_wav_candidate(empty)
    bogus = tmp_path / "bogus.wav"
    bogus.write_bytes(b"not a wave" * 12)
    with pytest.raises(ValueError, match="invalid PCM"):
        inspect_wav_candidate(bogus)


def test_rejects_truncated_pcm_data_without_structural_pass(tmp_path: Path) -> None:
    path = wav_file(tmp_path / "truncated.wav")
    original = path.read_bytes()
    path.write_bytes(original[:-160])
    with pytest.raises(ValueError, match="truncated"):
        inspect_wav_candidate(path)


def test_symlink_not_accepted_even_if_target_is_valid(tmp_path: Path) -> None:
    target = wav_file(tmp_path / "target.wav")
    alias = tmp_path / "alias.wav"
    try:
        os.symlink(target, alias)
    except (OSError, NotImplementedError):
        pytest.skip("Symlinks unavailable in this test environment")
    with pytest.raises(ValueError, match="non-symlink"):
        inspect_wav_candidate(alias)


def test_failed_cli_never_echoes_private_input_paths(
    tmp_path: Path, capsys: pytest.CaptureFixture[str],
) -> None:
    missing = tmp_path / "private-credential-path.wav"
    assert main(["--wav", str(missing)]) == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "private-credential-path" not in captured.err


def pcm16_file(path: Path, values: list[int], rate: int = 8000) -> Path:
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(struct.pack("<" + "h" * len(values), *values))
    return path


def test_moderate_signal_does_not_trigger_quiet_or_clipping_hints(tmp_path: Path) -> None:
    path = pcm16_file(tmp_path / "normal.wav", [8000, -8000] * 500)
    result = inspect_wav_candidate(path)
    hint = result["level_hints"]
    assert hint["peak_dbfs"] == -12.25
    assert hint["rms_dbfs"] == -12.25
    assert hint["near_silence_hint"] is False
    assert hint["possible_clipping_hint"] is False
    assert hint["signal_review_required"] is False
    assert hint["clipped_sample_percentage"] == 0.0
    assert result["hindi_listening_verified"] is False


def test_exact_clip_threshold_is_a_hint_not_a_speech_failure(tmp_path: Path) -> None:
    # Exactly one percent full-scale samples: warning only, not an invalid WAV.
    path = pcm16_file(tmp_path / "hard-clip.wav", [32767] * 10 + [5000] * 990)
    result = inspect_wav_candidate(path)
    assert result["structure_valid"] is True
    assert result["level_hints"]["peak_dbfs"] == -0.0
    assert result["level_hints"]["clipped_sample_percentage"] == 1.0
    assert result["level_hints"]["possible_clipping_hint"] is True
    assert result["level_hints"]["near_silence_hint"] is False
    assert result["human_review_required"] is True


def test_negative_pcm_full_scale_and_single_saturation_are_counted(tmp_path: Path) -> None:
    path = pcm16_file(tmp_path / "negative.wav", [-32768] * 100)
    result = inspect_wav_candidate(path)
    assert result["level_hints"]["peak_dbfs"] == 0.0
    assert result["level_hints"]["rms_dbfs"] == 0.0
    assert result["level_hints"]["clipped_sample_percentage"] == 100.0
    assert result["level_hints"]["possible_clipping_hint"] is True


def test_quiet_nonzero_pcm_is_suspicious_but_not_silence(tmp_path: Path) -> None:
    path = pcm16_file(tmp_path / "low-level.wav", [1, -1] * 500)
    hint = inspect_wav_candidate(path)["level_hints"]
    assert hint["peak_dbfs"] == -90.31
    assert hint["rms_dbfs"] == -90.31
    assert hint["near_silence_hint"] is True
    assert hint["possible_clipping_hint"] is False
    assert hint["signal_review_required"] is True


def test_statistics_handle_boundaries_between_streaming_chunks(tmp_path: Path) -> None:
    # >8192 samples: numbers must be accumulated, not overwritten per chunk.
    path = pcm16_file(tmp_path / "stream.wav", [2000] * 8192 + [-4000] * 8192)
    hint = inspect_wav_candidate(path)["level_hints"]
    assert hint["peak_dbfs"] == -18.27
    assert hint["near_silence_hint"] is False
    assert hint["clipped_sample_percentage"] == 0.0
    assert hint["signal_review_required"] is False


def test_private_wav_name_absent_even_when_level_hints_are_present(tmp_path: Path) -> None:
    path = pcm16_file(tmp_path / "secret-voice-sample.wav", [1234] * 20)
    result = inspect_wav_candidate(path)
    assert "secret-voice-sample" not in json.dumps(result)
    assert "file_path" not in result
    assert result["model_loaded"] is False
    assert result["distinct_voices_verified"] is False



def test_rejects_same_size_wav_changed_during_digest(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Metadata change during the scan must invalidate even a complete PCM file."""
    from kathasvara import wav_acceptance

    path = wav_file(tmp_path / "private-concurrent.wav")
    initial = path.stat()
    actual_sha256 = hashlib.sha256

    class MutatingDigest:
        def __init__(self) -> None:
            self._digest = actual_sha256()
            self._mutated = False

        def update(self, chunk: bytes) -> None:
            self._digest.update(chunk)
            if not self._mutated:
                self._mutated = True
                # Simulate an editor touching/replacing data of the same size
                # while checksum generation is underway. Access times may
                # change simply from reads, but modification time may not.
                os.utime(path, ns=(
                    initial.st_atime_ns,
                    initial.st_mtime_ns + 2_000_000_000,
                ))

        def hexdigest(self) -> str:
            return self._digest.hexdigest()

    monkeypatch.setattr(wav_acceptance.hashlib, "sha256", MutatingDigest)
    with pytest.raises(ValueError, match="changed during inspection"):
        inspect_wav_candidate(path)
    assert path.stat().st_size == initial.st_size
