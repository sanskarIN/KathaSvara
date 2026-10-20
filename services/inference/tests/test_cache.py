"""Model-free unit tests for safe, explicitly requested cache maintenance."""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from kathasvara.cache import CACHE_GRACE_SECONDS, inspect_cache, prune_cache


def named_cache_file(folder: Path, char: str, size: int, age_seconds: int) -> Path:
    path = folder / f"{char * 64}.wav"
    path.write_bytes(b"x" * size)
    os.utime(path, (1_700_000_000 - age_seconds, 1_700_000_000 - age_seconds))
    return path


def test_missing_cache_is_safe_and_not_created(tmp_path: Path) -> None:
    folder = tmp_path / "missing"
    assert inspect_cache(folder) == {"files": 0, "bytes": 0, "ignored_entries": 0}
    assert prune_cache(folder, max_bytes=0, now=1_700_000_000)["bytes_reclaimable"] == 0
    assert not folder.exists()


def test_only_direct_sha256_wav_files_are_counted(tmp_path: Path) -> None:
    folder = tmp_path / "segment-cache"
    folder.mkdir()
    named_cache_file(folder, "a", 20, 3600)
    (folder / "notes.wav").write_bytes(b"keep")
    (folder / "nested").mkdir()
    assert inspect_cache(folder) == {"files": 1, "bytes": 20, "ignored_entries": 2}


def test_plan_does_not_mutate_and_prune_leaves_recent_wav(tmp_path: Path) -> None:
    folder = tmp_path / "segment-cache"
    folder.mkdir()
    older = named_cache_file(folder, "a", 12, 3600)
    newer = named_cache_file(folder, "b", 16, CACHE_GRACE_SECONDS + 1)
    active = named_cache_file(folder, "c", 18, 10)
    planned = prune_cache(folder, max_bytes=20, now=1_700_000_000)
    assert planned["dry_run"] is True
    assert planned["bytes_reclaimable"] == 28
    assert older.exists() and newer.exists() and active.exists()
    actual = prune_cache(folder, max_bytes=20, now=1_700_000_000, dry_run=False)
    assert actual["bytes_reclaimable"] == 28
    assert not older.exists() and not newer.exists() and active.exists()
    assert inspect_cache(folder)["bytes"] == 18


def test_prune_preserves_unrelated_and_symlink_targets(tmp_path: Path) -> None:
    folder = tmp_path / "cache"
    folder.mkdir()
    external = tmp_path / "external.wav"
    external.write_bytes(b"private-data")
    link = folder / f"{'a' * 64}.wav"
    try:
        link.symlink_to(external)
    except (OSError, NotImplementedError):
        pytest.skip("Symlink creation is unavailable in this environment.")
    keep = folder / "notes.txt"
    keep.write_text("keep")
    result = prune_cache(folder, max_bytes=0, now=1_700_000_000, dry_run=False)
    assert result["bytes_reclaimable"] == 0
    assert result["ignored_entries"] == 2
    assert external.read_bytes() == b"private-data"
    assert link.is_symlink() and keep.exists()


def test_cache_root_symlink_is_rejected(tmp_path: Path) -> None:
    real = tmp_path / "cache"
    real.mkdir()
    alias = tmp_path / "alias"
    try:
        alias.symlink_to(real, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("Symlink creation is unavailable in this environment.")
    with pytest.raises(ValueError, match="non-symlink"):
        inspect_cache(alias)


@pytest.mark.parametrize("budget", [-1, 50 * 1024 ** 3 + 1, 1.5, True])
def test_invalid_budgets_are_rejected(tmp_path: Path, budget: object) -> None:
    with pytest.raises(ValueError, match="budget"):
        prune_cache(tmp_path, max_bytes=budget)
