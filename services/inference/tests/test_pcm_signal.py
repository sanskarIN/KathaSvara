"""RMS rejection protects synthetic speech and cached audio alike.

These test waveforms are not genuine TTS outputs or evidence of Hindi quality.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import numpy as np
import pytest
import soundfile as sf

from kathasvara.dialogue import parse_dialogue
from kathasvara.engine import VoiceSettings
from kathasvara.pcm_signal import effectively_silent_pcm
from kathasvara.production import render_story
from kathasvara.story import narrator
from kathasvara.synthesis import synthesize

from test_production import FakeEngine


def sparse_impulse() -> np.ndarray:
    samples = np.zeros(2400, dtype=np.float32)
    samples[1200] = 0.001
    return samples


def test_sparse_impulse_exceeds_peak_threshold_but_fails_rms() -> None:
    samples = sparse_impulse()
    assert float(np.max(np.abs(samples))) > 1 / 32768
    assert effectively_silent_pcm(samples, np) is True


def test_consistently_quiet_but_representable_pcm_passes_math_gate() -> None:
    samples = np.full(2400, 0.0001, dtype=np.float32)
    assert effectively_silent_pcm(samples, np) is False


def test_single_line_generator_does_not_publish_silent_spike(tmp_path) -> None:
    class SparseEngine(FakeEngine):
        def generate(self, text: str, settings: object) -> np.ndarray:
            return sparse_impulse()

    output = tmp_path / "single.wav"
    with pytest.raises(RuntimeError, match="effectively silent audio"):
        synthesize("नमस्कार।", output, VoiceSettings(), SparseEngine())
    assert not output.exists()
    assert list(tmp_path.glob("*.partial.wav")) == []


def test_story_generator_does_not_cache_or_publish_silent_spike(tmp_path) -> None:
    class SparseEngine(FakeEngine):
        def generate(self, text: str, settings: object) -> np.ndarray:
            return sparse_impulse()

    doc = parse_dialogue("परीक्षण", "Narrator: नमस्कार।", [narrator()])
    output = tmp_path / "story.wav"
    cache = tmp_path / "cache"
    with pytest.raises(RuntimeError, match="effectively silent audio"):
        render_story(doc, output, cache, SparseEngine())
    assert not output.exists()
    assert list(cache.glob("*.wav")) == []
    assert list(tmp_path.glob("*.partial.wav")) == []


def test_spike_poisoned_cached_segment_is_regenerated(tmp_path) -> None:
    doc = parse_dialogue("परीक्षण", "Narrator: नमस्कार।", [narrator()])
    cache = tmp_path / "cache"
    render_story(doc, tmp_path / "first.wav", cache, FakeEngine())
    entries = list(cache.glob("*.wav"))
    assert len(entries) == 1
    sf.write(str(entries[0]), sparse_impulse(), 24_000, subtype="PCM_16")

    engine = FakeEngine()
    result = render_story(doc, tmp_path / "repaired.wav", cache, engine)
    assert len(engine.calls) == 1
    assert result["segments"][0]["cached"] is False
    assert sf.info(str(tmp_path / "repaired.wav")).frames == 2400
