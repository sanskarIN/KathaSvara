"""Mock-engine tests exercise WAV logic; these DO NOT claim real TTS quality.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import numpy as np
import pytest
import soundfile as sf

from kathasvara.engine import VoiceSettings
from kathasvara.synthesis import synthesize


class FakeEngine:
    """Controlled deterministic numbers for transport testing, never production."""

    sample_rate = 24000

    def load(self) -> None:
        return None

    def generate(self, text: str, settings: VoiceSettings) -> np.ndarray:
        return np.full((1, 2400), 0.08, dtype=np.float32)


def test_wav_is_real_pcm16_file(tmp_path) -> None:
    output = tmp_path / "narration.wav"
    info = synthesize("नमस्कार, मित्रों!", output, VoiceSettings(), FakeEngine())
    wav = sf.info(str(output))
    assert info["chunks"] == 1
    assert info["sample_rate"] == 24000
    assert info["duration_seconds"] > 0
    assert wav.channels == 1
    assert wav.subtype == "PCM_16"
    assert wav.frames > 0


def test_refuses_existing_output(tmp_path) -> None:
    output = tmp_path / "existing.wav"
    output.write_bytes(b"do-not-overwrite")
    with pytest.raises(FileExistsError):
        synthesize("राजा भोज", output, VoiceSettings(), FakeEngine())
    assert output.read_bytes() == b"do-not-overwrite"


def test_invalid_output_suffix(tmp_path) -> None:
    with pytest.raises(ValueError):
        synthesize("नमस्कार", tmp_path / "out.mp3", VoiceSettings(), FakeEngine())


def test_multi_sentence_chunking(tmp_path) -> None:
    text = "यह कहानी सन् १०१० की है। " * 40
    result = synthesize(text, tmp_path / "story.wav", VoiceSettings(), FakeEngine())
    assert result["chunks"] > 1
