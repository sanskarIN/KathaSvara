"""OS-owned cross-process file lock for speech-cache mutation and rendering.

The sentinel file is deliberately kept on disk. The operating system releases
its advisory lock when an inference process exits, even after a crash. Do not
delete/recreate the sentinel during normal cleanup: that could split the lock.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import errno
import os
import stat
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def exclusive_cache_access(cache_dir: Path) -> Iterator[None]:
    """Fail closed if another KathaSvara inference worker uses this cache.

    All participating Python workers must use the same cache parent directory.
    This guards cache maintenance and story rendering across app processes.
    It does not coordinate unsupported third-party cache writers.
    """
    if not cache_dir.is_absolute() or cache_dir.is_symlink():
        raise ValueError("Cache must be an absolute non-symlink directory.")
    directory = cache_dir.parent
    if not directory.is_dir() or directory.is_symlink():
        raise ValueError("Cache parent must be an existing non-symlink directory.")
    path = directory / ".kathasvara-cache-operation.lock"
    flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_BINARY", 0)
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    acquired = False
    try:
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode) or path.is_symlink():
            raise ValueError("Cache lock file must be a regular non-symlink file.")
        if os.name == "nt":
            import msvcrt

            # Ensure the lock range contains a byte on Windows. Two processes
            # may initialize concurrently but never remove/recreate the inode.
            if metadata.st_size == 0:
                os.write(fd, b"\0")
            # Lock one fixed byte of the same persistent file for every worker.
            os.lseek(fd, 0, os.SEEK_SET)
            try:
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            except OSError as exc:
                if exc.errno in (errno.EACCES, errno.EAGAIN, errno.EDEADLK, 13, 36):
                    raise RuntimeError("A different KathaSvara worker is using this cache.") from exc
                raise
        else:
            import fcntl

            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                if exc.errno in (errno.EACCES, errno.EAGAIN):
                    raise RuntimeError("A different KathaSvara worker is using this cache.") from exc
                raise
        acquired = True
        yield
    finally:
        if acquired:
            if os.name == "nt":
                import msvcrt

                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)
