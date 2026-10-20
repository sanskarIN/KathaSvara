"""Deterministic, offline tests for Hindi drama parsing and v0.1.x migration.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from dataclasses import asdict

import pytest

from kathasvara.dialogue import assign_speaker, parse_dialogue, unresolved_labels
from kathasvara.story import (
    Character,
    VoiceProfile,
    from_dict,
    migrate_legacy,
    narrator,
    new_story,
)


def characters() -> list[Character]:
    return [narrator(), Character("raja", "राजा भोज"), Character("mantri", "मंत्री")]


def test_two_speaker_hindi_dialogue_and_narration() -> None:
    original = (
        "Narrator: धार नगरी में राजा भोज रहते थे।\n"
        "राजा भोज: मंत्री जी, प्रजा कैसी है?\n"
        "मंत्री: महाराज, सब कुशल हैं।\n"
        "Narrator: राजा भोज मुस्कुरा उठे।"
    )
    doc = parse_dialogue("राजा भोज", original, characters(), script_id="story-v2")
    assert doc.text == original
    assert [s.speaker_id for s in doc.scenes[0].segments] == [
        "narrator", "raja", "mantri", "narrator"
    ]
    assert "महाराज" in doc.scenes[0].segments[2].spoken_text
    assert unresolved_labels(doc) == []
    assert doc.to_dict()["schema_version"] == 2


def test_multiline_and_unknown_speaker_require_manual_correction() -> None:
    script = "अजनबी: तुम कौन हो?\nमुझे बताओ।\nमंत्री: मैं मंत्री हूँ।"
    doc = parse_dialogue("Test", script, characters(), script_id="script-id")
    first = doc.scenes[0].segments[0]
    assert first.speaker_id is None
    assert first.source_label == "अजनबी"
    assert first.original_text == "तुम कौन हो?\nमुझे बताओ।"
    assert unresolved_labels(doc) == ["अजनबी"]
    assign_speaker(doc, first.id, "raja")
    assert first.speaker_id == "raja"
    assert first.source_label is None
    assert unresolved_labels(doc) == []
    assert first.audio_ref is None
    with pytest.raises(ValueError, match="known character"):
        assign_speaker(doc, first.id, "missing")


def test_stage_direction_does_not_generate_speech_and_preserves_scene_markers() -> None:
    original = "# पहला दृश्य\n[दरवाजा बंद होता है]\nNarrator: स्वागत है।\n---\nराजा भोज: अंदर आइए।"
    doc = parse_dialogue("Scenes", original, characters(), script_id="stable")
    assert len(doc.scenes) == 2
    assert doc.scenes[0].title == "पहला दृश्य"
    direction = doc.scenes[0].segments[0]
    assert direction.kind == "direction"
    assert direction.spoken_text == ""
    assert direction.original_text == "[दरवाजा बंद होता है]"
    assert doc.scenes[1].segments[0].speaker_id == "raja"
    other = parse_dialogue("Scenes", original, characters(), script_id="stable")
    assert doc.scenes[0].segments[0].id == other.scenes[0].segments[0].id


def test_unlabeled_prose_is_narration_not_guessed_character() -> None:
    doc = parse_dialogue("Story", "राजा भोज जंगल गए।\nउन्होंने नदी देखी।", characters())
    assert len(doc.scenes[0].segments) == 1
    assert doc.scenes[0].segments[0].speaker_id == "narrator"
    assert doc.scenes[0].segments[0].spoken_text.endswith("उन्होंने नदी देखी।")


def test_legacy_json_migration_is_nondestructive() -> None:
    old = {"id": "legacy-id", "title": "पुरानी कहानी", "text": "राजा भोज।"}
    migrated = migrate_legacy(old)
    assert migrated["id"] == old["id"]
    assert migrated["text"] == old["text"]
    assert migrated["characters"][0]["id"] == "narrator"
    assert migrated["scenes"] == []
    assert old == {"id": "legacy-id", "title": "पुरानी कहानी", "text": "राजा भोज।"}
    assert from_dict(old).to_dict() == migrated


def test_voice_profile_blocks_fake_speaker_conditioning() -> None:
    valid = VoiceProfile(exaggeration=0.75, cfg_weight=0.35, pause_ms=100)
    valid.validate()
    with pytest.raises(ValueError, match="not been verified"):
        VoiceProfile(speaker_conditioning="unverified-voice").validate()
    for bad in (float("nan"), float("inf"), 5.0):
        with pytest.raises(ValueError):
            VoiceProfile(exaggeration=bad).validate()


def test_unknown_speaker_or_duplicate_character_names_are_rejected() -> None:
    bad = [narrator(), Character("alpha", "Raja"), Character("beta", "raja")]
    doc = new_story("A")
    doc.characters = bad
    with pytest.raises(ValueError, match="unambiguous"):
        doc.validate()
    with pytest.raises(ValueError, match="Unsupported story schema"):
        from_dict({**asdict(new_story("Another")), "schema_version": 500})


def test_no_silent_truncation_of_long_text() -> None:
    with pytest.raises(ValueError, match="100000"):
        parse_dialogue("Too Long", "क" * 100_001, characters())


def test_document_serialization_roundtrip() -> None:
    doc = parse_dialogue("Roundtrip", "मंत्री: सब कुशल।", characters())
    assert from_dict(doc.to_dict()).to_dict() == doc.to_dict()
