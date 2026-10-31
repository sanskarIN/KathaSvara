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
    with pytest.raises(OSError, match="Native codec"), writer:
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
    with pytest.raises(OSError, match="while closing"), writer:
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
    with pytest.raises(ValueError, match="new absolute WAV"), writer:
        pass
    assert output.read_bytes() == b"important existing data"
    assert not writer._partial.exists()


def test_preexisting_partial_is_not_deleted_or_opened(
    tmp_path: Path,
) -> None:
    """An existing UUID-named temporary file belongs to someone else."""
    output = tmp_path / "narrator.wav"

    def should_not_open(*_args: object, **_kwargs: object) -> None:
        pytest.fail("Existing partial must be rejected before libsndfile")

    writer = StreamingWav(
        output, 24_000, SimpleNamespace(SoundFile=should_not_open), 24_000,
    )
    writer._partial.write_bytes(b"someone else's unfinished audio")
    with pytest.raises(FileExistsError, match="Temporary audio"), writer:
        pass
    assert writer._partial.read_bytes() == b"someone else's unfinished audio"
    assert not output.exists()


def test_racing_partial_create_is_not_deleted(
    tmp_path: Path,
) -> None:
    """Exclusive-create failure after preflight cannot remove another file."""
    output = tmp_path / "narrator.wav"

    def competing_open(path: str, **_kwargs: object) -> None:
        Path(path).write_bytes(b"competing writer's data")
        raise FileExistsError("simulated exclusive-create collision")

    writer = StreamingWav(
        output, 24_000, SimpleNamespace(SoundFile=competing_open), 24_000,
    )
    with pytest.raises(FileExistsError, match="exclusive-create"), writer:
        pass
    assert writer._partial.read_bytes() == b"competing writer's data"
    assert not output.exists()


def test_preexisting_partial_symlink_is_preserved(
    tmp_path: Path,
) -> None:
    """A symlinked temporary path must not be followed or removed."""
    output = tmp_path / "narrator.wav"
    external = tmp_path / "protected.wav"
    external.write_bytes(b"important content")
    writer = StreamingWav(
        output, 24_000,
        SimpleNamespace(SoundFile=lambda *_args, **_kwargs: None),
        24_000,
    )
    try:
        writer._partial.symlink_to(external)
    except (OSError, NotImplementedError):
        pytest.skip("Symlinks unavailable")
    with pytest.raises(FileExistsError, match="Temporary audio"), writer:
        pass
    assert writer._partial.is_symlink()
    assert external.read_bytes() == b"important content"
    assert not output.exists()
