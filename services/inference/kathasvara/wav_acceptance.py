"""Read-only, stdlib-only WAV structural inspection for user-led Hindi acceptance.

This does NOT load model weights, pronounce Hindi or assess whether any voices
are distinct. Output contains no supplied filename or private story text.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import stat
import sys
import wave
from array import array
from pathlib import Path

MAX_WAV_BYTES = 512 * 1024 * 1024
MAX_SECONDS = 1200
# Human listening remains required. These are only conservative level warnings.
QUIET_RMS_DBFS = -60.0
CLIPPING_SAMPLE_FRACTION = 0.01


def _dbfs(amplitude: float) -> float | None:
    """Return null for digital silence rather than reporting -infinity in JSON."""
    return round(20 * math.log10(amplitude / 32768.0), 2) if amplitude > 0 else None


def _level_hints(*, peak: int, squared_sum: int, clipped: int, frames: int) -> dict[str, object]:
    rms = math.sqrt(squared_sum / frames)
    rms_dbfs = _dbfs(rms)
    quiet = rms_dbfs is None or rms_dbfs <= QUIET_RMS_DBFS
    possible_clipping = clipped / frames >= CLIPPING_SAMPLE_FRACTION
    return {
        "peak_dbfs": _dbfs(peak),
        "rms_dbfs": rms_dbfs,
        "near_silence_hint": quiet,
        "possible_clipping_hint": possible_clipping,
        "clipped_sample_percentage": round(100 * clipped / frames, 3),
        # A simple amplitude check is not a signal classifier. It is only an
        # invitation to listen to the WAV, never evidence of Hindi quality.
        "signal_review_required": quiet or possible_clipping,
    }


def inspect_wav_candidate(path: Path) -> dict[str, object]:
    """Validate actual PCM bytes and report structure without interpreting audio."""
    if not path.is_absolute() or path.suffix.lower() != ".wav":
        raise ValueError("Choose an absolute .wav filename.")
    if path.is_symlink():
        raise ValueError("A WAV acceptance candidate must be a regular non-symlink file.")
    # NOFOLLOW is available on POSIX; on Windows the initial symlink rejection
    # still avoids ordinary directory/link shortcuts. fstat checks the opened FD.
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        raise ValueError("Cannot open candidate WAV as a local file.") from exc
    with os.fdopen(fd, "rb") as raw:
        info = os.fstat(raw.fileno())
        if not stat.S_ISREG(info.st_mode) or not 44 <= info.st_size <= MAX_WAV_BYTES:
            raise ValueError("Candidate WAV is not a bounded regular audio file.")
        try:
            with wave.open(raw, "rb") as wav:
                rate = wav.getframerate()
                frames = wav.getnframes()
                if (wav.getnchannels() != 1 or wav.getsampwidth() != 2 or
                    wav.getcomptype() != "NONE" or not 8000 <= rate <= 192000 or
                    frames <= 0 or frames > MAX_SECONDS * rate):
                    raise ValueError("Expected mono PCM16 WAV of at most 20 minutes.")
                # Header frame counts can lie when the file is truncated. Read
                # in bounded chunks to confirm all claimed PCM samples exist.
                seen = 0
                squared_sum = 0
                peak = 0
                clipped = 0
                while True:
                    samples = wav.readframes(8192)
                    if not samples:
                        break
                    if len(samples) % 2:
                        raise ValueError("PCM16 data contains a partial sample.")
                    pcm = array("h")
                    pcm.frombytes(samples)
                    if sys.byteorder != "little":
                        pcm.byteswap()
                    seen += len(pcm)
                    if seen > frames:
                        raise ValueError("WAV contains more frames than its declared data.")
                    squared_sum += sum(value * value for value in pcm)
                    peak = max(peak, max(abs(value) for value in pcm))
                    clipped += sum(abs(value) >= 32767 for value in pcm)
                if seen != frames:
                    raise ValueError("WAV audio is truncated or the frame count is incorrect.")
                levels = _level_hints(
                    peak=peak, squared_sum=squared_sum, clipped=clipped, frames=seen,
                )
        except wave.Error as exc:
            raise ValueError("WAV contains an unsupported or invalid PCM header.") from exc
        raw.seek(0)
        digest = hashlib.sha256()
        while chunk := raw.read(1024 * 1024):
            digest.update(chunk)
        if os.fstat(raw.fileno()).st_size != info.st_size:
            raise ValueError("WAV changed during inspection.")
    return {
        "format": "kathasvara-wav-structural-inspection",
        "schema_version": 1,
        "structure_valid": True,
        "codec": "pcm_s16le",
        "channels": 1,
        "sample_rate_hz": rate,
        "frames": frames,
        "duration_seconds": round(frames / rate, 3),
        "file_bytes": info.st_size,
        "sha256": digest.hexdigest(),
        "level_hints": levels,
        "model_loaded": False,
        "hindi_listening_verified": False,
        "distinct_voices_verified": False,
        "human_review_required": True,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Inspect local WAV PCM integrity; never claim Hindi listening quality.",
    )
    parser.add_argument("--wav", required=True, type=Path, help="Absolute path to a WAV")
    args = parser.parse_args(argv)
    try:
        result = inspect_wav_candidate(args.wav)
    except (OSError, ValueError):
        # Avoid exposing private machine paths through exception strings.
        print("WAV structural inspection failed; the file is absent, invalid, "
              "unsupported, oversized or changed during inspection.", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
