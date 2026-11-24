"""Local-only reference-voice WAV validation for opt-in speech conditioning.

Never upload the user's clip, record its path in logs, or trust file names as
cache identity. The content SHA-256 separates audio generated with different
reference recordings. This validation is model-free.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import hashlib
import io
import os
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


def _same_file_state(before: os.stat_result, after: os.stat_result) -> bool:
    return (
        stat.S_ISREG(after.st_mode)
        and (before.st_dev, before.st_ino) == (after.st_dev, after.st_ino)
        and before.st_size == after.st_size
        and before.st_mtime_ns == after.st_mtime_ns
        and before.st_ctime_ns == after.st_ctime_ns
    )


def _read_reference_bytes(path: Path, info: os.stat_result) -> bytes:
    """Read one bounded descriptor; never follow a substituted POSIX symlink."""
    flags = (
        os.O_RDONLY | getattr(os, "O_BINARY", 0) |
        getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    )
    fd = os.open(path, flags)
    with os.fdopen(fd, "rb") as source:
        opened = os.fstat(source.fileno())
        if not _same_file_state(info, opened):
            raise ValueError(REFERENCE_CHANGED_ERROR)
        content = source.read(MAX_REFERENCE_BYTES + 1)
        if (
            len(content) != opened.st_size
            or len(content) > MAX_REFERENCE_BYTES
            or not _same_file_state(opened, os.fstat(source.fileno()))
        ):
            raise ValueError(REFERENCE_CHANGED_ERROR)
    return content


def _validate_reference_riff(content: bytes) -> tuple[int, int, int]:
    """Check the entire RIFF container, including chunks after audio data.

    Python's wave decoder stops at the first data chunk. Other decoders can
    interpret malformed trailing or duplicate chunks differently. Reject
    ambiguous containers before using a reference as a cache identity.
    """
    if (
        len(content) < 44 or content[:4] != b"RIFF"
        or content[8:12] != b"WAVE"
        or int.from_bytes(content[4:8], "little") + 8 != len(content)
    ):
        raise ValueError(REFERENCE_ERROR)
    position = 12
    chunk_count = 0
    audio_format: tuple[int, int] | None = None
    frames: int | None = None
    while position < len(content):
        if len(content) - position < 8:
            raise ValueError(REFERENCE_ERROR)
        chunk_count += 1
        if chunk_count > 4096:
            raise ValueError(REFERENCE_ERROR)
        kind = content[position:position + 4]
        size = int.from_bytes(content[position + 4:position + 8], "little")
        start = position + 8
        next_chunk = start + size + size % 2
        if next_chunk > len(content):
            raise ValueError(REFERENCE_ERROR)
        if kind == b"fmt ":
            if audio_format is not None or size < 16:
                raise ValueError(REFERENCE_ERROR)
            fmt = content[start:start + 16]
            codec = int.from_bytes(fmt[0:2], "little")
            channels = int.from_bytes(fmt[2:4], "little")
            rate = int.from_bytes(fmt[4:8], "little")
            byte_rate = int.from_bytes(fmt[8:12], "little")
            alignment = int.from_bytes(fmt[12:14], "little")
            depth = int.from_bytes(fmt[14:16], "little")
            if (
                codec != 1 or channels not in (1, 2)
                or not 16_000 <= rate <= 48_000 or depth != 16
                or alignment != channels * 2 or byte_rate != rate * alignment
            ):
                raise ValueError(REFERENCE_ERROR)
            audio_format = channels, rate
        elif kind == b"data":
            if frames is not None or audio_format is None:
                raise ValueError(REFERENCE_ERROR)
            channels, rate = audio_format
            alignment = channels * 2
            if size % alignment:
                raise ValueError(REFERENCE_ERROR)
            frames = size // alignment
            if not 2 * rate <= frames <= 20 * rate:
                raise ValueError(REFERENCE_ERROR)
        position = next_chunk
    if audio_format is None or frames is None:
        raise ValueError(REFERENCE_ERROR)
    return audio_format[0], audio_format[1], frames


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
        content = _read_reference_bytes(path, info)
        expected_channels, expected_rate, expected_frames = _validate_reference_riff(content)
        with wave.open(io.BytesIO(content), "rb") as recording:
            channels = recording.getnchannels()
            rate = recording.getframerate()
            frames = recording.getnframes()
            width = recording.getsampwidth()
            if (recording.getcomptype() != "NONE" or width != 2 or
                channels != expected_channels or rate != expected_rate or
                frames != expected_frames):
                raise ValueError(REFERENCE_ERROR)
            # A truncated RIFF file can report plausible frame metadata.
            read_bytes = 0
            channel_energies = [0] * channels
            channel_sums = [0] * channels
            downmix_sum = 0
            downmix_energy = 0
            frame_count = 0
            while (data := recording.readframes(8192)):
                read_bytes += len(data)
                if read_bytes > frames * channels * width or len(data) % 2:
                    raise ValueError(REFERENCE_ERROR)
                pcm = array("h")
                pcm.frombytes(data)
                if sys.byteorder != "little":
                    pcm.byteswap()
                if len(pcm) % channels:
                    raise ValueError(REFERENCE_ERROR)
                frame_count += len(pcm) // channels
                for channel in range(channels):
                    # PCM WAV frames interleave L/R samples. A constant
                    # positive-left / negative-right recording has artificial
                    # variation when channels are mixed in one statistic.
                    per_channel = pcm[channel::channels]
                    channel_energies[channel] += sum(
                        sample * sample for sample in per_channel
                    )
                    channel_sums[channel] += sum(per_channel)
                if channels == 2:
                    # Chatterbox uses librosa.load() with mono=True. Stereo
                    # channels with opposed waveforms can cancel to silence
                    # on downmix, despite both channels having valid variance.
                    combined = [
                        left + right
                        for left, right in zip(pcm[::2], pcm[1::2])
                    ]
                    downmix_sum += sum(combined)
                    downmix_energy += sum(value * value for value in combined)
            if read_bytes != frames * channels * width or frame_count != frames:
                raise ValueError(REFERENCE_ERROR)
            # Remove each channel's DC offset independently. Accept if the
            # combined variance is at least one PCM16 step squared per sample.
            # The integer formulation avoids float cancellation and overflow.
            centered_energy = sum(
                energy * frames - total * total
                for energy, total in zip(channel_energies, channel_sums)
            )
            if centered_energy < channels * frames * frames:
                raise ValueError(REFERENCE_ERROR)
            if channels == 2:
                centered_downmix = (
                    downmix_energy * frames - downmix_sum * downmix_sum
                )
                # Divide L+R by 2 for mono; check at least one PCM16 step.
                if centered_downmix < 4 * frames * frames:
                    raise ValueError(REFERENCE_ERROR)
            # A varying waveform is still NOT proof of understandable speech,
            # a particular speaker's identity, consent or clean recording.
        # Hash the same bounded snapshot whose PCM was checked, not a second
        # opening of the selected filename. Ordinary persistent replacement
        # or modification still invalidates the result before it is returned.
        digest = hashlib.sha256()
        digest.update(content)
        if not _same_file_state(info, path.lstat()):
            raise ValueError(REFERENCE_CHANGED_ERROR)
        return digest.hexdigest()
    except (OSError, EOFError, wave.Error) as exc:
        raise ValueError(REFERENCE_ERROR) from exc
