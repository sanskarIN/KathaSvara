"""Read-only, stdlib-only WAV structural inspection for user-led Hindi acceptance.

This does NOT load model weights, pronounce Hindi or assess whether any voices
are distinct. Output contains no supplied filename or private story text.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import sys
import wave
from pathlib import Path

MAX_WAV_BYTES = 512 * 1024 * 1024
MAX_SECONDS = 1200


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
                while True:
                    samples = wav.readframes(8192)
                    if not samples:
                        break
                    if len(samples) % 2:
                        raise ValueError("PCM16 data contains a partial sample.")
                    seen += len(samples) // 2
                    if seen > frames:
                        raise ValueError("WAV contains more frames than its declared data.")
                if seen != frames:
                    raise ValueError("WAV audio is truncated or the frame count is incorrect.")
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
