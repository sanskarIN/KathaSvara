"""Bounded, model-free PCM16 temporary-file round-trip diagnostic.

This probes only Python's temporary filesystem and the KathaSvara WAV reader.
It never touches a user's story or reference voice, downloads model weights,
checks audio hardware, plays sound, or claims Hindi speech works.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import tempfile
import wave
from pathlib import Path

from .wav_acceptance import inspect_wav_candidate

_TEST_RATE = 16_000
_TEST_FRAMES = 4_000  # 250 ms; 8 KiB of PCM16 audio, bounded and disposable.
_STAGES = {"temporary_directory", "write_pcm16", "inspect_pcm16", "cleanup"}


def probe_audio_io() -> dict[str, object]:
    """Write, read, structurally inspect and delete one synthetic PCM16 WAV.

    All failure reasons are fixed identifiers. Never emit an exception string,
    local temporary path, source text, or generated audio samples to the UI.
    This is an I/O diagnostic, not a real synthesis or playback test.
    """
    stage = "temporary_directory"
    try:
        with tempfile.TemporaryDirectory(prefix="kathasvara-wav-io-") as folder:
            sample = Path(folder) / "synthetic-test.wav"
            stage = "write_pcm16"
            pcm = bytearray()
            for index in range(_TEST_FRAMES):
                # A deterministic, varying signal, not synthesized speech.
                amplitude = ((index % 80) - 40) * 125
                pcm.extend(amplitude.to_bytes(2, "little", signed=True))
            with wave.open(str(sample), "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(_TEST_RATE)
                output.writeframes(pcm)

            stage = "inspect_pcm16"
            report = inspect_wav_candidate(sample)
            levels = report.get("level_hints")
            if (
                report.get("structure_valid") is not True
                or report.get("codec") != "pcm_s16le"
                or report.get("channels") != 1
                or report.get("sample_rate_hz") != _TEST_RATE
                or report.get("frames") != _TEST_FRAMES
                or report.get("duration_seconds") != 0.25
                or not isinstance(levels, dict)
                or levels.get("near_silence_hint") is not False
                or levels.get("dc_only_hint") is not False
            ):
                raise ValueError("Synthetic WAV round-trip did not match its fixture.")
            stage = "cleanup"
        return {
            "status": "passed",
            "failed_stage": None,
            "temporary_wav_roundtrip_ok": True,
            "model_loaded": False,
            "hindi_listening_verified": False,
            "audio_playback_verified": False,
            "help": (
                "Temporary PCM16 WAV write and read-back passed. This does not "
                "check Chatterbox, model weights, speakers, Windows audio output, "
                "or intelligible Hindi. Run the import doctor and an explicit "
                "real-model listening test separately."
            ),
        }
    except (OSError, ValueError, wave.Error):
        # Never include exception text: OS errors can embed private paths.
        return {
            "status": "failed",
            "failed_stage": stage if stage in _STAGES else "temporary_directory",
            "temporary_wav_roundtrip_ok": False,
            "model_loaded": False,
            "hindi_listening_verified": False,
            "audio_playback_verified": False,
            "help": (
                "Temporary WAV I/O failed at the reported stage. Check temporary "
                "directory permissions, disk space and local file access. "
                "No speech model was loaded."
            ),
        }
