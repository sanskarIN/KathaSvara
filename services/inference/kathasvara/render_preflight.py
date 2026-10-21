"""Model-free, read-only speech preparation shared by preflight and synthesis.

The public inspection report exposes only aggregate counts. Prepared speech
contains private text in process memory and is never journaled or exported by
preflight. No weights, NumPy, or model inference are required.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from dataclasses import dataclass

from .hindi import split_for_engine
from .pronunciation import apply_glossary
from .story import Character, Segment, StoryDocument

MAX_RENDER_SEGMENTS = 256
MAX_RENDER_CHARACTERS = 100_000
MAX_CHUNKS = 500


@dataclass(frozen=True)
class PreparedSpeech:
    segment: Segment
    character: Character
    effective_text: str
    chunks: tuple[str, ...]


@dataclass(frozen=True)
class PreparedRender:
    lines: tuple[PreparedSpeech, ...]
    source_characters: int
    spoken_characters: int
    chunk_count: int
    forced_segments: int

    def counts_only(self) -> dict[str, int | bool]:
        """Never reveal prepared speech, speaker identities or cache material."""
        return {
            "segments": len(self.lines),
            "source_characters": self.source_characters,
            "spoken_characters": self.spoken_characters,
            "chunks": self.chunk_count,
            "forced_segments": self.forced_segments,
            "model_loaded": False,
            "duration_known": False,
            "distinct_voices_verified": False,
        }


def prepare_render_plan(
    doc: StoryDocument, *,
    selected_scene_ids: set[str] | None = None,
    selected_segment_ids: set[str] | None = None,
    force_segment_ids: set[str] | None = None,
) -> PreparedRender:
    """Validate selection and snapshot exactly the text/chunks used by synthesis.

    No I/O and no audio libraries. A plan cannot infer actual audio length,
    naturalness or the model's available speaker identities.
    """
    doc.validate()
    available_scenes = {scene.id for scene in doc.scenes}
    if selected_scene_ids is not None and not selected_scene_ids.issubset(available_scenes):
        raise ValueError("Requested scene does not belong to the story.")
    available_lines = {
        segment.id
        for scene in doc.scenes for segment in scene.segments
        if segment.kind == "speech"
    }
    if selected_segment_ids is not None and not selected_segment_ids.issubset(available_lines):
        raise ValueError("Requested dialogue segment does not belong to this story.")

    selected = [
        segment
        for scene in doc.scenes
        if selected_scene_ids is None or scene.id in selected_scene_ids
        for segment in scene.segments
        if segment.kind == "speech" and (
            selected_segment_ids is None or segment.id in selected_segment_ids
        )
    ]
    selected_ids = {segment.id for segment in selected}
    if selected_segment_ids is not None and not selected_segment_ids.issubset(selected_ids):
        raise ValueError("Selected dialogue is outside the chosen scenes.")
    if force_segment_ids is not None and not force_segment_ids.issubset(selected_ids):
        raise ValueError("Forced regeneration must target selected spoken segments.")
    if not 1 <= len(selected) <= MAX_RENDER_SEGMENTS:
        raise ValueError("A render needs 1–256 spoken segments.")
    if any(segment.speaker_id is None for segment in selected):
        raise ValueError("Assign every unknown speaker manually before rendering.")

    source_count = sum(len(segment.spoken_text) for segment in selected)
    if source_count > MAX_RENDER_CHARACTERS:
        raise ValueError("A render exceeds the 100000-character limit.")
    speakers = {character.id: character for character in doc.characters}
    prepared: list[PreparedSpeech] = []
    chunk_count = 0
    spoken_count = 0
    for segment in selected:
        character = speakers.get(segment.speaker_id)
        if character is None:
            raise ValueError("Selected dialogue has an unknown character.")
        character.voice.validate()
        effective = apply_glossary(
            segment.spoken_text, doc.pronunciation_glossary,
        )["text"]
        if not effective:
            raise ValueError("Spoken dialogue cannot be empty.")
        chunks = tuple(split_for_engine(effective))
        if not chunks or len(chunks) > 40:
            raise ValueError("Segment requires too many speech chunks.")
        spoken_count += len(effective)
        if spoken_count > MAX_RENDER_CHARACTERS:
            raise ValueError("Pronunciation replacements exceed the 100000-character limit.")
        chunk_count += len(chunks)
        if chunk_count > MAX_CHUNKS:
            raise ValueError("Too many speech chunks in one render.")
        prepared.append(PreparedSpeech(
            segment=segment, character=character, effective_text=effective,
            chunks=chunks,
        ))
    return PreparedRender(
        lines=tuple(prepared),
        source_characters=source_count,
        spoken_characters=spoken_count,
        chunk_count=chunk_count,
        forced_segments=len(force_segment_ids or set()),
    )


def inspect_render_plan(
    doc: StoryDocument, *,
    selected_scene_ids: set[str] | None = None,
    selected_segment_ids: set[str] | None = None,
    force_segment_ids: set[str] | None = None,
) -> dict[str, int | bool]:
    """Public model-free JSON report: aggregate counts, never source text."""
    plan = prepare_render_plan(
        doc, selected_scene_ids=selected_scene_ids,
        selected_segment_ids=selected_segment_ids,
        force_segment_ids=force_segment_ids,
    )
    return plan.counts_only()
