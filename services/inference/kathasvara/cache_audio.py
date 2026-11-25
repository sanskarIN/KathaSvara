"""Bounded, single-descriptor cache audio reads for story composition.

Cache entries are disposable and can be corrupt or externally replaced. Never
decode a different path than the one whose metadata was used for the budget.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import os
import stat
from pathlib import Path
from typing import Any

from .wav_acceptance import _validate_pcm16_riff

# Generated mono PCM16 caches have tiny headers. Allow reasonable container
# overhead but avoid opening unexpectedly huge files in native decoders.
MAX_CACHE_WAV_OVERHEAD = 1024 * 1024


def _same_state(before: os.stat_result, after: os.stat_result) -> bool:
    return (
        stat.S_ISREG(after.st_mode)
        and (before.st_dev, before.st_ino) == (after.st_dev, after.st_ino)
        and before.st_size == after.st_size
        and before.st_mtime_ns == after.st_mtime_ns
        and before.st_ctime_ns == after.st_ctime_ns
    )


def read_cached_pcm(
    path: Path,
    rate: int,
    remaining_frames: int,
    max_frames: int,
    sf: Any,
) -> tuple[Any | None, bool]:
    """Return (mono samples or None, valid-header exceeds remaining budget).

    All metadata and PCM reads share one Python-owned regular file descriptor.
    SoundFile's file-object interface avoids passing platform-specific native
    file descriptors to libsndfile on Windows. A short read or persistent
    mutation is a cache miss; this is not a cryptographic integrity guarantee
    or a filesystem lock. No file is modified or removed by this reader.
    """
    selected = path.lstat()
    if (
        not stat.S_ISREG(selected.st_mode)
        or not 44 <= selected.st_size <= 2 * max_frames + MAX_CACHE_WAV_OVERHEAD
    ):
        return None, False
    flags = (
        os.O_RDONLY | getattr(os, "O_BINARY", 0)
        | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    )
    fd = os.open(path, flags)
    with os.fdopen(fd, "rb") as source:
        opened = os.fstat(source.fileno())
        if not _same_state(selected, opened):
            return None, False
        # Check the declared RIFF length and every chunk first. Native decoders
        # may silently shorten truncated data to the available complete frames.
        try:
            expected_rate, expected_frames = _validate_pcm16_riff(source, opened.st_size)
        except ValueError:
            return None, False
        if expected_rate != rate or expected_frames > max_frames:
            return None, False
        with sf.SoundFile(source, mode="r") as stream:
            frames = stream.frames
            if (
                stream.format != "WAV"
                or stream.subtype != "PCM_16"
                or stream.channels != 1
                or stream.samplerate != rate
                or frames != expected_frames
                or not 0 < frames <= max_frames
                or 44 + 2 * frames > opened.st_size
            ):
                return None, False
            over_budget = frames > remaining_frames
            samples = None
            if not over_budget:
                # Never use the default read-all behavior: a native decoder
                # must receive the exact previously approved frame count.
                samples = stream.read(
                    frames=frames, dtype="float32", always_2d=False,
                )
                if samples.ndim != 1 or samples.size != frames:
                    return None, False
        if not _same_state(opened, os.fstat(source.fileno())):
            return None, False
        if not _same_state(opened, path.lstat()):
            return None, False
        return samples, over_budget
