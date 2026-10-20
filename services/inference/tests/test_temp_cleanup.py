"""No-model recovery cleanup regression tests.

Runs on Python 3.11 without Chatterbox weights or audio hardware.
"""
from __future__ import annotations

import os
import time
import uuid
from pathlib import Path

import pytest

from kathasvara.cache_lock import exclusive_cache_access
from kathasvara.temp_cleanup import cleanup_partial_wavs


def test_preview_and_confirm_delete_only_old_generated_partials(tmp_path: Path) -> None:
    audio = tmp_path / "audio"
    cache = tmp_path / "segment-cache"
    audio.mkdir()
    cache.mkdir()
    job = str(uuid.uuid4())
    temp = str(uuid.uuid4())
    old_audio = audio / f"{job}-{temp}.partial.wav"
    old_cache = cache / f"{'a' * 64}-{temp}.partial.wav"
    completed = audio / f"{job}.wav"
    finished_cache = cache / f"{'b' * 64}.wav"
    ordinary = audio / "precious.partial.wav"
    recent = audio / f"{uuid.uuid4()}-{uuid.uuid4()}.partial.wav"
    for path in (old_audio, old_cache, completed, finished_cache, ordinary, recent):
        path.write_bytes(b"test")
    current = time.time()
    for path in (old_audio, old_cache, completed, finished_cache, ordinary):
        os.utime(path, (current - 100_000, current - 100_000))
    before = cleanup_partial_wavs(tmp_path, now=current)
    assert before["dry_run"] is True
    assert before["candidates"] == 2
    assert before["bytes_reclaimable"] == 8
    assert old_audio.exists() and old_cache.exists()
    done = cleanup_partial_wavs(tmp_path, dry_run=False, now=current)
    assert done["removed"] == 2 and done["bytes_removed"] == 8
    assert not old_audio.exists() and not old_cache.exists()
    assert all(path.exists() for path in (completed, finished_cache, ordinary, recent))
    assert (tmp_path / ".kathasvara-cache-operation.lock").is_file()


def test_active_renderer_lock_blocks_even_preview_and_mutation(tmp_path: Path) -> None:
    with exclusive_cache_access(tmp_path / "segment-cache"):
        with pytest.raises(RuntimeError, match="different KathaSvara worker"):
            cleanup_partial_wavs(tmp_path)
        with pytest.raises(RuntimeError, match="different KathaSvara worker"):
            cleanup_partial_wavs(tmp_path, dry_run=False)


def test_symlink_and_invalid_roots_never_delete(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="absolute"):
        cleanup_partial_wavs(Path("relative"))
    cache = tmp_path / "segment-cache"
    cache.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    audio = tmp_path / "audio"
    try:
        audio.symlink_to(outside, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("Symlinks unavailable.")
    with pytest.raises(ValueError, match="symlinked"):
        cleanup_partial_wavs(tmp_path, dry_run=False)
    assert outside.is_dir()


def test_cache_symlink_entries_remain_untouched(tmp_path: Path) -> None:
    cache = tmp_path / "segment-cache"
    cache.mkdir()
    outside = tmp_path / "outside.wav"
    outside.write_bytes(b"untouched")
    fake = cache / f"{'d' * 64}-{uuid.uuid4()}.partial.wav"
    try:
        fake.symlink_to(outside)
    except (OSError, NotImplementedError):
        pytest.skip("Symlinks unavailable.")
    assert cleanup_partial_wavs(tmp_path, dry_run=False)["removed"] == 0
    assert fake.is_symlink()
    assert outside.read_bytes() == b"untouched"


def test_invalid_cleanup_flags_are_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="boolean"):
        cleanup_partial_wavs(tmp_path, dry_run="yes")  # type: ignore[arg-type]
