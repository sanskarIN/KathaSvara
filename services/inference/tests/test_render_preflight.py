"""No-model render preflight is deterministic and does not claim audio acceptance.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from pathlib import Path

import pytest
from test_production import FakeEngine, sample_doc

from kathasvara.cli import handle
from kathasvara.dialogue import parse_dialogue
from kathasvara.render_preflight import inspect_render_plan, prepare_render_plan
from kathasvara.story import narrator


def test_preflight_counts_hindi_without_model_or_writing_audio() -> None:
    doc = sample_doc()
    result = inspect_render_plan(doc)
    assert result["segments"] == 2
    assert result["chunks"] >= 2
    assert result["source_characters"] > 0
    assert result["spoken_characters"] > 0
    assert result["model_loaded"] is False
    assert result["duration_known"] is False
    assert result["distinct_voices_verified"] is False


def test_preflight_cli_uses_existing_story_and_explicit_line_selection() -> None:
    doc = sample_doc()
    line_id = doc.scenes[0].segments[0].id
    report = handle({
        "action": "preflight_render", "project": doc.to_dict(),
        "selected_segment_ids": [line_id], "force_segment_ids": [line_id],
    })["result"]
    assert report["segments"] == 1 and report["forced_segments"] == 1
    assert "namaskar" not in str(report).lower()
    with pytest.raises(TypeError, match="bounded arrays"):
        handle({"action": "preflight_render", "project": doc.to_dict(),
                "selected_scene_ids": "not-an-array"})


def test_preflight_rejects_incompatible_scene_and_line_filters() -> None:
    doc = parse_dialogue(
        "दो दृश्य",
        "# पहला दृश्य\nNarrator: नमस्ते।\n---\n# दूसरा दृश्य\nNarrator: फिर मिलेंगे।",
        [narrator()],
    )
    assert len(doc.scenes) == 2
    other_line_id = doc.scenes[1].segments[0].id
    with pytest.raises(ValueError, match="outside the chosen scenes"):
        inspect_render_plan(doc, selected_scene_ids={doc.scenes[0].id},
                            selected_segment_ids={other_line_id})
    with pytest.raises(ValueError, match="Forced regeneration"):
        inspect_render_plan(doc, selected_scene_ids={doc.scenes[0].id},
                            force_segment_ids={other_line_id})


def test_preflight_blocks_unassigned_speakers_and_invalid_selection() -> None:
    doc = parse_dialogue("Unassigned", "अज्ञात: मुझे सुनो।", [narrator()])
    with pytest.raises(ValueError, match="Assign every unknown speaker"):
        inspect_render_plan(doc)
    with pytest.raises(ValueError, match="does not belong"):
        inspect_render_plan(sample_doc(), selected_scene_ids={"wrong-scene"})


def test_preflight_zero_segments_is_not_an_implicit_full_render() -> None:
    with pytest.raises(ValueError, match="1–256"):
        inspect_render_plan(sample_doc(), selected_segment_ids=set())


def test_renderer_reuses_preflight_before_loading_model(
    tmp_path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from kathasvara import render_preflight
    from kathasvara.production import render_story

    mock = FakeEngine()
    monkeypatch.setattr(render_preflight, "MAX_CHUNKS", 1)
    with pytest.raises(ValueError, match="Too many speech chunks"):
        render_story(sample_doc(), tmp_path / "blocked.wav", tmp_path / "cache", mock)
    assert mock.loads == 0
    assert not (tmp_path / "blocked.wav").exists()


def test_plan_preserves_exact_glossary_adjusted_text_and_chunks() -> None:
    from kathasvara.pronunciation import PronunciationRule

    doc = sample_doc()
    doc.pronunciation_glossary = [
        PronunciationRule(id="greeting", original="नमस्कार", spoken="नमन")
    ]
    original_source = doc.to_dict()
    plan = prepare_render_plan(doc)
    assert len(plan.lines) == 2
    assert plan.lines[0].effective_text == "नमन।"
    assert plan.lines[0].chunks == ("नमन।",)
    assert plan.lines[1].effective_text == "प्रजा कैसी है?"
    assert plan.chunk_count == sum(len(line.chunks) for line in plan.lines)
    assert plan.spoken_characters == sum(len(line.effective_text) for line in plan.lines)
    assert doc.to_dict() == original_source, "Read-only planning must never edit a project"
    report = plan.counts_only()
    assert set(report) == {
        "segments", "source_characters", "spoken_characters", "chunks",
        "forced_segments", "model_loaded", "duration_known",
        "distinct_voices_verified",
    }
    assert "नमन" not in str(report) and "प्रजा" not in str(report)


def test_render_uses_prepared_text_once_without_second_glossary_pass(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from kathasvara import render_preflight
    from kathasvara.production import render_story
    from kathasvara.pronunciation import PronunciationRule

    doc = sample_doc()
    doc.pronunciation_glossary = [
        PronunciationRule(id="first", original="नमस्कार", spoken="नमन")
    ]
    calls: list[str] = []
    original = render_preflight.apply_glossary

    def spy(text: str, glossary: object) -> dict:
        calls.append(text)
        return original(text, glossary)

    monkeypatch.setattr(render_preflight, "apply_glossary", spy)
    engine = FakeEngine()
    result = render_story(
        doc, tmp_path / "first.wav", tmp_path / "cache", engine,
    )
    assert len(calls) == 2, "Every selected line must be normalized just once"
    assert [text for text, _settings in engine.calls] == [
        "नमन।", "प्रजा कैसी है?",
    ]
    assert [entry["effective_text"] for entry in result["segments"]] == [
        "नमन।", "प्रजा कैसी है?",
    ]
    assert result["chunks"] == 2


def test_force_single_line_plan_does_not_normalize_other_lines(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from kathasvara import render_preflight

    doc = sample_doc()
    line_id = doc.scenes[0].segments[1].id
    calls: list[str] = []
    original = render_preflight.apply_glossary

    def spy(text: str, glossary: object) -> dict:
        calls.append(text)
        return original(text, glossary)

    monkeypatch.setattr(render_preflight, "apply_glossary", spy)
    plan = prepare_render_plan(
        doc, selected_segment_ids={line_id}, force_segment_ids={line_id},
    )
    assert plan.forced_segments == 1
    assert len(plan.lines) == 1
    assert plan.lines[0].segment.id == line_id
    assert calls == ["प्रजा कैसी है?"]


def test_unsplittable_hindi_character_fails_preflight_before_loading_model(
    tmp_path: Path,
) -> None:
    """An overlong written unit must not reach model loading or leave output."""
    from kathasvara.production import render_story

    doc = sample_doc()
    doc.scenes[0].segments[0].spoken_text = "क" + "\u093c" * 280 + "अ"
    with pytest.raises(ValueError, match="written Hindi character exceeds"):
        inspect_render_plan(doc)

    engine = FakeEngine()
    output = tmp_path / "refused.wav"
    with pytest.raises(ValueError, match="written Hindi character exceeds"):
        render_story(doc, output, tmp_path / "cache", engine)
    assert engine.loads == 0
    assert engine.calls == []
    assert not output.exists()
