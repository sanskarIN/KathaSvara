"""Regress incomplete WAV cleanup when native library opening or closing fails.

Synthetic file handles only: no model loading, audio hardware or network.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from kathasvara.audio_stream import StreamingWav


def test_failed_audio_library_open_removes_its_partial(
    tmp_path: Path,
) -> None:
    output = tmp_path / "narrator.wav"

    def failed_native_open(path: str, **kwargs: object) -> None:
        assert kwargs["mode"] == "x"
        Path(path).write_bytes(b"unfinished WAV header")
        raise OSError("Native codec initialization failed")

    writer = StreamingWav(
        output, 24_000, SimpleNamespace(SoundFile=failed_native_open), 24_000,
    )
    with pytest.raises(OSError, match="Native codec"):
        with writer:
            pytest.fail("Failed __enter__ must not yield a writer")
    assert not output.exists()
    assert not writer._partial.exists()
    assert not list(tmp_path.glob("*.partial.wav"))


def test_failed_audio_library_close_still_removes_its_partial(
    tmp_path: Path,
) -> None:
    output = tmp_path / "narrator.wav"

    class BrokenClose:
        def __init__(self, path: str, **_kwargs: object) -> None:
            Path(path).write_bytes(b"unfinished WAV header")

        def close(self) -> None:
            raise OSError("Native codec failed while closing")

    writer = StreamingWav(
        output, 24_000, SimpleNamespace(SoundFile=BrokenClose), 24_000,
    )
    with pytest.raises(OSError, match="while closing"):
        with writer:
            pass
    assert not output.exists()
    assert not writer._partial.exists()
    assert not list(tmp_path.glob("*.partial.wav"))


def test_failed_open_does_not_replace_existing_destination(
    tmp_path: Path,
) -> None:
    output = tmp_path / "existing.wav"
    output.write_bytes(b"important existing data")

    def should_not_run(*_args: object, **_kwargs: object) -> None:
        pytest.fail("SoundFile must not be opened when destination exists")

    writer = StreamingWav(
        output, 24_000, SimpleNamespace(SoundFile=should_not_run), 24_000,
    )
    with pytest.raises(ValueError, match="new absolute WAV"):
        with writer:
            pass
    assert output.read_bytes() == b"important existing data"
    assert not writer._partial.exists()
