"""Audio orchestration contracts are tested with deliberate mock engines only.

These are NOT actual recorded model audio and are never release voice samples.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from kathasvara.dialogue import parse_dialogue
from kathasvara.production import RenderCancelled, render_story
from kathasvara.story import Character, VoiceProfile, narrator


class FakeEngine:
    sample_rate = 24000

    def __init__(self) -> None:
        self.loads = 0
        self.calls: list[tuple[str, float]] = []

    def load(self) -> None:
        self.loads += 1

    def generate(self, text: str, settings: object) -> np.ndarray:
        self.calls.append((text, settings.exaggeration))
        return np.full(2400, 0.12, dtype=np.float32)


def sample_doc():
    raja = Character("raja", "राजा भोज", voice=VoiceProfile(exaggeration=0.8))
    return parse_dialogue(
        "दरबार", "Narrator: नमस्कार।\nराजा भोज: प्रजा कैसी है?",
        [narrator(), raja], script_id="render-test",
    )


def test_render_preserves_order_and_measured_duration(tmp_path: Path) -> None:
    doc = sample_doc()
    mock = FakeEngine()
    events: list[tuple[int, int]] = []
    out = tmp_path / "composite.wav"
    report = render_story(
        doc, out, tmp_path / "cache", mock,
        on_progress=lambda n, total: events.append((n, total)),
    )
    assert out.is_file()
    assert report["distinct_voices_verified"] is False
    assert report["sample_rate"] == 24000
    assert len(report["segments"]) == 2
    assert [setting for _, setting in mock.calls] == [0.5, 0.8]
    assert mock.loads == 1
    assert events == [(1, 2), (2, 2)]
    details = sf.info(str(out))
    assert details.channels == 1 and details.samplerate == 24000
    assert details.frames == 2400 * 2 + int(24000 * .14)
    assert report["duration_seconds"] == round(details.frames / 24000, 3)
    # Captions follow measured PCM frames and exclude silence between actors.
    assert report["segments"][0]["start_seconds"] == 0
    assert report["segments"][0]["end_seconds"] == 0.1
    assert report["segments"][1]["start_seconds"] == 0.24
    assert report["segments"][1]["end_seconds"] == 0.34


def test_second_render_reuses_cache_without_regenerating(tmp_path: Path) -> None:
    doc = sample_doc()
    first = FakeEngine()
    first_report = render_story(doc, tmp_path / "first.wav", tmp_path / "cache", first)
    second = FakeEngine()
    second_report = render_story(doc, tmp_path / "second.wav", tmp_path / "cache", second)
    assert len(first.calls) == 2 and second.calls == []
    assert all(item["cached"] for item in second_report["segments"])
    assert first_report["duration_seconds"] == second_report["duration_seconds"]


def test_render_rejects_unresolved_speaker_before_loading_model(tmp_path: Path) -> None:
    doc = parse_dialogue("A", "अज्ञात: नमस्ते।", [narrator()])
    mock = FakeEngine()
    with pytest.raises(ValueError, match="Assign every unknown"):
        render_story(doc, tmp_path / "audio.wav", tmp_path / "cache", mock)
    assert mock.loads == 0


def test_cancel_between_segments_keeps_cache_without_final_wav(tmp_path: Path) -> None:
    doc = sample_doc()
    mock = FakeEngine()
    progress = []
    out = tmp_path / "cancelled.wav"
    with pytest.raises(RenderCancelled):
        render_story(
            doc, out, tmp_path / "cache", mock,
            on_progress=lambda done, total: progress.append(done),
            is_cancelled=lambda: bool(progress),
        )
    assert progress == [1]
    assert not out.exists()
    assert len(list((tmp_path / "cache").glob("*.wav"))) == 1


def test_cached_output_refuses_overwrite(tmp_path: Path) -> None:
    doc = sample_doc()
    file = tmp_path / "already.wav"
    file.write_bytes(b"not a wav")
    with pytest.raises(ValueError, match="new absolute WAV"):
        render_story(doc, file, tmp_path / "cache", FakeEngine())
    assert file.read_bytes() == b"not a wav"


def test_cancel_does_not_leave_composition_partials(tmp_path: Path) -> None:
    doc = sample_doc()
    progress: list[int] = []
    out = tmp_path / "cancelled.wav"
    with pytest.raises(RenderCancelled):
        render_story(
            doc, out, tmp_path / "cache", FakeEngine(),
            on_progress=lambda done, total: progress.append(done),
            is_cancelled=lambda: len(progress) > 0,
        )
    assert not out.exists()
    assert list(tmp_path.glob("*.partial.wav")) == []
    assert len(list((tmp_path / "cache").glob("*.wav"))) == 1


def test_streaming_output_refuses_racing_destination_and_preserves_it(tmp_path: Path) -> None:
    """Finalization cannot replace a destination created after the initial check."""
    from kathasvara.audio_stream import StreamingWav

    out = tmp_path / "raced.wav"
    with StreamingWav(out, 24_000, sf, 24_000) as writer:
        writer.write(np.full(200, 0.1, dtype=np.float32))
        out.write_bytes(b"keep me")
        with pytest.raises(FileExistsError):
            writer.finish()
    assert out.read_bytes() == b"keep me"
    assert list(tmp_path.glob("*.partial.wav")) == []


def test_stream_writer_enforces_frame_limit_without_publishing(tmp_path: Path) -> None:
    from kathasvara.audio_stream import StreamingWav

    out = tmp_path / "oversize.wav"
    with pytest.raises(ValueError, match="20-minute"), StreamingWav(
        out, 24_000, sf, max_frames=10
    ) as writer:
        writer.write(np.full(8, 0.1, dtype=np.float32))
        writer.write(np.full(3, 0.1, dtype=np.float32))
        writer.finish()
    assert not out.exists()
    assert list(tmp_path.glob("*.partial.wav")) == []


def test_journal_survives_failure_and_retry_reuses_valid_audio(tmp_path: Path) -> None:
    import json

    class FailSecondEngine(FakeEngine):
        def generate(self, text: str, settings: object) -> np.ndarray:
            if len(self.calls) == 1:
                raise RuntimeError("Deliberate model failure")
            return super().generate(text, settings)

    doc = sample_doc()
    journal = tmp_path / "jobs" / "first.manifest.json"
    output = tmp_path / "failed.wav"
    with pytest.raises(RuntimeError, match="Deliberate"):
        render_story(
            doc, output, tmp_path / "cache", FailSecondEngine(),
            journal_path=journal,
        )
    history = json.loads(journal.read_text(encoding="utf-8"))
    assert history["state"] == "failed"
    assert history["done"] == 1 and history["total"] == 2
    # Recovery files must not persist a copy of the script/subtitles.
    assert "effective_text" not in journal.read_text(encoding="utf-8")
    assert len(history["segments"]) == 1
    assert "नमस्कार" not in journal.read_text(encoding="utf-8")
    assert not output.exists()
    assert list(tmp_path.glob("*.partial.wav")) == []

    retry = FakeEngine()
    output = tmp_path / "retried.wav"
    report = render_story(
        doc, output, tmp_path / "cache", retry,
        journal_path=tmp_path / "jobs" / "retried.manifest.json",
    )
    assert output.exists()
    assert len(retry.calls) == 1
    assert report["segments"][0]["cached"] is True
    recovered = json.loads((tmp_path / "jobs" / "retried.manifest.json").read_text())
    assert recovered["state"] == "completed" and recovered["done"] == 2


def test_cancelled_journal_remembers_progress_without_releasing_wav(tmp_path: Path) -> None:
    import json

    completed: list[int] = []
    path = tmp_path / "jobs" / "cancel.manifest.json"
    with pytest.raises(RenderCancelled):
        render_story(
            sample_doc(), tmp_path / "cancel.wav", tmp_path / "cache",
            FakeEngine(), journal_path=path,
            on_progress=lambda done, total: completed.append(done),
            is_cancelled=lambda: bool(completed),
        )
    journal = json.loads(path.read_text(encoding="utf-8"))
    assert journal["state"] == "cancelled"
    assert journal["done"] == 1
    assert journal["error_type"] == "RenderCancelled"
    assert not (tmp_path / "cancel.wav").exists()


def test_render_journal_cannot_overwrite_existing_file(tmp_path: Path) -> None:
    journal = tmp_path / "keep.json"
    journal.write_text("important")
    with pytest.raises(ValueError, match="already exists"):
        render_story(
            sample_doc(), tmp_path / "new.wav", tmp_path / "cache",
            FakeEngine(), journal_path=journal,
        )
    assert journal.read_text() == "important"
    assert not (tmp_path / "new.wav").exists()


@pytest.mark.parametrize("pause_ms", [0, 1])
def test_short_or_zero_speaker_pause_preserves_pcm_and_timing(
    tmp_path: Path, pause_ms: int,
) -> None:
    """Valid no-gap and 1ms settings must not cause an empty WAV write."""
    doc = sample_doc()
    narrator_character = next(c for c in doc.characters if c.id == "narrator")
    narrator_character.voice.pause_ms = pause_ms
    output = tmp_path / "short-pause.wav"
    cache = tmp_path / "cache"
    report = render_story(doc, output, cache, FakeEngine())
    pause_frames = int(24_000 * pause_ms / 1_000)
    expected_frames = 4_800 + pause_frames

    audio_info = sf.info(str(output))
    assert audio_info.frames == expected_frames
    assert report["duration_seconds"] == round(expected_frames / 24_000, 3)
    assert report["segments"][0]["end_seconds"] == 0.1
    assert report["segments"][1]["start_seconds"] == round(
        (2_400 + pause_frames) / 24_000, 4,
    )
    assert report["segments"][1]["end_seconds"] == round(
        expected_frames / 24_000, 4,
    )
    assert list(tmp_path.glob("*.partial.wav")) == []

    retry_engine = FakeEngine()
    retry = render_story(doc, tmp_path / "retry.wav", cache, retry_engine)
    assert retry_engine.calls == []
    assert all(segment["cached"] for segment in retry["segments"])
    assert sf.info(str(tmp_path / "retry.wav")).frames == expected_frames


@pytest.mark.parametrize("amplitude", [0.0, 1e-8])
def test_story_rejects_silent_model_chunks_without_cache(
    tmp_path: Path, amplitude: float,
) -> None:
    """A structurally valid zero-valued waveform is not a spoken segment."""
    class SilentEngine(FakeEngine):
        def generate(self, text: str, settings: object) -> np.ndarray:
            return np.full(2400, amplitude, dtype=np.float32)

    output = tmp_path / "silent-story.wav"
    cache = tmp_path / "cache"
    with pytest.raises(RuntimeError, match="effectively silent audio"):
        render_story(sample_doc(), output, cache, SilentEngine())
    assert not output.exists()
    assert list(tmp_path.glob("*.partial.wav")) == []
    assert list(cache.glob("*.wav")) == []


def test_silent_cached_segment_is_regenerated_before_reuse(tmp_path: Path) -> None:
    """A previously poisoned PCM cache must not silently replay on retry."""
    doc = parse_dialogue(
        "परीक्षण", "Narrator: नमस्कार।", [narrator()], script_id="silent-cache-test",
    )
    cache = tmp_path / "cache"
    render_story(doc, tmp_path / "original.wav", cache, FakeEngine())
    cached = list(cache.glob("*.wav"))
    assert len(cached) == 1
    sf.write(str(cached[0]), np.zeros(2400, dtype=np.float32), 24_000, subtype="PCM_16")

    engine = FakeEngine()
    result = render_story(doc, tmp_path / "repaired.wav", cache, engine)
    assert len(engine.calls) == 1
    assert result["segments"][0]["cached"] is False
    data, _rate = sf.read(str(cached[0]), dtype="float32")
    assert np.max(np.abs(data)) > 1.0 / 32768.0
    assert sf.info(str(tmp_path / "repaired.wav")).frames == 2400
