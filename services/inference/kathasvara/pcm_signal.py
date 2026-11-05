"""Minimal lossless-PCM signal gate shared by single and story rendering.

This detects mathematical near-silence, not Hindi intelligibility or speaker
identity. NumPy is passed by the caller to keep imports optional for diagnostics.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from typing import Any

PCM16_QUANTIZATION_STEP = 1.0 / 32768.0


def effectively_silent_pcm(samples: Any, np: Any) -> bool:
    """Reject nearly silent PCM and waveforms with no useful AC variation.

    Peak-only checks miss an otherwise silent buffer containing a single
    impulse, while raw RMS alone accepts a constant non-zero DC offset.
    The stricter centered-RMS gate rejects both failures. This is not an
    intelligibility or speaker-identity detector; human listening remains
    required. Callers check mono shape, non-empty data and finite values first.
    """
    rms = float(np.linalg.norm(samples) / np.sqrt(samples.size))
    if rms < PCM16_QUANTIZATION_STEP:
        return True
    # A loud constant offset contains no varying sound. Float64 accumulation
    # avoids cancellation when computing the tiny variations of loud PCM16.
    centered_rms = float(np.std(samples, dtype=np.float64))
    return centered_rms < PCM16_QUANTIZATION_STEP
