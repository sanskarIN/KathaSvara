"""Model-free production audit contracts, with privacy-preserving reason codes.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from kathasvara.cli import handle
from kathasvara.dialogue import parse_dialogue
from kathasvara.production_audit import audit_production_readiness
from kathasvara.story import narrator


def test_every_scene_ready_with_explicit_labels_and_no_content_exposure() -> None:
    doc = parse_dialogue(
        "राजा भोज का गाँव",
        "# दरबार\nNarrator: सभा में स्वागत है।\n---\n# गाँव\nNarrator: पानी सबका है।",
        [narrator()],
    )
    report = audit_production_readiness(doc)
    assert report["total_scenes"] == 2
    assert report["ready_scenes"] == 2
    assert report["full_story_ready"] is True
    assert report["full_story_chunks"] >= 2
    assert report["model_loaded"] is False
    assert report["audio_verified"] is False
    assert report["distinct_voices_verified"] is False
    assert all(item["ready"] and item["reason"] == "ready" for item in report["scenes"])
    assert "सभा" not in str(report) and "पानी" not in str(report)
    assert "दरबार" not in str(report) and "गाँव" not in str(report)
    assert handle({"action": "audit_production", "project": doc.to_dict()})["result"] == report


def test_unassigned_actor_blocks_only_own_scene_and_full_story() -> None:
    doc = parse_dialogue(
        "हिंदी कहानी",
        "# प्रथम\nNarrator: नमस्कार।\n---\n# द्वितीय\nअज्ञात व्यक्ति: कहाँ जा रहे हो?",
        [narrator()],
    )
    report = audit_production_readiness(doc)
    assert report["ready_scenes"] == 1
    assert report["scenes"][0]["ready"] is True
    assert report["scenes"][1]["reason"] == "unassigned_speaker"
    assert not report["full_story_ready"]
    assert report["full_story_reason"] == "unassigned_speaker"
    assert "अज्ञात" not in str(report)
    assert "कहाँ" not in str(report)


def test_stage_directions_are_not_speech_and_have_no_model_requirements() -> None:
    doc = parse_dialogue("निर्देश", "[दरवाज़ा खुलता है]", [narrator()])
    report = audit_production_readiness(doc)
    assert report["total_scenes"] == 1
    assert report["ready_scenes"] == 0
    assert report["scenes"][0]["segments"] == 0
    assert report["scenes"][0]["chunks"] == 0
    assert report["scenes"][0]["reason"] == "no_dialogue"
    assert report["full_story_reason"] == "no_dialogue"


def test_blank_story_can_be_audited_without_creating_audio_jobs() -> None:
    doc = parse_dialogue("खाली", "", [narrator()])
    report = audit_production_readiness(doc)
    assert report["scenes"] == []
    assert report["full_story_reason"] == "no_dialogue"
    assert not report["full_story_ready"]


def test_full_story_over_limit_can_still_have_individually_valid_scenes() -> None:
    lines = "\n".join("Narrator: एक छोटी बात।" for _ in range(130))
    doc = parse_dialogue(
        "लंबी कथा", "# पहला\n" + lines + "\n---\n# दूसरा\n" + lines,
        [narrator()],
    )
    report = audit_production_readiness(doc)
    assert report["ready_scenes"] == 2
    assert not report["full_story_ready"]
    assert report["full_story_reason"] == "over_limit"
    assert report["full_story_chunks"] == 0


def test_invalid_ipc_payload_is_rejected() -> None:
    import pytest

    with pytest.raises(TypeError, match="story document"):
        handle({"action": "audit_production", "project": "not-a-document"})
