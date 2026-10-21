"""No-model render preflight is deterministic and does not claim audio acceptance.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import pytest
from test_production import sample_doc

from kathasvara.cli import handle
from kathasvara.dialogue import parse_dialogue
from kathasvara.render_preflight import inspect_render_plan
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
