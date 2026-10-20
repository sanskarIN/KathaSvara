"""Deterministic parser for *explicitly labeled* Hindi storytelling dialogue.

Never hallucinate speaker identity from ambiguous, unlabeled prose.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import re
import uuid

from .hindi import normalize_hindi
from .story import NARRATOR_ID, Character, Scene, Segment, StoryDocument

SPEAKER_LINE = re.compile(r"^\s*(?:\*\*)?(?P<label>[^:：\n]{1,100}?)(?:\*\*)?\s*[:：]\s*(?P<speech>.*)$")
SCENE_LINE = re.compile(r"^\s*(?:---+|#{1,3}\s+.+)\s*$")
DIRECTION_LINE = re.compile(r"^\s*(?:\[.+\]|\(.+\))\s*$")
MAX_SOURCE = 100_000


def parse_dialogue(
    title: str,
    text: str,
    characters: list[Character],
    script_id: str | None = None,
) -> StoryDocument:
    if not isinstance(text, str) or len(text) > MAX_SOURCE:
        raise ValueError("Story text must be a string of at most 100000 characters.")
    if not isinstance(characters, list) or not characters:
        raise ValueError("Create a narrator character first.")
    if script_id is None:
        script_id = str(uuid.uuid4())
    # Protect original text: speech normalization is a separate previewable field.
    available = {character.name.casefold(): character.id for character in characters}
    available["narrator"] = NARRATOR_ID
    available["वाचक"] = NARRATOR_ID
    available["कथावाचक"] = NARRATOR_ID

    scenes: list[Scene] = []
    segments: list[Segment] = []
    pending: list[str] = []
    current_speaker: str | None = NARRATOR_ID
    current_label: str | None = None
    current_kind = "speech"
    title_for_scene = "Scene 1"

    def add_segment() -> None:
        nonlocal pending
        if not pending:
            return
        original = "\n".join(pending)
        spoken = "" if current_kind == "direction" else normalize_hindi(original)
        if spoken or original.strip():
            segment_id = str(uuid.uuid5(
                uuid.NAMESPACE_URL, f"kathasvara:{script_id}:{len(scenes)}:{len(segments)}"
            ))
            segments.append(Segment(
                id=segment_id,
                original_text=original,
                spoken_text=spoken,
                kind=current_kind,
                speaker_id=current_speaker if current_kind == "speech" else None,
                source_label=current_label,
            ))
        pending = []

    def add_scene() -> None:
        nonlocal segments
        add_segment()
        if segments:
            scene_id = str(uuid.uuid5(
                uuid.NAMESPACE_URL, f"kathasvara:{script_id}:scene:{len(scenes)}"
            ))
            scenes.append(Scene(id=scene_id, title=title_for_scene, segments=segments))
            segments = []

    previous_line_blank = False
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw.strip()
        if SCENE_LINE.fullmatch(line):
            add_scene()
            title_for_scene = (
                line.lstrip("#").strip() if line.startswith("#") else f"Scene {len(scenes) + 1}"
            )
            current_speaker, current_label, current_kind = NARRATOR_ID, None, "speech"
            previous_line_blank = True
            continue
        if not line:
            add_segment()
            current_speaker, current_label, current_kind = NARRATOR_ID, None, "speech"
            previous_line_blank = True
            continue
        if DIRECTION_LINE.fullmatch(line):
            add_segment()
            current_speaker, current_label, current_kind = None, None, "direction"
            pending = [raw]
            add_segment()
            current_speaker, current_kind = NARRATOR_ID, "speech"
            previous_line_blank = False
            continue
        match = SPEAKER_LINE.fullmatch(raw)
        if match:
            label = match.group("label").replace("*", "").strip()
            # A clock time or numeric ratio is not a character.
            if label and any(ch.isalpha() for ch in label):
                add_segment()
                speaker = available.get(label.casefold())
                current_speaker = speaker
                current_label = None if speaker is not None else label
                current_kind = "speech"
                if match.group("speech").strip():
                    pending = [match.group("speech")]
                previous_line_blank = False
                continue
        if previous_line_blank:
            current_speaker, current_label, current_kind = NARRATOR_ID, None, "speech"
        pending.append(raw)
        previous_line_blank = False

    add_scene()
    doc = StoryDocument(
        id=script_id, title=title, text=text, characters=characters, scenes=scenes
    )
    doc.validate()
    return doc


def unresolved_labels(document: StoryDocument) -> list[str]:
    """Return unique labels requiring manual character assignment."""
    return sorted({
        segment.source_label
        for scene in document.scenes
        for segment in scene.segments
        if segment.kind == "speech" and segment.speaker_id is None and segment.source_label
    })


def assign_speaker(document: StoryDocument, segment_id: str, speaker_id: str) -> None:
    """Correct uncertain dialogue explicitly; never guess."""
    if speaker_id not in {character.id for character in document.characters}:
        raise ValueError("Speaker must be a known character.")
    for scene in document.scenes:
        for segment in scene.segments:
            if segment.id == segment_id and segment.kind == "speech":
                segment.speaker_id = speaker_id
                segment.source_label = None
                segment.status = "pending"
                segment.audio_ref = None
                segment.duration_seconds = None
                document.validate()
                return
    raise ValueError("Speech segment not found.")
