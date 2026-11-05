"""RMS rejection protects synthetic speech and cached audio alike.

These test waveforms are not genuine TTS outputs or evidence of Hindi quality.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import numpy as np
import pytest
import soundfile as sf
from test_production import FakeEngine

from kathasvara.dialogue import parse_dialogue
from kathasvara.engine import VoiceSettings
from kathasvara.pcm_signal import effectively_silent_pcm
from kathasvara.production import render_story
from kathasvara.story import narrator
from kathasvara.synthesis import synthesize


def sparse_impulse() -> np.ndarray:
    samples = np.zeros(2400, dtype=np.float32)
    samples[1200] = 0.001
    return samples


def test_sparse_impulse_exceeds_peak_threshold_but_fails_rms() -> None:
    samples = sparse_impulse()
    assert float(np.max(np.abs(samples))) > 1 / 32768
    assert effectively_silent_pcm(samples, np) is True


def test_consistently_quiet_but_varying_pcm_passes_math_gate() -> None:
    samples = np.tile(np.array([0.0001, -0.0001], dtype=np.float32), 1200)
    assert effectively_silent_pcm(samples, np) is False


@pytest.mark.parametrize("offset", [0.01, 0.5, -0.8])
def test_loud_constant_dc_offset_is_not_useful_audio(offset: float) -> None:
    samples = np.full(2400, offset, dtype=np.float32)
    assert effectively_silent_pcm(samples, np) is True


def test_loud_offset_with_tiny_variation_is_still_effectively_silent() -> None:
    samples = np.tile(np.array([0.2, 0.20000001], dtype=np.float32), 1200)
    assert effectively_silent_pcm(samples, np) is True


def test_loud_offset_with_genuine_variation_passes_signal_gate() -> None:
    samples = np.tile(np.array([0.1, 0.3], dtype=np.float32), 1200)
    assert effectively_silent_pcm(samples, np) is False


@pytest.mark.parametrize("values", [
    (1.2, 1.8), (-1.2, -1.8),
])
def test_clipping_cannot_publish_flat_dc_narration(
    tmp_path, values: tuple[float, float],
) -> None:
    class ClippedEngine(FakeEngine):
        def generate(self, text: str, settings: object) -> np.ndarray:
            return np.tile(np.asarray(values, dtype=np.float32), 1200)

    output = tmp_path / "clipped-narration.wav"
    # Raw RMS and variance pass; the PCM16 samples WOULD all be +1 or -1.
    raw = np.tile(np.asarray(values, dtype=np.float32), 1200)
    assert effectively_silent_pcm(raw, np) is False
    assert effectively_silent_pcm(np.clip(raw, -1.0, 1.0), np) is True
    with pytest.raises(RuntimeError, match="effectively silent audio"):
        synthesize("नमस्कार।", output, VoiceSettings(), ClippedEngine())
    assert not output.exists()
    assert list(tmp_path.glob("*.partial.wav")) == []


@pytest.mark.parametrize("values", [
    (1.2, 1.8), (-1.2, -1.8),
])
def test_clipping_cannot_cache_or_publish_flat_dc_story(
    tmp_path, values: tuple[float, float],
) -> None:
    class ClippedEngine(FakeEngine):
        def generate(self, text: str, settings: object) -> np.ndarray:
            return np.tile(np.asarray(values, dtype=np.float32), 1200)

    doc = parse_dialogue("परीक्षण", "Narrator: नमस्कार।", [narrator()])
    output = tmp_path / "clipped-story.wav"
    cache = tmp_path / "cache"
    with pytest.raises(RuntimeError, match="effectively silent audio"):
        render_story(doc, output, cache, ClippedEngine())
    assert not output.exists()
    assert list(cache.glob("*.wav")) == []
    assert list(tmp_path.glob("*.partial.wav")) == []


def test_partially_clipped_but_time_varying_pcm_remains_usable(tmp_path) -> None:
    class PartiallyClippedEngine(FakeEngine):
        def generate(self, text: str, settings: object) -> np.ndarray:
            return np.tile(np.array([1.2, 0.3], dtype=np.float32), 1200)

    output = tmp_path / "partially-clipped.wav"
    synthesize("नमस्कार।", output, VoiceSettings(), PartiallyClippedEngine())
    audio, rate = sf.read(str(output), dtype="float32")
    assert rate == 24_000
    assert effectively_silent_pcm(audio, np) is False
    assert float(np.max(audio)) < 1.001
    assert audio.size == 2400


def test_single_line_generator_rejects_constant_dc_without_publication(tmp_path) -> None:
    class DcEngine(FakeEngine):
        def generate(self, text: str, settings: object) -> np.ndarray:
            return np.full(2400, 0.3, dtype=np.float32)

    output = tmp_path / "dc-narration.wav"
    with pytest.raises(RuntimeError, match="effectively silent audio"):
        synthesize("नमस्कार।", output, VoiceSettings(), DcEngine())
    assert not output.exists()
    assert list(tmp_path.glob("*.partial.wav")) == []


def test_story_generator_does_not_cache_constant_dc(tmp_path) -> None:
    class DcEngine(FakeEngine):
        def generate(self, text: str, settings: object) -> np.ndarray:
            return np.full(2400, -0.25, dtype=np.float32)

    doc = parse_dialogue("परीक्षण", "Narrator: नमस्कार।", [narrator()])
    output = tmp_path / "story-dc.wav"
    cache = tmp_path / "cache"
    with pytest.raises(RuntimeError, match="effectively silent audio"):
        render_story(doc, output, cache, DcEngine())
    assert not output.exists()
    assert list(cache.glob("*.wav")) == []


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


def test_dc_poisoned_cached_segment_is_regenerated(tmp_path) -> None:
    doc = parse_dialogue("परीक्षण", "Narrator: नमस्कार।", [narrator()])
    cache = tmp_path / "cache"
    render_story(doc, tmp_path / "first-dc.wav", cache, FakeEngine())
    entries = list(cache.glob("*.wav"))
    assert len(entries) == 1
    sf.write(
        str(entries[0]),
        np.full(2400, 0.35, dtype=np.float32),
        24_000, subtype="PCM_16",
    )

    recovered = FakeEngine()
    report = render_story(doc, tmp_path / "recovered-dc.wav", cache, recovered)
    assert len(recovered.calls) == 1
    assert report["segments"][0]["cached"] is False
    assert sf.info(str(tmp_path / "recovered-dc.wav")).frames == 2400


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
