"""Model-free, read-only preflight for narrated story selections.

This report contains counts only and does not claim any model audio duration,
speaker identity or speech quality. It does not write stories to disk.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from .hindi import split_for_engine
from .production import MAX_CHUNKS, MAX_RENDER_CHARACTERS, MAX_RENDER_SEGMENTS
from .pronunciation import apply_glossary
from .story import StoryDocument


def inspect_render_plan(
    doc: StoryDocument, *,
    selected_scene_ids: set[str] | None = None,
    selected_segment_ids: set[str] | None = None,
    force_segment_ids: set[str] | None = None,
) -> dict[str, int | bool]:
    """Check intended dialogue and chunk limits without importing audio/model libs."""
    doc.validate()
    available_scenes = {scene.id for scene in doc.scenes}
    if selected_scene_ids is not None and not selected_scene_ids.issubset(available_scenes):
        raise ValueError("Requested scene does not belong to the story.")
    available_lines = {
        seg.id for scene in doc.scenes for seg in scene.segments if seg.kind == "speech"
    }
    if selected_segment_ids is not None and not selected_segment_ids.issubset(available_lines):
        raise ValueError("Requested dialogue segment does not belong to this story.")

    selected = [
        seg for scene in doc.scenes
        if selected_scene_ids is None or scene.id in selected_scene_ids
        for seg in scene.segments
        if seg.kind == "speech" and (
            selected_segment_ids is None or seg.id in selected_segment_ids
        )
    ]
    ids = {seg.id for seg in selected}
    if selected_segment_ids is not None and not selected_segment_ids.issubset(ids):
        raise ValueError("Selected dialogue is outside the chosen scenes.")
    if force_segment_ids is not None and not force_segment_ids.issubset(ids):
        raise ValueError("Forced regeneration must target selected spoken segments.")
    if not 1 <= len(selected) <= MAX_RENDER_SEGMENTS:
        raise ValueError("A render needs 1–256 spoken segments.")
    if any(seg.speaker_id is None for seg in selected):
        raise ValueError("Assign every unknown speaker manually before rendering.")
    characters = {character.id: character for character in doc.characters}
    raw_characters = sum(len(seg.spoken_text) for seg in selected)
    if raw_characters > MAX_RENDER_CHARACTERS:
        raise ValueError("A render exceeds the 100000-character limit.")

    chunk_total = 0
    effective_characters = 0
    for seg in selected:
        character = characters.get(seg.speaker_id)
        if character is None:
            raise ValueError("Selected dialogue has an unknown character.")
        character.voice.validate()
        effective = apply_glossary(
            seg.spoken_text, doc.pronunciation_glossary,
        )["text"]
        if not effective:
            raise ValueError("Spoken dialogue cannot be empty.")
        chunks = split_for_engine(effective)
        if not chunks or len(chunks) > 40:
            raise ValueError("Segment requires too many speech chunks.")
        effective_characters += len(effective)
        chunk_total += len(chunks)
        if chunk_total > MAX_CHUNKS:
            raise ValueError("Too many speech chunks in one render.")
    if effective_characters > MAX_RENDER_CHARACTERS:
        raise ValueError("Pronunciation replacements exceed the 100000-character limit.")
    return {
        "segments": len(selected),
        "source_characters": raw_characters,
        "spoken_characters": effective_characters,
        "chunks": chunk_total,
        "forced_segments": len(force_segment_ids or set()),
        "model_loaded": False,
        "duration_known": False,
        "distinct_voices_verified": False,
    }
