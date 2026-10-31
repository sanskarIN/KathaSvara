"""Minimal lossless-PCM signal gate shared by single and story rendering.

This detects mathematical near-silence, not Hindi intelligibility or speaker
identity. NumPy is passed by the caller to keep imports optional for diagnostics.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from typing import Any


PCM16_QUANTIZATION_STEP = 1.0 / 32768.0


def effectively_silent_pcm(samples: Any, np: Any) -> bool:
    """Reject a waveform whose global RMS falls below one PCM16 step.

    Peak-only checks miss an otherwise silent buffer containing a single
    impulse. A streaming quality inspector and human listening are still needed
    to evaluate unnatural pauses, clipping, pronunciation or audible speech.
    Callers must first check mono shape, non-empty data and finite values.
    """
    rms = float(np.linalg.norm(samples) / np.sqrt(samples.size))
    return rms < PCM16_QUANTIZATION_STEP
