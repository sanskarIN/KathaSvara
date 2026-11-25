"""Cache decoding regressions; synthetic PCM is test data, not speech evidence.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf

from kathasvara import cache_audio
from kathasvara.cache_audio import read_cached_pcm
from kathasvara.production import render_story
from kathasvara.dialogue import parse_dialogue
from kathasvara.story import narrator

RATE = 24_000


def make_wav(path: Path, frames: int = 2400, *, rate: int = RATE,
             subtype: str = "PCM_16", channels: int = 1) -> None:
    signal = np.resize(np.array([0.125, -0.125], dtype=np.float32), frames)
    if channels == 2:
        signal = np.column_stack((signal, signal))
    sf.write(str(path), signal, rate, subtype=subtype)


def test_cache_reads_exact_pcm_on_one_file_object(tmp_path: Path) -> None:
    path = tmp_path / "cache.wav"
    make_wav(path)
    opened = []

    def open_stream(source, **kwargs):
        assert not isinstance(source, (str, Path))
        opened.append(source)
        return sf.SoundFile(source, **kwargs)

    samples, over = read_cached_pcm(
        path, RATE, 2400, RATE, SimpleNamespace(SoundFile=open_stream),
    )
    assert not over
    assert samples.shape == (2400,)
    assert np.array_equal(samples[:2], [0.125, -0.125])
    assert len(opened) == 1 and opened[0].closed


@pytest.mark.parametrize("kwargs", [
    {"rate": 16_000}, {"subtype": "FLOAT"}, {"channels": 2}, {"frames": 0},
    {"frames": RATE + 1},
])
def test_cache_rejects_incompatible_metadata(tmp_path: Path, kwargs: dict) -> None:
    path = tmp_path / "cache.wav"
    make_wav(path, **kwargs)
    assert read_cached_pcm(path, RATE, RATE, RATE, sf) == (None, False)


def test_cache_budget_rejects_before_reading_samples(tmp_path: Path) -> None:
    path = tmp_path / "cache.wav"
    make_wav(path)

    class NoRead:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        format = "WAV"
        subtype = "PCM_16"
        channels = 1
        samplerate = RATE
        frames = 2400

        def read(self, **_kwargs):
            pytest.fail("Over-budget cache must not allocate PCM")

    assert read_cached_pcm(
        path, RATE, 2399, RATE, SimpleNamespace(SoundFile=lambda *_a, **_k: NoRead()),
    ) == (None, True)


def test_cache_rejects_short_decoder_read(tmp_path: Path) -> None:
    path = tmp_path / "cache.wav"
    make_wav(path)

    class ShortRead:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        format = "WAV"
        subtype = "PCM_16"
        channels = 1
        samplerate = RATE
        frames = 2400

        def read(self, **kwargs):
            assert kwargs == {"frames": 2400, "dtype": "float32", "always_2d": False}
            return np.ones(2399, dtype=np.float32)

    assert read_cached_pcm(
        path, RATE, RATE, RATE, SimpleNamespace(SoundFile=lambda *_a, **_k: ShortRead()),
    ) == (None, False)


def test_cache_rejects_path_replaced_before_open(tmp_path: Path, monkeypatch) -> None:
    path = tmp_path / "cache.wav"
    other = tmp_path / "other.wav"
    make_wav(path)
    make_wav(other, frames=4800)
    real_open = os.open

    def replaced(filename, flags):
        other.replace(path)
        return real_open(filename, flags)

    def unexpected(*_args, **_kwargs):
        pytest.fail("A substituted file must not reach the decoder")

    monkeypatch.setattr(cache_audio.os, "open", replaced)
    assert read_cached_pcm(
        path, RATE, RATE, RATE, SimpleNamespace(SoundFile=unexpected),
    ) == (None, False)


def test_cache_rejects_persistent_mutation_during_decode(tmp_path: Path) -> None:
    path = tmp_path / "cache.wav"
    make_wav(path)

    class MutatingRead:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        format = "WAV"
        subtype = "PCM_16"
        channels = 1
        samplerate = RATE
        frames = 2400

        def read(self, **_kwargs):
            with path.open("ab") as writer:
                writer.write(b"changed")
            return np.ones(2400, dtype=np.float32)

    assert read_cached_pcm(
        path, RATE, RATE, RATE, SimpleNamespace(SoundFile=lambda *_a, **_k: MutatingRead()),
    ) == (None, False)


def test_cache_refuses_symlink_without_opening_target(tmp_path: Path) -> None:
    target = tmp_path / "target.wav"
    path = tmp_path / "cache.wav"
    make_wav(target)
    try:
        path.symlink_to(target)
    except (OSError, NotImplementedError):
        pytest.skip("Symlinks unavailable")

    def unexpected(*_args, **_kwargs):
        pytest.fail("Symlink must not be decoded")

    assert read_cached_pcm(
        path, RATE, RATE, RATE, SimpleNamespace(SoundFile=unexpected),
    ) == (None, False)


def test_cache_refuses_large_container_before_native_open(tmp_path: Path) -> None:
    path = tmp_path / "cache.wav"
    path.write_bytes(b"x" * (2 * RATE + cache_audio.MAX_CACHE_WAV_OVERHEAD + 1))

    def unexpected(*_args, **_kwargs):
        pytest.fail("Oversized container must not be decoded")

    assert read_cached_pcm(
        path, RATE, RATE, RATE, SimpleNamespace(SoundFile=unexpected),
    ) == (None, False)


class MockEngine:
    sample_rate = RATE

    def __init__(self):
        self.calls = 0

    def load(self):
        pass

    def generate(self, _text, _settings):
        self.calls += 1
        return np.resize(np.array([0.125, -0.125], dtype=np.float32), 2400)


def test_story_recovers_from_truncated_cache(tmp_path: Path) -> None:
    doc = parse_dialogue("परीक्षण", "Narrator: नमस्कार।", [narrator()])
    cache = tmp_path / "cache"
    render_story(doc, tmp_path / "first.wav", cache, MockEngine())
    path, = cache.glob("*.wav")
    path.write_bytes(path.read_bytes()[:40])
    engine = MockEngine()
    result = render_story(doc, tmp_path / "recovered.wav", cache, engine)
    assert engine.calls == 1
    assert result["segments"][0]["cached"] is False
    assert sf.info(str(tmp_path / "recovered.wav")).frames == 2400

    engine = MockEngine()
    result = render_story(doc, tmp_path / "reused.wav", cache, engine)
    assert engine.calls == 0
    assert result["segments"][0]["cached"] is True
