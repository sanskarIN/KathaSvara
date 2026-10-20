"""Cross-process cache exclusion is tested without model weights or audio devices."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from kathasvara.cache_lock import exclusive_cache_access


def test_lock_is_reentrant_only_after_release(tmp_path: Path) -> None:
    cache = tmp_path / "segment-cache"
    with exclusive_cache_access(cache):
        lock_file = tmp_path / ".kathasvara-cache-operation.lock"
        assert lock_file.is_file()
        with pytest.raises(RuntimeError, match="different KathaSvara worker"), exclusive_cache_access(cache):
            pass
    with exclusive_cache_access(cache):
        pass
    assert lock_file.is_file(), "Never unlink the shared lock inode after releasing it."


def test_lock_is_released_if_job_raises(tmp_path: Path) -> None:
    cache = tmp_path / "segment-cache"
    with pytest.raises(ValueError, match="simulated"), exclusive_cache_access(cache):
        raise ValueError("simulated synthesis error")
    with exclusive_cache_access(cache):
        pass


def test_second_python_process_cannot_enter_during_active_lock(tmp_path: Path) -> None:
    cache = tmp_path / "segment-cache"
    script = (
        "from pathlib import Path\n"
        "from kathasvara.cache_lock import exclusive_cache_access\n"
        "with exclusive_cache_access(Path(__import__('sys').argv[1])): pass\n"
    )
    with exclusive_cache_access(cache):
        result = subprocess.run(
            [sys.executable, "-c", script, str(cache)],
            capture_output=True, text=True, timeout=15, check=False,
        )
        assert result.returncode != 0
        assert "different KathaSvara worker" in result.stderr
    result = subprocess.run(
        [sys.executable, "-c", script, str(cache)],
        capture_output=True, text=True, timeout=15, check=False,
    )
    assert result.returncode == 0, result.stderr


def test_invalid_roots_are_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="absolute"), exclusive_cache_access(Path("relative-cache")):
        pass
    with pytest.raises(ValueError, match="existing"), exclusive_cache_access(
        tmp_path / "missing" / "segment-cache"
    ):
        pass


def test_cache_root_symlink_does_not_acquire_lock(tmp_path: Path) -> None:
    real = tmp_path / "real"
    real.mkdir()
    link = tmp_path / "alias"
    try:
        link.symlink_to(real, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("Creating symlinks unavailable on this operating system.")
    with pytest.raises(ValueError, match="non-symlink"), exclusive_cache_access(link):
        pass
