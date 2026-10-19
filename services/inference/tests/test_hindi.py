"""Hindi normalization tests — no model downloads."""
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
