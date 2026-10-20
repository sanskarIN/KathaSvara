"""Pronunciation review and selective cache tests; mock speech is never real Hindi audio.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

import numpy as np
import pytest

from kathasvara.cli import handle
from kathasvara.dialogue import parse_dialogue
from kathasvara.production import render_story
from kathasvara.pronunciation import (
    PronunciationRule,
    apply_glossary,
    glossary_from_dict,
    validate_glossary,
)
from kathasvara.story import from_dict, narrator


def rule(source: str, spoken: str, id: str = "r") -> PronunciationRule:
    return PronunciationRule(id=id, original=source, spoken=spoken)


def test_hindi_unicode_boundaries_are_grapheme_safe() -> None:
    rules = [rule("क", "काय", "k"), rule("क़िला", "किला", "n")]
    text = "क का क़िला, क़िलों में नहीं। क्‍ष, क्‌ष।"
    result = apply_glossary(text, rules)
    assert result["text"] == "काय का किला, क़िलों में नहीं। क्‍ष, क्‌ष।"
    assert len(result["changes"]) == 2
    assert result["changes"][0]["rule_id"] == "k"


def test_mixed_case_multiword_numerals_and_punctuation() -> None:
    rules = [rule("Raja Bhoj", "राजा भोज", "a"), rule("2026", "दो हज़ार छब्बीस", "b")]
    result = apply_glossary("RAJA BHOJ! 2026, x2026 नहीं।", rules)
    assert result["text"] == "राजा भोज! दो हज़ार छब्बीस, x2026 नहीं।"
    assert len(result["changes"]) == 2


def test_replacement_is_one_pass_and_longest_first() -> None:
    rules = [rule("राजा", "रानी", "a"), rule("राजा भोज", "भोज राजा", "b")]
    result = apply_glossary("राजा भोज ने राजा को देखा।", rules)
    assert result["text"] == "भोज राजा ने रानी को देखा।"
    assert [c["rule_id"] for c in result["changes"]] == ["b", "a"]


def test_invalid_duplicate_blank_control_and_excessive_rule_inputs() -> None:
    with pytest.raises(ValueError, match="unique"):
        validate_glossary([rule("राजा", "रजा", "a"), rule("राजा", "raja", "b")])
    with pytest.raises(ValueError, match="single-line"):
        validate_glossary([rule("राजा\nनाम", "रजा")])
    with pytest.raises(ValueError, match="nonempty"):
        validate_glossary([rule("राजा", "")])
    with pytest.raises(ValueError, match="100"):
        validate_glossary([rule(f"word{i}", "alt", str(i)) for i in range(101)])
    with pytest.raises(ValueError, match="limit"):
        apply_glossary("क" * 100_001, [])


def test_enable_disable_roundtrip_v2_and_legacy() -> None:
    doc = parse_dialogue("कथा", "Narrator: राजा भोज।", [narrator()], script_id="review-id")
    doc.pronunciation_glossary = [rule("राजा भोज", "रजा भोज")]
    doc.validate()
    loaded = from_dict(doc.to_dict())
    assert loaded.pronunciation_glossary == doc.pronunciation_glossary
    segment = loaded.scenes[0].segments[0]
    preview = handle({"action": "preview_pronunciation", "project": loaded.to_dict(),
                      "segment_id": segment.id})
    assert preview["result"]["effective"] == "रजा भोज।"
    assert preview["result"]["original"] == segment.original_text
    assert loaded.text == "Narrator: राजा भोज।"
    with pytest.raises(ValueError, match="not synthesized"):
        bad = parse_dialogue("Direction", "[द्वार खुलता है]", [narrator()])
        handle({"action": "preview_pronunciation", "project": bad.to_dict(),
                "segment_id": bad.scenes[0].segments[0].id})
    glossary_from_dict([{**asdict(rule("राजा", "रजा")), "enabled": False}])
    old = {"id": "original", "title": "पुरानी कथा", "text": "राजा भोज"}
    assert from_dict(old).pronunciation_glossary == []


class SimulatedEngine:
    sample_rate = 24000

    def __init__(self) -> None:
        self.calls: list[str] = []

    def load(self) -> None:
        pass

    def generate(self, text: str, settings: object) -> np.ndarray:
        self.calls.append(text)
        return np.full(1200, 0.2, dtype=np.float32)


def test_only_changed_effective_text_invalidates_segment_cache(tmp_path: Path) -> None:
    doc = parse_dialogue("कथा", "Narrator: राजा भोज।\nNarrator: मंत्री जी।", [narrator()])
    engine = SimulatedEngine()
    render_story(doc, tmp_path / "first.wav", tmp_path / "cache", engine)
    assert len(engine.calls) == 2
    doc.pronunciation_glossary = [rule("राजा भोज", "रजा भोज")]
    next_engine = SimulatedEngine()
    report = render_story(doc, tmp_path / "second.wav", tmp_path / "cache", next_engine)
    assert next_engine.calls == ["रजा भोज।"]
    assert [item["cached"] for item in report["segments"]] == [False, True]
    doc.pronunciation_glossary[0].enabled = False
    restored = SimulatedEngine()
    report = render_story(doc, tmp_path / "third.wav", tmp_path / "cache", restored)
    assert restored.calls == []
    assert all(item["cached"] for item in report["segments"])


def test_corrupt_and_wrong_format_cached_wav_is_not_reused(tmp_path: Path) -> None:
    doc = parse_dialogue("कथा", "Narrator: नमस्ते।", [narrator()])
    render_story(doc, tmp_path / "a.wav", tmp_path / "cache", SimulatedEngine())
    wav = next((tmp_path / "cache").glob("*.wav"))
    wav.write_bytes(b"fake WAV data")
    recovered = SimulatedEngine()
    render_story(doc, tmp_path / "b.wav", tmp_path / "cache", recovered)
    assert recovered.calls == ["नमस्ते।"]


def test_real_selected_segment_job_does_not_render_neighbors(tmp_path: Path) -> None:
    doc = parse_dialogue("कथा", "Narrator: पहला।\nNarrator: दूसरा।", [narrator()])
    ids = [seg.id for seg in doc.scenes[0].segments]
    engine = SimulatedEngine()
    report = render_story(
        doc, tmp_path / "single.wav", tmp_path / "cache", engine,
        selected_scene_ids={doc.scenes[0].id}, selected_segment_ids={ids[1]},
        force_segment_ids={ids[1]},
    )
    assert engine.calls == ["दूसरा।"]
    assert [entry["segment_id"] for entry in report["segments"]] == [ids[1]]
    with pytest.raises(ValueError, match="does not belong"):
        render_story(doc, tmp_path / "bad.wav", tmp_path / "cache", SimulatedEngine(),
                     selected_segment_ids={"unknown"})
