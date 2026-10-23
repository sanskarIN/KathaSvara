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


def safe_error_type(error_type: type[BaseException] | None) -> str | None:
    """Return a fixed diagnostic category, never a user-controlled class name.

    Exception names from dynamic/custom classes could otherwise embed sensitive
    story text, paths or model details in a locally persisted recovery journal.
    """
    if error_type is None:
        return None
    if error_type.__name__ == "RenderCancelled":
        return "RenderCancelled"
    for category in (
        PermissionError, FileNotFoundError, MemoryError,
        OSError, ValueError, RuntimeError,
    ):
        if issubclass(error_type, category):
            return category.__name__
    return "OtherError"


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

    def _commit(self, next_document: dict[str, Any]) -> None:
        """Only retain in-memory progress after the next journal is published.

        If the atomic filesystem replacement fails, a later terminal-state
        write must not accidentally report a segment that was never journaled.
        """
        previous = self.document
        self.document = next_document
        try:
            self._persist()
        except BaseException:
            self.document = previous
            raise

    def record(self, segment: dict[str, Any]) -> None:
        if self.document["state"] != "running":
            raise RuntimeError("Cannot extend a completed render journal.")
        if self.document["done"] >= self.document["total"]:
            raise RuntimeError("Cannot record more segments than the render plan.")
        # Construct the next snapshot before publishing it. Neither the
        # original list nor its counters change on a failed disk write.
        self._commit({
            **self.document,
            "segments": [*self.document["segments"], {
                "segment_id": segment["segment_id"],
                "speaker_id": segment["speaker_id"],
                "cache_key": segment["cache_key"],
                "cached": segment["cached"],
                "duration_seconds": segment["duration_seconds"],
            }],
            "done": self.document["done"] + 1,
        })

    def __exit__(
        self, error_type: type[BaseException] | None, error: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        if error_type is None and self.document["done"] == self.document["total"]:
            state = "completed"
            failure = None
        elif error_type is None:
            # It is never correct to publish completed when fewer lines were
            # durably recorded than promised by the render plan.
            state = "failed"
            failure = "IncompleteRender"
        elif error_type.__name__ == "RenderCancelled":
            state = "cancelled"
            failure = "RenderCancelled"
        else:
            state = "failed"
            failure = safe_error_type(error_type)
        self._commit({**self.document, "state": state, "error_type": failure})
