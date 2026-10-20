"""Versioned, model-independent character and scene contracts.

Speech engines must not invent speaker conditioning or pitch features.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import math
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any

from .pronunciation import PronunciationRule, glossary_from_dict, validate_glossary

SCHEMA_VERSION = 2
ENGINE_ID = "chatterbox-multilingual"
NARRATOR_ID = "narrator"
VALID_TYPES = frozenset({"speech", "direction"})
MAX_SCENES = 200
MAX_CHARACTERS = 100
MAX_SEGMENTS = 2000


def _name(value: str, label: str, limit: int = 120) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f"{label} must contain 1–{limit} characters.")
    if "\x00" in value:
        raise ValueError(f"{label} contains invalid characters.")
    return value.strip()


@dataclass
class VoiceProfile:
    engine_id: str = ENGINE_ID
    model_id: str = "chatterbox-multilingual"
    language: str = "hi"
    exaggeration: float = 0.5
    cfg_weight: float = 0.5
    pause_ms: int = 140
    profile_version: int = 1
    # No speaker-reference or per-character voice identity is claimed by v0.2.0.
    speaker_conditioning: str | None = None

    def validate(self) -> None:
        if self.engine_id != ENGINE_ID or self.language != "hi":
            raise ValueError("Only Chatterbox Multilingual Hindi is configured.")
        _name(self.model_id, "Model ID", 160)
        if self.profile_version != 1:
            raise ValueError("Unsupported voice profile version.")
        if self.speaker_conditioning is not None:
            raise ValueError("Speaker conditioning has not been verified for this engine.")
        if not isinstance(self.exaggeration, (int, float)) or not math.isfinite(
            self.exaggeration
        ) or not 0.25 <= self.exaggeration <= 2:
            raise ValueError("Invalid expressiveness parameter.")
        if not isinstance(self.cfg_weight, (int, float)) or not math.isfinite(
            self.cfg_weight
        ) or not 0 <= self.cfg_weight <= 1:
            raise ValueError("Invalid CFG guidance parameter.")
        if type(self.pause_ms) is not int or not 0 <= self.pause_ms <= 2000:
            raise ValueError("Pause duration must be 0–2000 milliseconds.")


@dataclass
class Character:
    id: str
    name: str
    voice: VoiceProfile = field(default_factory=VoiceProfile)
    description: str = ""

    def validate(self) -> None:
        _name(self.id, "Character ID", 80)
        _name(self.name, "Character name")
        if len(self.description) > 1000:
            raise ValueError("Character description is too long.")
        self.voice.validate()


@dataclass
class Segment:
    id: str
    original_text: str
    spoken_text: str
    speaker_id: str | None
    kind: str = "speech"
    status: str = "pending"
    audio_ref: str | None = None
    duration_seconds: float | None = None
    source_label: str | None = None

    def validate(self, speakers: set[str]) -> None:
        _name(self.id, "Segment ID", 80)
        if self.kind not in VALID_TYPES:
            raise ValueError("Unknown segment type.")
        if len(self.original_text) > 100_000 or len(self.spoken_text) > 100_000:
            raise ValueError("Segment text too long.")
        if self.kind == "speech" and not self.spoken_text.strip():
            raise ValueError("Spoken segment cannot be blank.")
        if self.speaker_id is not None and self.speaker_id not in speakers:
            raise ValueError("Segment references unknown speaker.")
        if self.kind == "speech" and self.speaker_id is None and not self.source_label:
            raise ValueError("Speech needs a speaker or unresolved source label.")
        if self.audio_ref is not None:
            uuid.UUID(self.audio_ref)
        if self.duration_seconds is not None and (
            not math.isfinite(self.duration_seconds) or self.duration_seconds < 0
        ):
            raise ValueError("Invalid measured duration.")


@dataclass
class Scene:
    id: str
    title: str
    segments: list[Segment] = field(default_factory=list)
    notes: str = ""

    def validate(self, speakers: set[str]) -> None:
        _name(self.id, "Scene ID", 80)
        _name(self.title, "Scene title")
        if len(self.notes) > 4000 or len(self.segments) > MAX_SEGMENTS:
            raise ValueError("Scene metadata or segment count exceeds limits.")
        for segment in self.segments:
            segment.validate(speakers)


@dataclass
class StoryDocument:
    id: str
    title: str
    text: str
    characters: list[Character]
    scenes: list[Scene]
    schema_version: int = SCHEMA_VERSION
    pronunciation_glossary: list[PronunciationRule] = field(default_factory=list)

    def validate(self) -> None:
        if self.schema_version != SCHEMA_VERSION:
            raise ValueError("Unsupported story schema.")
        validate_glossary(self.pronunciation_glossary)
        _name(self.id, "Document ID", 80)
        _name(self.title, "Story title")
        if len(self.text) > 100_000:
            raise ValueError("Story source exceeds the project text limit.")
        if not 1 <= len(self.characters) <= MAX_CHARACTERS:
            raise ValueError("Story must have 1–100 characters.")
        if len(self.scenes) > MAX_SCENES:
            raise ValueError("Too many scenes.")
        for char in self.characters:
            char.validate()
        ids = [char.id for char in self.characters]
        if len(ids) != len(set(ids)) or NARRATOR_ID not in ids:
            raise ValueError("Character IDs must be unique and include narrator.")
        folded = [char.name.casefold() for char in self.characters]
        if len(folded) != len(set(folded)):
            raise ValueError("Character names must be unambiguous.")
        scene_ids = [scene.id for scene in self.scenes]
        if len(set(scene_ids)) != len(scene_ids):
            raise ValueError("Scene IDs must be unique.")
        segment_ids: set[str] = set()
        for scene in self.scenes:
            scene.validate(set(ids))
            for segment in scene.segments:
                if segment.id in segment_ids:
                    raise ValueError("Segment IDs must be unique across scenes.")
                segment_ids.add(segment.id)

    def to_dict(self) -> dict[str, Any]:
        self.validate()
        return asdict(self)


def narrator() -> Character:
    return Character(id=NARRATOR_ID, name="Narrator")


def new_story(title: str, text: str = "") -> StoryDocument:
    doc = StoryDocument(
        id=str(uuid.uuid4()), title=title, text=text, characters=[narrator()], scenes=[]
    )
    doc.validate()
    return doc


def migrate_legacy(project: dict[str, Any]) -> dict[str, Any]:
    """Upgrade a v0.1.x project without modifying the source project file."""
    if project.get("schema_version") == SCHEMA_VERSION:
        return project
    if "schema_version" in project:
        raise ValueError("Unknown schema version; no migration attempted.")
    if set(project) != {"id", "title", "text"}:
        raise ValueError("Not a recognized v0.1.x story.")
    _name(project["id"], "Document ID", 80)
    _name(project["title"], "Story title")
    if not isinstance(project["text"], str) or len(project["text"]) > 100_000:
        raise ValueError("Invalid legacy story text.")
    return {
        "schema_version": SCHEMA_VERSION,
        "id": project["id"],
        "title": project["title"],
        "text": project["text"],
        "characters": [asdict(narrator())],
        "scenes": [],
        "pronunciation_glossary": [],
    }


def from_dict(payload: dict[str, Any]) -> StoryDocument:
    """Deserialize and validate; never silently rewrite the user's source text."""
    migrated = migrate_legacy(payload)
    chars = [
        Character(
            id=item["id"], name=item["name"],
            voice=VoiceProfile(**item.get("voice", {})),
            description=item.get("description", ""),
        )
        for item in migrated["characters"]
    ]
    scenes = [
        Scene(
            id=item["id"], title=item["title"], notes=item.get("notes", ""),
            segments=[Segment(**segment) for segment in item.get("segments", [])],
        )
        for item in migrated["scenes"]
    ]
    doc = StoryDocument(
        id=migrated["id"], title=migrated["title"], text=migrated["text"],
        characters=chars, scenes=scenes, schema_version=migrated["schema_version"],
        pronunciation_glossary=glossary_from_dict(migrated.get("pronunciation_glossary", [])),
    )
    doc.validate()
    return doc
