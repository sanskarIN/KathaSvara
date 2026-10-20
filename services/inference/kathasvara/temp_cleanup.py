"""Explicit maintenance of abandoned KathaSvara *partial* WAV files.

Never touch completed WAVs, cached segment WAVs, projects, render journals, or
files newer than a full day. OS-owned cache lock excludes participating active
renderers while inspection/removal runs. No background deletion is scheduled.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import re
import stat
import time
from pathlib import Path

from .cache_lock import exclusive_cache_access

MIN_PARTIAL_AGE_SECONDS = 24 * 60 * 60
MAX_SCANNED_ENTRIES = 20_000
MAX_REMOVED_ENTRIES = 1_024

_UUID = r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}"
# StreamingWav and _atomic_wav create suffixes with uuid4().hex (32
# lowercase hexadecimal characters), NOT a second hyphenated UUID.
_TEMP_SUFFIX = r"[0-9a-f]{32}"
_AUDIO_PARTIAL = re.compile(rf"{_UUID}-{_TEMP_SUFFIX}\.partial\.wav\Z")
_CACHE_PARTIAL = re.compile(rf"[0-9a-f]{{64}}-{_TEMP_SUFFIX}\.partial\.wav\Z")


def cleanup_partial_wavs(
    root: Path, *, dry_run: bool = True, now: float | None = None,
) -> dict[str, int | bool]:
    """Report or explicitly remove stale, regular, precisely named partial WAVs.

    Uses the same cross-process lock as the story renderer and segment pruner.
    A changed inode/mtime/size between inspection and unlink is always skipped.
    """
    if type(dry_run) is not bool:
        raise ValueError("dry_run must be a boolean.")
    if not root.is_absolute() or root.is_symlink() or not root.is_dir():
        raise ValueError("Cleanup needs an existing absolute non-symlink app-data directory.")
    current = time.time() if now is None else now
    if not isinstance(current, (int, float)) or not 0 < current < 10**12:
        raise ValueError("Invalid cleanup clock.")
    selected = 0
    bytes_selected = 0
    removed = 0
    bytes_removed = 0
    ignored = 0
    scanned = 0
    candidates: list[tuple[Path, int, int, int, int]] = []
    targets = (
        (root / "audio", _AUDIO_PARTIAL),
        (root / "segment-cache", _CACHE_PARTIAL),
    )
    # This lock is NOT removed: it is also used by Python narration workers.
    with exclusive_cache_access(root / "segment-cache"):
        # Validate *both* directories before any deletion. A late symlink or
        # excessive entry count must not leave one directory partially cleaned.
        for folder, _pattern in targets:
            if folder.is_symlink():
                raise ValueError("Cleanup refuses a symlinked audio/cache directory.")
            if folder.exists() and not folder.is_dir():
                raise ValueError("Cleanup target must be a directory.")
        for folder, allowed in targets:
            if not folder.exists():
                continue
            for path in folder.iterdir():
                scanned += 1
                if scanned > MAX_SCANNED_ENTRIES:
                    raise ValueError("Too many entries; cleanup inspection was bounded.")
                if allowed.fullmatch(path.name) is None:
                    ignored += 1
                    continue
                try:
                    info = path.lstat()
                except FileNotFoundError:
                    continue
                if not stat.S_ISREG(info.st_mode):
                    ignored += 1
                    continue
                if current - info.st_mtime < MIN_PARTIAL_AGE_SECONDS:
                    ignored += 1
                    continue
                selected += 1
                bytes_selected += info.st_size
                candidates.append((
                    path, info.st_size, info.st_dev, info.st_ino, info.st_mtime_ns,
                ))
        # A complete, bounded scan has succeeded before any destructive work.
        # Revalidate metadata just before unlink; skip races and symlink swaps.
        if not dry_run:
            for path, size, device, inode, modified_ns in candidates[:MAX_REMOVED_ENTRIES]:
                try:
                    after = path.lstat()
                    if (not stat.S_ISREG(after.st_mode) or
                        (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) !=
                        (device, inode, size, modified_ns)):
                        ignored += 1
                        continue
                    if path.parent.is_symlink():
                        raise ValueError("Cleanup folder changed during deletion.")
                    path.unlink()
                except FileNotFoundError:
                    continue
                removed += 1
                bytes_removed += size
    return {
        "dry_run": dry_run,
        "candidates": selected,
        "bytes_reclaimable": bytes_selected,
        "removed": removed,
        "bytes_removed": bytes_removed,
        "ignored_entries": ignored,
        "age_hours": 24,
        "max_deletions": MAX_REMOVED_ENTRIES,
    }
