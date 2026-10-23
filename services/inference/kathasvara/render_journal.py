"""Atomic, privacy-minimal journal for recoverable offline story rendering.

Journals contain identifiers, completion counts, cache fingerprints and measured
durations, never the source story, speech text or local file system paths.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import UTC, datetime
from pathlib import Path
from types import TracebackType
from typing import Any, Self


class RenderJournal:
    def __init__(self, path: Path, story_id: str, total: int):
        if not path.is_absolute() or path.suffix != ".json":
            raise ValueError("Render journal must be a new absolute .json path.")
        if not 1 <= total <= 256:
            raise ValueError("Invalid render journal segment count.")
        self.path = path
        self.document = {
            "schema_version": 1,
            "story_id": story_id,
            "state": "running",
            "done": 0,
            "total": total,
            "segments": [],
            "error_type": None,
            "updated_at": "",
        }

    def _persist(self, *, initial: bool = False) -> None:
        self.document["updated_at"] = datetime.now(UTC).isoformat()
        content = json.dumps(self.document, ensure_ascii=False, separators=(",", ":"))
        temp = self.path.with_name(f"{self.path.stem}-{uuid.uuid4().hex}.partial.json")
        try:
            with temp.open("x", encoding="utf-8") as stream:
                stream.write(content)
                stream.flush()
            if initial:
                # An existence check before temp.replace is not sufficient:
                # a different worker could create a journal at this path in
                # between. The same-filesystem hard link is atomic and refuses
                # to overwrite any new file, including an existing symlink.
                try:
                    os.link(temp, self.path)
                except FileExistsError as exc:
                    raise ValueError("Render journal already exists.") from exc
            else:
                temp.replace(self.path)
        finally:
            temp.unlink(missing_ok=True)

    def __enter__(self) -> Self:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists() or self.path.is_symlink():
            raise ValueError("Render journal already exists.")
        self._persist(initial=True)
        return self

    def record(self, segment: dict[str, Any]) -> None:
        if self.document["state"] != "running":
            raise RuntimeError("Cannot extend a completed render journal.")
        self.document["segments"].append({
            "segment_id": segment["segment_id"],
            "speaker_id": segment["speaker_id"],
            "cache_key": segment["cache_key"],
            "cached": segment["cached"],
            "duration_seconds": segment["duration_seconds"],
        })
        self.document["done"] += 1
        self._persist()

    def __exit__(
        self, error_type: type[BaseException] | None, error: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        if error_type is None:
            self.document["state"] = "completed"
        elif error_type.__name__ == "RenderCancelled":
            self.document["state"] = "cancelled"
        else:
            self.document["state"] = "failed"
        self.document["error_type"] = error_type.__name__ if error_type else None
        self._persist()
