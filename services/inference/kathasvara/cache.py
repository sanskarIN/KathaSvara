"""Explicit, conservative maintenance for local content-addressed speech WAV cache.

Only SHA-256-named regular WAV files directly inside the dedicated cache directory
are considered. Never follow symlinks or delete files recently written by inference.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import re
import stat
import time
from pathlib import Path

CACHE_BUDGET_BYTES = 512 * 1024 * 1024
MAX_CACHE_BUDGET_BYTES = 50 * 1024 * 1024 * 1024
CACHE_GRACE_SECONDS = 600
_CACHE_FILE = re.compile(r"[0-9a-f]{64}\.wav\Z")


def _cache_entries(cache_dir: Path) -> tuple[list[tuple[Path, int, float, int, int, int]], int]:
    if not cache_dir.is_absolute() or cache_dir.is_symlink():
        raise ValueError("Cache must be an absolute non-symlink directory.")
    if not cache_dir.exists():
        return [], 0
    if not cache_dir.is_dir():
        raise ValueError("Cache path is not a directory.")
    entries: list[tuple[Path, int, float, int, int]] = []
    ignored = 0
    for entry in cache_dir.iterdir():
        if not _CACHE_FILE.fullmatch(entry.name) or entry.is_symlink():
            ignored += 1
            continue
        try:
            info = entry.lstat()
        except FileNotFoundError:
            continue
        if not stat.S_ISREG(info.st_mode):
            ignored += 1
            continue
        entries.append((entry, info.st_size, info.st_mtime, info.st_dev, info.st_ino, info.st_mtime_ns))
    return entries, ignored


def inspect_cache(cache_dir: Path) -> dict[str, int]:
    """Read the current segment-cache footprint without creating/deleting files."""
    entries, ignored = _cache_entries(cache_dir)
    return {
        "files": len(entries),
        "bytes": sum(item[1] for item in entries),
        "ignored_entries": ignored,
    }


def prune_cache(
    cache_dir: Path, *, max_bytes: int = CACHE_BUDGET_BYTES,
    dry_run: bool = True, now: float | None = None,
) -> dict[str, int | bool]:
    """Keep newest eligible entries within budget; exclude files less than 10m old.

    Explicit opt-in; only files in the dedicated content-addressed cache. A race
    that changes an entry's inode or metadata before deletion causes a skip.
    This is not safe to run against arbitrary directories or active shared caches.
    """
    if type(max_bytes) is not int or not 0 <= max_bytes <= MAX_CACHE_BUDGET_BYTES:
        raise ValueError("Cache budget must be between 0 and 50 GiB.")
    if type(dry_run) is not bool:
        raise ValueError("dry_run must be a boolean.")
    current = time.time() if now is None else now
    entries, ignored = _cache_entries(cache_dir)
    total = sum(item[1] for item in entries)
    # Prefer newest files; all files in the grace window must remain untouched.
    entries.sort(key=lambda item: (-item[2], item[0].name))
    kept = 0
    reclaimed = 0
    selected = 0
    for path, size, modified, device, inode, modified_ns in entries:
        if current - modified < CACHE_GRACE_SECONDS or kept + size <= max_bytes:
            kept += size
            continue
        selected += 1
        if dry_run:
            reclaimed += size
            continue
        try:
            current_info = path.lstat()
            if (not stat.S_ISREG(current_info.st_mode) or
                (current_info.st_dev, current_info.st_ino, current_info.st_size,
                 current_info.st_mtime_ns) !=
                (device, inode, size, modified_ns)):
                ignored += 1
                continue
            path.unlink()
            reclaimed += size
        except FileNotFoundError:
            continue
    return {
        "files_before": len(entries),
        "bytes_before": total,
        "candidates": selected,
        "bytes_reclaimable": reclaimed,
        "dry_run": dry_run,
        "ignored_entries": ignored,
    }
