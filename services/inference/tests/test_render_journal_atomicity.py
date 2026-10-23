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


def _segment(identifier: str) -> dict[str, object]:
    return {
        "segment_id": identifier,
        "speaker_id": "narrator",
        "cache_key": "a" * 64,
        "cached": False,
        "duration_seconds": 0.2,
    }


def test_failed_progress_write_does_not_leak_uncommitted_segment_to_terminal_journal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    destination = tmp_path / "jobs" / "progress.json"
    with RenderJournal(destination, "story", 2) as journal:
        journal.record(_segment("first"))
        original = journal._persist

        def deny_write() -> None:
            raise OSError("simulated full disk")

        with monkeypatch.context() as patch:
            patch.setattr(journal, "_persist", deny_write)
            with pytest.raises(OSError, match="full disk"):
                journal.record(_segment("second"))
        assert journal.document["done"] == 1
        assert [item["segment_id"] for item in journal.document["segments"]] == ["first"]
        assert json.loads(destination.read_text(encoding="utf-8"))["done"] == 1
        assert journal._persist == original

    # A successful context exit with incomplete progress is *not* a
    # completed job, even if the caller failed to propagate the write error.
    saved = json.loads(destination.read_text(encoding="utf-8"))
    assert saved["state"] == "failed"
    assert saved["error_type"] == "IncompleteRender"
    assert saved["done"] == 1 and len(saved["segments"]) == 1
    assert list(destination.parent.glob("*.partial.json")) == []


def test_terminal_update_failure_keeps_previous_running_snapshot(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    destination = tmp_path / "jobs" / "progress.json"
    journal = RenderJournal(destination, "story", 1)
    journal.__enter__()
    journal.record(_segment("first"))

    def deny_write() -> None:
        raise OSError("simulated terminal disk failure")

    with monkeypatch.context() as patch:
        patch.setattr(journal, "_persist", deny_write)
        with pytest.raises(OSError, match="terminal disk"):
            journal.__exit__(None, None, None)
    assert journal.document["state"] == "running"
    assert journal.document["error_type"] is None
    assert json.loads(destination.read_text(encoding="utf-8"))["state"] == "running"

    journal.__exit__(None, None, None)
    assert json.loads(destination.read_text(encoding="utf-8"))["state"] == "completed"


def test_journal_cannot_record_more_than_planned_segment_count(tmp_path: Path) -> None:
    destination = tmp_path / "jobs" / "progress.json"
    with RenderJournal(destination, "story", 1) as journal:
        journal.record(_segment("first"))
        with pytest.raises(RuntimeError, match="more segments than"):
            journal.record(_segment("extra"))
        assert journal.document["done"] == 1
    saved = json.loads(destination.read_text(encoding="utf-8"))
    assert saved["done"] == 1 and saved["state"] == "completed"
    assert len(saved["segments"]) == 1


def test_failed_record_does_not_mutate_progress_even_on_keyboard_interrupt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    destination = tmp_path / "jobs" / "progress.json"
    with RenderJournal(destination, "story", 1) as journal:
        def interrupt() -> None:
            raise KeyboardInterrupt()

        with monkeypatch.context() as patch:
            patch.setattr(journal, "_persist", interrupt)
            with pytest.raises(KeyboardInterrupt):
                journal.record(_segment("first"))
        assert journal.document["done"] == 0
        assert journal.document["segments"] == []
    assert json.loads(destination.read_text(encoding="utf-8"))["state"] == "failed"
