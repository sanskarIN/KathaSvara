"""Regress exclusive cache-WAV staging without real speech model downloads.

No generated samples in this suite are claimed to be human-sounding speech.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf

from kathasvara import production


def fixed_staging_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> tuple[Path, Path]:
    monkeypatch.setattr(
        production.uuid, "uuid4", lambda: SimpleNamespace(hex="a" * 32),
    )
    path = tmp_path / "cache" / ("f" * 64 + ".wav")
    partial = path.with_name(f"{path.stem}-{'a' * 32}.partial.wav")
    partial.parent.mkdir(parents=True)
    return path, partial


def samples() -> np.ndarray:
    return np.full(2400, 0.12, dtype=np.float32)


def test_cache_write_refuses_preexisting_staging_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    path, partial = fixed_staging_path(tmp_path, monkeypatch)
    partial.write_bytes(b"other process owns this")

    def unexpected_open(*_args: object, **_kwargs: object) -> None:
        pytest.fail("Must not open another writer's temporary WAV")

    with pytest.raises(FileExistsError, match="Temporary cache"):
        production._atomic_wav(
            path, samples(), 24_000, SimpleNamespace(SoundFile=unexpected_open),
        )
    assert partial.read_bytes() == b"other process owns this"
    assert not path.exists()


def test_cache_write_preserves_racing_exclusive_create(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    path, partial = fixed_staging_path(tmp_path, monkeypatch)

    def racing_open(filename: str, **kwargs: object) -> None:
        assert kwargs["mode"] == "x"
        Path(filename).write_bytes(b"another writer got here first")
        raise FileExistsError("exclusive-create collision")

    with pytest.raises(FileExistsError, match="exclusive-create"):
        production._atomic_wav(
            path, samples(), 24_000, SimpleNamespace(SoundFile=racing_open),
        )
    assert partial.read_bytes() == b"another writer got here first"
    assert not path.exists()


def test_cache_write_does_not_follow_preexisting_symlink(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    path, partial = fixed_staging_path(tmp_path, monkeypatch)
    protected = tmp_path / "important-data.wav"
    protected.write_bytes(b"protected file")
    try:
        partial.symlink_to(protected)
    except (OSError, NotImplementedError):
        pytest.skip("Filesystem cannot create symlinks")

    with pytest.raises(FileExistsError, match="Temporary cache"):
        production._atomic_wav(
            path, samples(), 24_000, SimpleNamespace(
                SoundFile=lambda *_args, **_kwargs: pytest.fail("No open allowed"),
            ),
        )
    assert partial.is_symlink()
    assert protected.read_bytes() == b"protected file"
    assert not path.exists()


def test_native_initialization_failure_cleans_created_partial(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    path, partial = fixed_staging_path(tmp_path, monkeypatch)

    def broken_open(filename: str, **kwargs: object) -> None:
        assert kwargs["mode"] == "x"
        Path(filename).write_bytes(b"incomplete header")
        raise OSError("codec initialization failed")

    with pytest.raises(OSError, match="codec initialization"):
        production._atomic_wav(
            path, samples(), 24_000, SimpleNamespace(SoundFile=broken_open),
        )
    assert not partial.exists()
    assert not path.exists()


def test_cache_refresh_writes_pcm16_and_replaces_only_cache_entry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    path, partial = fixed_staging_path(tmp_path, monkeypatch)
    production._atomic_wav(path, samples(), 24_000, sf)
    first = sf.info(str(path))
    assert first.format == "WAV" and first.subtype == "PCM_16"
    assert first.channels == 1 and first.frames == 2400
    assert first.samplerate == 24_000
    assert not partial.exists()

    replacement = np.full(2400, 0.25, dtype=np.float32)
    production._atomic_wav(path, replacement, 24_000, sf)
    restored, rate = sf.read(str(path), dtype="float32")
    assert rate == 24_000
    assert float(np.mean(restored)) == pytest.approx(0.25, abs=1e-4)
    assert not partial.exists()


def test_invalid_cached_wav_header_is_never_published(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    path, partial = fixed_staging_path(tmp_path, monkeypatch)
    wrong_metadata = SimpleNamespace(
        format="WAV", subtype="FLOAT", channels=1, frames=2400, samplerate=24_000,
    )
    mock = SimpleNamespace(
        SoundFile=sf.SoundFile, info=lambda _path: wrong_metadata,
    )
    with pytest.raises(RuntimeError, match="WAV header"):
        production._atomic_wav(path, samples(), 24_000, mock)
    assert not path.exists()
    assert not partial.exists()
