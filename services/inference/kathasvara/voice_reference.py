"""Local-only reference-voice WAV validation for opt-in speech conditioning.

Never upload the user's clip, record its path in logs, or trust file names as
cache identity. The content SHA-256 separates audio generated with different
reference recordings. This validation is model-free.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import hashlib
import stat
import sys
import wave
from array import array
from pathlib import Path

MAX_REFERENCE_BYTES = 24 * 1024 * 1024
REFERENCE_ERROR = (
    "Reference voice WAV is invalid. Select an existing local, non-symlink "
    "16-bit PCM WAV (mono or stereo, 16-48 kHz, 2-20 seconds, at most 24 MiB)."
)
REFERENCE_CHANGED_ERROR = (
    "Reference voice WAV changed after validation. Restore it or restart "
    "the audio job with the updated recording."
)


def inspect_reference_wav(path: Path) -> str:
    """Validate one caller-selected reference and return its content digest.

    Only local uncompressed PCM16 is accepted. No reference audio bytes or
    filesystem paths are returned to the desktop diagnostics or cache metadata.
    """
    if not path.is_absolute() or path.suffix.lower() != ".wav":
        raise ValueError(REFERENCE_ERROR)
    try:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or not 44 <= info.st_size <= MAX_REFERENCE_BYTES:
            raise ValueError(REFERENCE_ERROR)
        with wave.open(str(path), "rb") as recording:
            channels = recording.getnchannels()
            rate = recording.getframerate()
            frames = recording.getnframes()
            width = recording.getsampwidth()
            if (recording.getcomptype() != "NONE" or width != 2 or
                channels not in (1, 2) or not 16_000 <= rate <= 48_000 or
                not 2 * rate <= frames <= 20 * rate):
                raise ValueError(REFERENCE_ERROR)
            # A truncated RIFF file can report plausible frame metadata.
            read_bytes = 0
            total_energy = 0
            sample_count = 0
            while (data := recording.readframes(8192)):
                read_bytes += len(data)
                if read_bytes > frames * channels * width or len(data) % 2:
                    raise ValueError(REFERENCE_ERROR)
                pcm = array("h")
                pcm.frombytes(data)
                if sys.byteorder != "little":
                    pcm.byteswap()
                total_energy += sum(sample * sample for sample in pcm)
                sample_count += len(pcm)
            if read_bytes != frames * channels * width or sample_count == 0:
                raise ValueError(REFERENCE_ERROR)
            # A recording of pure silence or one narrow nonzero spike is not
            # a useful conditioning prompt. This is only a PCM-level gate,
            # not a detector for consent, voice identity or intelligibility.
            if total_energy < sample_count:
                raise ValueError(REFERENCE_ERROR)
        digest = hashlib.sha256()
        with path.open("rb") as source:
            while chunk := source.read(128 * 1024):
                digest.update(chunk)
        # Detect simple size changes between the metadata check and hash.
        if path.stat().st_size != info.st_size:
            raise ValueError(REFERENCE_ERROR)
        return digest.hexdigest()
    except (OSError, EOFError, wave.Error) as exc:
        raise ValueError(REFERENCE_ERROR) from exc
