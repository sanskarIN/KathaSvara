"""Conservative, inspectable Hindi normalization and chunking.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import re
import unicodedata

MAX_STORY_LENGTH = 3000
MAX_CHUNK_LENGTH = 280
# Joiners and virama bind adjacent Indic characters into one written unit.
_JOINERS = frozenset({"\u200c", "\u200d"})
_DEVANAGARI_VIRAMA = "\u094d"


def normalize_hindi(text: str) -> str:
    """Normalize Unicode and whitespace without rewriting words or amounts."""
    if not isinstance(text, str):
        raise TypeError("Story text must be a string.")
    normalized = unicodedata.normalize(
        "NFC", text.replace("\r\n", "\n").replace("\r", "\n")
    )
    return "\n".join(
        re.sub(r"[ \t]+", " ", line).strip()
        for line in normalized.split("\n")
    ).strip()


def validate_story(text: str) -> str:
    """Reject empty or excessively large jobs before loading a model."""
    normalized = normalize_hindi(text)
    if not normalized:
        raise ValueError("Enter Hindi story text before generating.")
    if len(normalized) > MAX_STORY_LENGTH:
        raise ValueError(f"Story exceeds {MAX_STORY_LENGTH} characters; split it into scenes.")
    if "\x00" in normalized:
        raise ValueError("Story contains a NUL character.")
    return normalized



def _continues_devanagari_cluster(word: str, at: int) -> bool:
    """Whether a break before this index would separate a Hindi written unit.

    This conservative boundary guard is not a general Unicode grapheme
    segmenter. It covers combining marks, spacing vowel signs, Devanagari
    virama/conjuncts, and explicit Indic zero-width joiners/non-joiners.
    """
    if at <= 0 or at >= len(word):
        return False
    following = word[at]
    preceding = word[at - 1]
    return (
        unicodedata.category(following).startswith("M")
        or following in _JOINERS
        or preceding in _JOINERS
        or preceding == _DEVANAGARI_VIRAMA
    )


def _split_long_word(word: str, limit: int) -> list[str]:
    """Split long unspaced words without tearing Devanagari clusters apart."""
    pieces: list[str] = []
    start = 0
    while start < len(word):
        end = min(start + limit, len(word))
        if end < len(word):
            while end > start and _continues_devanagari_cluster(word, end):
                end -= 1
            if end == start:
                raise ValueError("A written Hindi character exceeds the speech chunk limit.")
        pieces.append(word[start:end])
        start = end
    return pieces

def split_for_engine(text: str, limit: int = MAX_CHUNK_LENGTH) -> list[str]:
    """Split on sentence/word boundaries; never silently truncate content."""
    if limit < 20:
        raise ValueError("Chunk limit must be at least 20.")
    paragraphs = [p.strip() for p in text.splitlines() if p.strip()]
    chunks: list[str] = []
    current = ""

    def add_piece(piece: str) -> None:
        nonlocal current
        for word in piece.split():
            if len(word) > limit:
                if current:
                    chunks.append(current)
                    current = ""
                chunks.extend(_split_long_word(word, limit))
                continue
            combined = f"{current} {word}".strip()
            if len(combined) > limit:
                if current:
                    chunks.append(current)
                current = word
            else:
                current = combined

    for paragraph in paragraphs:
        sentences = re.split(r"(?<=[।.!?])\s+", paragraph)
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
            candidate = f"{current} {sentence}".strip()
            if len(candidate) <= limit:
                current = candidate
            else:
                if current:
                    chunks.append(current)
                    current = ""
                add_piece(sentence)
        if current:
            chunks.append(current)
            current = ""
    return [chunk for chunk in chunks if chunk]
