"""Atomic first-write behavior for privacy-minimal rendering journals.

No Chatterbox checkpoints or sound hardware required.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from kathasvara import render_journal
from kathasvara.render_journal import RenderJournal


def test_journal_still_records_progress_and_completion(tmp_path: Path) -> None:
    destination = tmp_path / "jobs" / "progress.json"
    with RenderJournal(destination, "example-story", 1) as journal:
        initial = json.loads(destination.read_text(encoding="utf-8"))
        assert initial["state"] == "running"
        assert initial["done"] == 0
        journal.record({
            "segment_id": "line-1",
            "speaker_id": "narrator",
            "cache_key": "a" * 64,
            "cached": False,
            "duration_seconds": 0.2,
        })
        intermediate = json.loads(destination.read_text(encoding="utf-8"))
        assert intermediate["done"] == 1
        assert intermediate["state"] == "running"
    complete = json.loads(destination.read_text(encoding="utf-8"))
    assert complete["state"] == "completed"
    assert complete["done"] == 1
    assert complete["segments"][0]["cache_key"] == "a" * 64
    assert list(destination.parent.glob("*.partial.json")) == []


def test_racing_other_worker_journal_is_never_overwritten(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    destination = tmp_path / "jobs" / "raced.json"
    original_link = os.link

    def competitor_creates_destination(source: Path, target: Path) -> None:
        assert target == destination
        destination.write_text("other worker's journal", encoding="utf-8")
        original_link(source, target)

    monkeypatch.setattr(render_journal.os, "link", competitor_creates_destination)
    with pytest.raises(ValueError, match="already exists"), RenderJournal(destination, "example-story", 1):
        pytest.fail("Concurrent journal creation was allowed")
    assert destination.read_text(encoding="utf-8") == "other worker's journal"
    assert list(destination.parent.glob("*.partial.json")) == []


def test_symlink_swap_during_first_write_does_not_touch_target(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    destination = tmp_path / "jobs" / "raced.json"
    outside = tmp_path / "private.json"
    outside.write_text("KEEP", encoding="utf-8")
    original_link = os.link

    def competitor_creates_alias(source: Path, target: Path) -> None:
        assert target == destination
        try:
            destination.symlink_to(outside)
        except (OSError, NotImplementedError):
            pytest.skip("Cannot create symlink in this environment")
        original_link(source, target)

    monkeypatch.setattr(render_journal.os, "link", competitor_creates_alias)
    with pytest.raises(ValueError, match="already exists"), RenderJournal(destination, "example-story", 1):
        pytest.fail("Concurrent journal symlink was followed")
    assert destination.is_symlink()
    assert outside.read_text(encoding="utf-8") == "KEEP"
    assert list(destination.parent.glob("*.partial.json")) == []


def test_initial_publication_never_falls_back_to_overwriting_on_link_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    destination = tmp_path / "jobs" / "progress.json"

    def unsupported_hardlinks(_source: Path, _target: Path) -> None:
        raise PermissionError("simulated link restriction")

    monkeypatch.setattr(render_journal.os, "link", unsupported_hardlinks)
    with pytest.raises(PermissionError, match="link restriction"), RenderJournal(destination, "example-story", 1):
        pytest.fail("Journal initialized without exclusive publication")
    assert not destination.exists()
    assert list(destination.parent.glob("*.partial.json")) == []
