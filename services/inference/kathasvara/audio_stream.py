"""Streaming, size-limited, atomic publication of mono PCM16 WAV output.

A finished file is created only after the WAV header is finalized. The entire
story waveform is never concatenated into a single in-memory array.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any, Self


class StreamingWav:
    """Write audio incrementally, preserving the destination on failure."""

    def __init__(self, destination: Path, rate: int, sf: Any, max_frames: int):
        self.destination = destination
        self.rate = rate
        self.sf = sf
        self.max_frames = max_frames
        self.frames = 0
        self._file: Any = None
        self._published = False
        self._partial = destination.with_name(
            f"{destination.stem}-{uuid.uuid4().hex}.partial.wav"
        )

    def __enter__(self) -> Self:
        self.destination.parent.mkdir(parents=True, exist_ok=True)
        if self.destination.exists() or self.destination.is_symlink():
            raise ValueError("Choose a new absolute WAV destination.")
        # SoundFile may create its target and then fail while initializing
        # libsndfile. Since __enter__ failed, Python will not call __exit__.
        # Discard an incomplete temporary WAV immediately in this case.
        try:
            self._file = self.sf.SoundFile(
                str(self._partial), mode="x", samplerate=self.rate,
                channels=1, format="WAV", subtype="PCM_16",
            )
        except BaseException:
            self._discard_partial()
            raise
        return self

    def write(self, samples: Any) -> None:
        if self._file is None or self._published:
            raise RuntimeError("Audio writer is not available.")
        count = len(samples)
        if count <= 0 or self.frames + count > self.max_frames:
            raise ValueError("Render exceeds the 20-minute audio limit.")
        self._file.write(samples)
        self.frames += count

    def finish(self) -> None:
        if self._file is None or self.frames <= 0:
            raise RuntimeError("No speech generated.")
        self._file.close()
        self._file = None
        info = self.sf.info(str(self._partial))
        if (info.format != "WAV" or info.subtype != "PCM_16" or
            info.channels != 1 or info.samplerate != self.rate or
            info.frames != self.frames):
            raise RuntimeError("Final WAV metadata failed validation.")
        # Hard-link publication provides atomic no-overwrite semantics on the
        # same filesystem, unlike replace() which can silently overwrite.
        os.link(self._partial, self.destination)
        self._published = True

    def _discard_partial(self) -> None:
        # Do not mask the primary model/audio exception if cleanup also fails.
        # This name is an unpredictable UUID unique to this writer instance.
        try:
            self._partial.unlink(missing_ok=True)
        except OSError:
            pass

    def __exit__(self, *_exc: object) -> None:
        try:
            if self._file is not None:
                self._file.close()
                self._file = None
        finally:
            # A close failure must not strand a partial WAV on disk.
            self._discard_partial()
