"""Model-free safety regression tests for atomic progress sidecars.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from kathasvara import cli


def test_progress_replacement_publishes_complete_counters(tmp_path: Path) -> None:
    progress = tmp_path / "jobs" / "render.progress.json"
    cli.write_render_progress_file(progress, 0, 2)
    assert json.loads(progress.read_text(encoding="utf-8")) == {"done": 0, "total": 2}
    cli.write_render_progress_file(progress, 1, 2)
    assert json.loads(progress.read_text(encoding="utf-8")) == {"done": 1, "total": 2}
    assert list(progress.parent.glob("*.partial")) == []


def test_predictable_legacy_partial_symlink_is_never_written(
    tmp_path: Path,
) -> None:
    progress = tmp_path / "jobs" / "render.progress.json"
    progress.parent.mkdir(parents=True)
    private = tmp_path / "private.txt"
    private.write_text("KEEP SECRET", encoding="utf-8")
    legacy = progress.with_name(progress.name + ".partial")
    try:
        legacy.symlink_to(private)
    except (OSError, NotImplementedError):
        pytest.skip("Creating file symlinks is unavailable in this environment.")
    cli.write_render_progress_file(progress, 1, 3)
    assert json.loads(progress.read_text(encoding="utf-8")) == {"done": 1, "total": 3}
    assert legacy.is_symlink()
    assert private.read_text(encoding="utf-8") == "KEEP SECRET"


def test_competing_temp_filename_fails_closed_without_truncation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    progress = tmp_path / "jobs" / "render.progress.json"
    progress.parent.mkdir(parents=True)
    cli.write_render_progress_file(progress, 0, 2)
    temporary = progress.with_name(progress.name + ".existing.partial")
    temporary.write_text("DO NOT CHANGE", encoding="utf-8")
    monkeypatch.setattr(cli.uuid, "uuid4", lambda: SimpleNamespace(hex="existing"))
    with pytest.raises(FileExistsError):
        cli.write_render_progress_file(progress, 1, 2)
    assert temporary.read_text(encoding="utf-8") == "DO NOT CHANGE"
    assert json.loads(progress.read_text(encoding="utf-8")) == {"done": 0, "total": 2}


def test_atomic_replace_error_preserves_last_progress(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    progress = tmp_path / "jobs" / "render.progress.json"
    cli.write_render_progress_file(progress, 0, 2)

    def deny_replace(_self: Path, _target: Path) -> None:
        raise OSError("simulated full disk")

    with monkeypatch.context() as patch:
        patch.setattr(Path, "replace", deny_replace)
        with pytest.raises(OSError, match="full disk"):
            cli.write_render_progress_file(progress, 1, 2)
    assert json.loads(progress.read_text(encoding="utf-8")) == {"done": 0, "total": 2}
    assert list(progress.parent.glob("*.partial")) == []


@pytest.mark.parametrize(
    ("done", "total"),
    [(3, 2), (-1, 2), (1, 257), (1, -1), (True, 1), (0, False), (0.5, 1)],
)
def test_invalid_progress_counters_cannot_touch_files(
    tmp_path: Path, done: object, total: object,
) -> None:
    progress = tmp_path / "jobs" / "render.progress.json"
    with pytest.raises(ValueError, match="Invalid render progress"):
        cli.write_render_progress_file(progress, done, total)
    assert not progress.exists()


def test_progress_requires_absolute_json_destination(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="absolute"):
        cli.write_render_progress_file(Path("relative.progress.json"), 0, 2)
    with pytest.raises(ValueError, match="absolute"):
        cli.write_render_progress_file(tmp_path / "progress.txt", 0, 2)
