"""Reviewed, deterministic text overrides for Hindi TTS, never phoneme/SSML claims.

Rules are project-local. Changes are applied exactly once, without recursively
processing replacement text. Normalized effective speech is the cache input.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any

from .hindi import normalize_hindi

MAX_RULES = 100
MAX_SPOKEN_LENGTH = 100_000
_DISALLOWED = re.compile(r"[\x00-\x1f\x7f]")


@dataclass
class PronunciationRule:
    id: str
    original: str
    spoken: str
    enabled: bool = True

    def validate(self) -> None:
        if not isinstance(self.id, str) or not 1 <= len(self.id) <= 80 or _DISALLOWED.search(self.id):
            raise ValueError("Pronunciation rule ID must have 1–80 printable characters.")
        if not isinstance(self.original, str) or not isinstance(self.spoken, str):
            raise ValueError("Pronunciation terms must be text.")
        if not isinstance(self.enabled, bool):
            raise ValueError("Pronunciation rule enabled must be boolean.")
        for value, limit in ((self.original, 80), (self.spoken, 160)):
            if not value.strip() or len(value) > limit or _DISALLOWED.search(value):
                raise ValueError("Pronunciation terms must be nonempty single-line text within limits.")
        if normalize_hindi(self.original) == normalize_hindi(self.spoken):
            raise ValueError("Pronunciation replacement must differ from original.")


def validate_glossary(rules: list[PronunciationRule]) -> None:
    if not isinstance(rules, list) or len(rules) > MAX_RULES:
        raise ValueError("Pronunciation glossary must contain at most 100 rules.")
    ids: set[str] = set()
    originals: set[str] = set()
    for rule in rules:
        if not isinstance(rule, PronunciationRule):
            raise ValueError("Invalid pronunciation rule.")
        rule.validate()
        source = normalize_hindi(rule.original).casefold()
        if rule.id in ids or source in originals:
            raise ValueError("Pronunciation rule identifiers and original terms must be unique.")
        ids.add(rule.id)
        originals.add(source)


def glossary_from_dict(items: Any) -> list[PronunciationRule]:
    if not isinstance(items, list) or len(items) > MAX_RULES:
        raise ValueError("Expected an array of at most 100 pronunciation rules.")
    rules = []
    for item in items:
        if not isinstance(item, dict) or set(item) != {"id", "original", "spoken", "enabled"}:
            raise ValueError("Pronunciation rules require id, original, spoken and enabled.")
        rules.append(PronunciationRule(**item))
    validate_glossary(rules)
    return rules


def _word_part(char: str) -> bool:
    """Include Devanagari combining signs, nukta, virama, joiners and letters."""
    return char in ("\u200c", "\u200d") or unicodedata.category(char)[0] in "LMN"


def apply_glossary(text: str, rules: list[PronunciationRule]) -> dict[str, Any]:
    """Return effective normalized synthesis text and inspectable substitutions.

    Only whole Unicode words/phrases match. A single regex search over escaped
    literals avoids arbitrary user-supplied regular expressions.
    """
    validate_glossary(rules)
    normalized = normalize_hindi(text)
    if len(normalized) > MAX_SPOKEN_LENGTH:
        raise ValueError("Spoken text exceeds the review limit.")
    active = [rule for rule in rules if rule.enabled]
    if not active:
        return {"text": normalized, "changes": []}
    ordered = sorted(active, key=lambda item: (-len(normalize_hindi(item.original)), item.id))
    terms = {normalize_hindi(item.original).casefold(): item for item in ordered}
    pattern = re.compile("|".join(re.escape(normalize_hindi(item.original)) for item in ordered), re.IGNORECASE)
    changes: list[dict[str, str]] = []
    parts: list[str] = []
    position = 0
    for match in pattern.finditer(normalized):
        start, end = match.span()
        if (start > 0 and _word_part(normalized[start - 1])) or (
            end < len(normalized) and _word_part(normalized[end])
        ):
            continue
        rule = terms[match.group().casefold()]
        parts.append(normalized[position:start])
        spoken = normalize_hindi(rule.spoken)
        parts.append(spoken)
        changes.append({"rule_id": rule.id, "original": match.group(), "spoken": spoken})
        position = end
    parts.append(normalized[position:])
    effective = "".join(parts)
    if len(effective) > MAX_SPOKEN_LENGTH:
        raise ValueError("Pronunciation output exceeds the 100000-character limit.")
    return {"text": effective, "changes": changes}
