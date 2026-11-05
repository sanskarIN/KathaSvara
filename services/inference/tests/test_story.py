"""Deterministic, offline tests for Hindi drama parsing and v0.1.x migration.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from copy import deepcopy
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
    with pytest.raises(ValueError, match="Unknown schema version"):
        from_dict({**asdict(new_story("Another")), "schema_version": 500})


def test_no_silent_truncation_of_long_text() -> None:
    with pytest.raises(ValueError, match="100000"):
        parse_dialogue("Too Long", "क" * 100_001, characters())


def test_document_serialization_roundtrip() -> None:
    doc = parse_dialogue("Roundtrip", "मंत्री: सब कुशल।", characters())
    assert from_dict(doc.to_dict()).to_dict() == doc.to_dict()


def test_editor_style_adjacent_scene_merge_survives_native_roundtrip_without_model() -> None:
    """Match the desktop's structural merge output using real v2 validation."""
    from kathasvara.render_preflight import inspect_render_plan

    script = (
        "# पहला दृश्य\nNarrator: राजा महल में आए।\n"
        "---\n# दूसरा दृश्य\n[द्वार खुलता है]\nNarrator: मंत्री ने नमस्ते कहा।"
    )
    doc = parse_dialogue("दो दृश्य", script, [narrator()], script_id="merge-roundtrip")
    assert len(doc.scenes) == 2
    doc.scenes[0].notes = "पहला दृश्य: धीमा प्रकाश"
    doc.scenes[1].notes = "दूसरा दृश्य: हल्का संगीत"
    line = next(seg for seg in doc.scenes[1].segments if seg.kind == "speech")
    line.audio_ref = "550e8400-e29b-41d4-a716-446655440000"
    line.duration_seconds = 1.5
    line.status = "completed"
    original = doc.to_dict()
    before_segments = [
        (part["id"], line["id"], line["original_text"], line["spoken_text"],
         line["speaker_id"], line["audio_ref"], line["duration_seconds"])
        for part in original["scenes"] for line in part["segments"]
    ]

    edited = deepcopy(original)
    first, second = edited["scenes"]
    first["notes"] = first["notes"] + "\n\nMerged scene: " + second["title"] + "\n" + second["notes"]
    first["segments"].extend(second["segments"])
    edited["scenes"] = [first]
    loaded = from_dict(edited)
    assert loaded.to_dict() == edited
    assert loaded.text == script
    assert len(loaded.scenes) == 1
    assert loaded.scenes[0].notes.endswith("Merged scene: दूसरा दृश्य\nदूसरा दृश्य: हल्का संगीत")
    after_segments = [
        (line["id"], line["original_text"], line["spoken_text"], line["speaker_id"],
         line["audio_ref"], line["duration_seconds"])
        for line in loaded.to_dict()["scenes"][0]["segments"]
    ]
    assert after_segments == [entry[1:] for entry in before_segments]
    assert [seg.kind for seg in loaded.scenes[0].segments] == [
        seg.kind for scene in doc.scenes for seg in scene.segments
    ]
    assert inspect_render_plan(loaded)["segments"] == 2


def test_native_schema_rejects_merged_scene_note_and_line_overflows() -> None:
    doc = parse_dialogue(
        "गिनती", "Narrator: नमस्कार।", [narrator()], script_id="limit-roundtrip"
    )
    valid = doc.to_dict()
    notes_overflow = deepcopy(valid)
    notes_overflow["scenes"][0]["notes"] = "क" * 4001
    with pytest.raises(ValueError, match="metadata or segment count"):
        from_dict(notes_overflow)

    too_many = deepcopy(valid)
    first_line = too_many["scenes"][0]["segments"][0]
    too_many["scenes"][0]["segments"] = [
        {**first_line, "id": "line-" + str(i)} for i in range(2001)
    ]
    with pytest.raises(ValueError, match="metadata or segment count"):
        from_dict(too_many)
