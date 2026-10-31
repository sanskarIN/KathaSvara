"""Model-free verification of the operator's genuine Hindi WAV smoke script.

Generated fixtures here are synthetic PCM, NEVER real voice acceptance samples.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import runpy
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

SCRIPT_PATH = Path(__file__).resolve().parents[3] / "scripts" / "smoke_hindi.py"
verify_smoke_output = runpy.run_path(str(SCRIPT_PATH))["verify_smoke_output"]


def _wav(tmp_path: Path, amplitude: float = 0.08) -> tuple[Path, dict]:
    path = tmp_path / "smoke.wav"
    sf.write(str(path), np.full(8_400, amplitude, dtype=np.float32), 24_000,
             format="WAV", subtype="PCM_16")
    return path, {"sample_rate": 24_000, "duration_seconds": 0.35}


def test_real_smoke_validator_checks_pcm_signal_and_duration(tmp_path: Path) -> None:
    path, metadata = _wav(tmp_path)
    report = verify_smoke_output(path, metadata)
    assert report["structure_valid"] is True
    assert report["frames"] == 8_400
    assert report["sample_rate_hz"] == 24_000
    assert len(report["sha256"]) == 64
    assert report["hindi_listening_verified"] is False
    assert report["human_review_required"] is True


@pytest.mark.parametrize("wrong", [
    {"sample_rate": 16_000, "duration_seconds": 0.35},
    {"sample_rate": 24_000, "duration_seconds": 0.9},
])
def test_real_smoke_rejects_disagreeing_synthesis_metadata(
    tmp_path: Path, wrong: dict,
) -> None:
    path, _ = _wav(tmp_path)
    with pytest.raises(RuntimeError, match="disagrees with synthesis metadata"):
        verify_smoke_output(path, wrong)


@pytest.mark.parametrize("amplitude", [0.0, 1.0 / 32768.0])
def test_real_smoke_rejects_near_silent_wav(tmp_path: Path, amplitude: float) -> None:
    path, metadata = _wav(tmp_path, amplitude)
    with pytest.raises(RuntimeError, match="near-silent"):
        verify_smoke_output(path, metadata)


def test_real_smoke_rejects_corrupt_wav(tmp_path: Path) -> None:
    path = tmp_path / "smoke.wav"
    path.write_bytes(b"not-a-wave")
    with pytest.raises(ValueError):
        verify_smoke_output(path, {"sample_rate": 24_000, "duration_seconds": 0.35})
