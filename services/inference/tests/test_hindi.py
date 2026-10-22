"""Hindi normalization tests — no model downloads."""
import itertools
import unicodedata

import pytest

from kathasvara.hindi import normalize_hindi, split_for_engine, validate_story


@pytest.mark.parametrize("text", [
    "राजा भोज",
    "महाराज विक्रमादित्य",
    "नमस्कार, मित्रों!",
    "यह कहानी सन् १०१० की है।",
    "कुल राशि ₹५०० थी।",
    "क्या आप मेरी बात सुन रहे हैं?",
    "सांझ ढल चुकी थी, लेकिन कहानी अभी बाकी थी।",
])
def test_preserves_meaning_and_unicode(text: str) -> None:
    assert validate_story(text) == text


def test_spaces_and_newlines() -> None:
    assert normalize_hindi(" नमस्कार  मित्रों!\r\nराजा\tभोज ") == "नमस्कार मित्रों!\nराजा भोज"


def test_empty_rejected() -> None:
    with pytest.raises(ValueError, match="Enter Hindi"):
        validate_story(" \n ")


def test_too_long_rejected() -> None:
    with pytest.raises(ValueError, match="exceeds"):
        validate_story("अ" * 3001)


def test_chunks_respect_limit_and_preserve_words() -> None:
    original = "राजा भोज ने कहा। " * 65
    chunks = split_for_engine(normalize_hindi(original), limit=80)
    assert chunks
    assert all(len(c) <= 80 for c in chunks)
    assert " ".join(chunks) == normalize_hindi(original)


def test_no_silent_truncation_of_long_token() -> None:
    text = "अ" * 299
    chunks = split_for_engine(text)
    assert "".join(chunks) == text


@pytest.mark.parametrize("token", [
    "किं" * 103,                # Vowel signs and anusvara
    "क्ष" * 101,                # Virama + consonant conjunct
    "क्\u200dष" * 101,         # Explicit zero-width joiner
    "क्\u200cष" * 101,         # Explicit zero-width non-joiner
    "क़" * 151,                # Nukta
    "🏵️" * 141,               # Variation-selector marks
])
def test_long_unicode_token_keeps_writing_units_intact(token: str) -> None:
    chunks = split_for_engine(token)
    assert len(chunks) >= 2
    assert all(0 < len(chunk) <= 280 for chunk in chunks)
    assert "".join(chunks) == token
    for left, right in itertools.pairwise(chunks):
        assert not unicodedata.category(right[0]).startswith("M")
        assert right[0] not in {"\u200c", "\u200d"}
        assert left[-1] not in {"\u094d", "\u200c", "\u200d"}


def test_hindi_mark_at_exact_engine_boundary_moves_with_base() -> None:
    # Previous numeric slicing created a trailing base and leading vowel sign.
    token = "अ" * 279 + "कि" + "अ" * 40
    chunks = split_for_engine(token)
    assert chunks[0] == "अ" * 279
    assert chunks[1].startswith("कि")
    assert "".join(chunks) == token


def test_boundary_guard_does_not_modify_ascii_long_words() -> None:
    word = "a" * 300
    assert split_for_engine(word) == ["a" * 280, "a" * 20]


def test_reject_oversized_unsplittable_written_unit() -> None:
    # Never cut a 281-mark written unit merely to satisfy the chunk cap.
    word = "क" + "\u093c" * 280 + "अ"
    with pytest.raises(ValueError, match="written Hindi character exceeds"):
        split_for_engine(word)
