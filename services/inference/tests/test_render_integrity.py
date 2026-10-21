"""Rendering selection, cancellation and cache-boundary regression tests.

These use deterministic fake audio only; no Hindi model weights are downloaded.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from test_production import FakeEngine, sample_doc

from kathasvara import production
from kathasvara.dialogue import parse_dialogue
from kathasvara.production import RenderCancelled, render_story
from kathasvara.story import narrator


def test_force_retry_rejects_unknown_segment_before_loading_model(tmp_path: Path) -> None:
    mock = FakeEngine()
    with pytest.raises(ValueError, match="Forced regeneration must target"):
        render_story(
            sample_doc(), tmp_path / "retry.wav", tmp_path / "cache",
            mock, force_segment_ids={"not-a-story-segment"},
        )
    assert mock.loads == 0
    assert not (tmp_path / "retry.wav").exists()


def test_scene_selection_refuses_line_from_unselected_scene(tmp_path: Path) -> None:
    doc = parse_dialogue(
        "दो दृश्य",
        "# पहला दृश्य\nNarrator: पहले गाँव में।\n---\n# दूसरा दृश्य\nNarrator: फिर नगर में।",
        [narrator()],
    )
    assert len(doc.scenes) == 2
    scene = doc.scenes[0]
    other_line = doc.scenes[1].segments[0].id
    mock = FakeEngine()
    with pytest.raises(ValueError, match="outside the chosen scenes"):
        render_story(
            doc, tmp_path / "invalid.wav", tmp_path / "cache", mock,
            selected_scene_ids={scene.id}, selected_segment_ids={other_line},
        )
    assert mock.loads == 0
    with pytest.raises(ValueError, match="Forced regeneration must target"):
        render_story(
            doc, tmp_path / "forced.wav", tmp_path / "cache", mock,
            selected_scene_ids={scene.id}, force_segment_ids={other_line},
        )
    assert mock.loads == 0


def test_cancel_requested_before_model_load_skips_inference(tmp_path: Path) -> None:
    mock = FakeEngine()
    with pytest.raises(RenderCancelled, match="before model loading"):
        render_story(
            sample_doc(), tmp_path / "cancelled.wav", tmp_path / "cache",
            mock, is_cancelled=lambda: True,
        )
    assert mock.loads == 0
    assert mock.calls == []
    assert not (tmp_path / "cancelled.wav").exists()


def test_oversized_model_chunk_never_reaches_cache(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(production, "MAX_OUTPUT_SECONDS", 1)

    class TooLongEngine(FakeEngine):
        def generate(self, text: str, settings: object) -> np.ndarray:
            self.calls.append((text, settings.exaggeration))
            return np.full(self.sample_rate * 2, 0.12, dtype=np.float32)

    with pytest.raises(ValueError, match="20-minute audio limit"):
        render_story(
            sample_doc(), tmp_path / "oversized.wav", tmp_path / "cache",
            TooLongEngine(),
        )
    assert not (tmp_path / "oversized.wav").exists()
    assert list((tmp_path / "cache").glob("*.wav")) == []
    assert list(tmp_path.glob("*.partial.wav")) == []


def test_inter_segment_pause_is_checked_before_caching(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(production, "MAX_OUTPUT_SECONDS", 1)

    class NearLimitEngine(FakeEngine):
        def generate(self, text: str, settings: object) -> np.ndarray:
            self.calls.append((text, settings.exaggeration))
            return np.full(int(self.sample_rate * .95), 0.12, dtype=np.float32)

    # The first 0.95-second line fits, but its following 0.14-second pause
    # does not. No segment cache entry should be published for this failed job.
    with pytest.raises(ValueError, match="20-minute audio limit"):
        render_story(
            sample_doc(), tmp_path / "pause.wav", tmp_path / "cache",
            NearLimitEngine(),
        )
    assert not (tmp_path / "pause.wav").exists()
    assert list((tmp_path / "cache").glob("*.wav")) == []


def test_valid_single_line_force_retry_regenerates_selected_audio(tmp_path: Path) -> None:
    doc = sample_doc()
    line_id = doc.scenes[0].segments[0].id
    cache = tmp_path / "cache"
    # Seed a valid segment cache from a complete prior render.
    render_story(doc, tmp_path / "original.wav", cache, FakeEngine())
    mock = FakeEngine()
    result = render_story(
        doc, tmp_path / "one-line.wav", cache, mock,
        selected_segment_ids={line_id}, force_segment_ids={line_id},
    )
    assert len(mock.calls) == 1
    assert len(result["segments"]) == 1
    assert result["segments"][0]["segment_id"] == line_id
    assert result["segments"][0]["cached"] is False
    assert (tmp_path / "one-line.wav").is_file()



def test_cached_audio_over_remaining_budget_rejected_before_pcm_read(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A late cache hit must not allocate an over-budget float32 WAV array."""
    import soundfile as sf

    doc = sample_doc()
    cache = tmp_path / "cache"
    render_story(doc, tmp_path / "original.wav", cache, FakeEngine())
    assert len(list(cache.glob("*.wav"))) == 2

    calls: list[str] = []
    original = sf.read

    def traced_read(path: str, *args: object, **kwargs: object):
        calls.append(path)
        return original(path, *args, **kwargs)

    monkeypatch.setattr(sf, "read", traced_read)
    # Each segment contributes 2,400 frames. The first has a 3,360-frame
    # pause, leaving only 720 frames for the cached second segment.
    monkeypatch.setattr(production, "MAX_OUTPUT_SECONDS", 0.27)
    with pytest.raises(ValueError, match="20-minute audio limit"):
        render_story(
            doc, tmp_path / "too_long.wav", cache, FakeEngine(),
        )
    assert len(calls) == 1, "Only the cache entry that fits may be read as PCM."
    assert not (tmp_path / "too_long.wav").exists()
    assert len(list(cache.glob("*.wav"))) == 2


def test_cached_symlink_never_inspected_or_loaded(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The renderer must not follow a cache symlink supplied by another process."""
    import soundfile as sf

    doc = sample_doc()
    cache = tmp_path / "cache"
    render_story(doc, tmp_path / "original.wav", cache, FakeEngine())
    entry = min(cache.glob("*.wav"))
    private = tmp_path / "outside.wav"
    entry.replace(private)
    try:
        entry.symlink_to(private)
    except (NotImplementedError, OSError):
        pytest.skip("Filesystem cannot create symlinks.")

    # SoundFile metadata access to a cache alias should be skipped altogether.
    original_info = sf.info
    def check_no_symlink(path: str, *args: object, **kwargs: object):
        if Path(path) == entry:
            raise AssertionError("Attempted to inspect an untrusted cache symlink")
        return original_info(path, *args, **kwargs)

    monkeypatch.setattr(sf, "info", check_no_symlink)
    report = render_story(doc, tmp_path / "safe.wav", cache, FakeEngine())
    assert report["segments"]
    assert private.exists()
    assert not entry.is_symlink(), "Safe regeneration should replace only the cache alias."
    assert entry.is_file()
