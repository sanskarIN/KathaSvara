"""No-model regression checks for the read-only WAV acceptance inspector.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import hashlib
import json
import os
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
    with pytest.raises(ValueError, match="regular audio"):
        inspect_wav_candidate(tmp_path / "empty.wav") if (
            tmp_path / "empty.wav").touch() is None else None
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
