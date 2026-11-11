"""Static, model-free preparation gates for v0.5.6; never authorize publication.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
VERSION = "0.5.6"
PREVIOUS = "0.5.5"


def test_v056_version_consistency_and_published_current_preview() -> None:
    package = json.loads((ROOT / "apps/desktop/package.json").read_text(encoding="utf-8"))
    lock = json.loads((ROOT / "apps/desktop/package-lock.json").read_text(encoding="utf-8"))
    tauri = json.loads((ROOT / "apps/desktop/src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    cargo = tomllib.loads((ROOT / "apps/desktop/src-tauri/Cargo.toml").read_text(encoding="utf-8"))
    python = tomllib.loads((ROOT / "services/inference/pyproject.toml").read_text(encoding="utf-8"))
    assert {
        package["version"], lock["version"], lock["packages"][""]["version"],
        tauri["version"], cargo["package"]["version"], python["project"]["version"],
    } == {VERSION}
    site = (ROOT / "website/index.html").read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "v0.5.5 · Historical experimental pre-release" in site
    assert "v0.5.6 · Latest experimental pre-release" in site
    assert "releases/tag/v0.5.5" in site and "releases/tag/v0.5.5" in readme
    assert "releases/tag/v0.5.6" in site and "releases/tag/v0.5.6" in readme
    assert "Latest experimental developer pre-release: [KathaSvara v0.5.6]" in readme


def test_v056_release_is_exclusively_manual_and_predecessor_gated() -> None:
    workflow = (ROOT / ".github/workflows/release-v0.5.6.yml").read_text(encoding="utf-8")
    header, boundary, jobs = workflow.partition("\npermissions:")
    assert boundary
    assert re.search(r"(?m)^on:$", header)
    assert re.search(r"(?m)^  workflow_dispatch:$", header)
    assert re.search(r"(?m)^      release_sha:$", header)
    assert not re.search(
        r"(?m)^  (push|pull_request|schedule|workflow_run|repository_dispatch):",
        header,
    )
    prepare = jobs.partition("\n  prepare:")[2].partition("\n  python:")[0]
    publish = jobs.partition("\n  publish:")[2]
    assert prepare and publish
    for key in (
        "prepare", "python", "frontend", "rust-windows", "windows-python-lock",
        "windows-exe", "publish",
    ):
        assert re.search(rf"(?m)^  {key}:$", jobs)
    assert 'test "$GITHUB_REF" = "refs/heads/main"' in prepare
    assert 'test "$main_sha" = "$RELEASE_SHA"' in prepare
    assert 'test "$current_main_sha" = "$RELEASE_SHA"' in publish
    assert 'test "$(git rev-parse HEAD)" = "$RELEASE_SHA"' in publish
    assert '[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]' in prepare
    for block in (prepare, publish):
        assert f"releases/tags/v{PREVIOUS}" in block
        assert f"git/ref/tags/v{PREVIOUS}" in block
        assert f"KathaSvara-v{PREVIOUS}-dev-win64.exe,README.txt,SHA256SUMS.txt" in block
    for item in (
        "gh release view v0.5.6", "gh release create v0.5.6",
        "git/ref/tags/v0.5.6", "KathaSvara-v0.5.6-dev-win64.exe",
        "README.txt", "SHA256SUMS.txt", "--prerelease",
        "sha256sum -c SHA256SUMS.txt", "gh release download v0.5.6",
        "docs/releases/v0.5.6-published-notes.md",
    ):
        assert item in workflow


def test_v056_publication_safe_notes_and_unsigned_windows_candidate() -> None:
    workflow = (ROOT / ".github/workflows/release-v0.5.6.yml").read_text(encoding="utf-8")
    candidate = (ROOT / ".github/workflows/windows-portable-candidate.yml").read_text(
        encoding="utf-8"
    )
    draft = (ROOT / "docs/releases/v0.5.6-notes.md").read_text(encoding="utf-8")
    published = (ROOT / "docs/releases/v0.5.6-published-notes.md").read_text(
        encoding="utf-8"
    )
    windows = (ROOT / "docs/installation/portable-windows-v0.5.6.md").read_text(
        encoding="utf-8"
    )
    checklist = (ROOT / "docs/releases/v0.5.6-publication-checklist.md").read_text(
        encoding="utf-8"
    )
    assert "DRAFT — NOT PUBLISHED" in draft
    assert "PUBLISHED 11 NOVEMBER 2026" in checklist
    assert "DRAFT — NOT PUBLISHED" not in checklist
    assert "DRAFT — NOT PUBLISHED" not in published
    assert "DRAFT — NOT PUBLISHED" in workflow
    assert "--notes-file docs/releases/v0.5.6-published-notes.md" in workflow
    assert "--notes-file docs/releases/v0.5.6-notes.md" not in workflow
    assert "KathaSvara-v0.5.6-dev-win64.exe" in candidate
    assert "portable-windows-v0.5.6.md" in candidate
    assert "KathaSvara-v0.5.5-dev-win64.exe" not in candidate
    for document in (draft, published, windows, checklist):
        assert "NOT STABLE" in document
        assert "Python 3.11" in document
        assert "https://github.com/sanskarIN/KathaSvara/issues/3" in document
        assert "model" in document.lower()
    for document in (draft, published, windows):
        assert "Chatterbox" in document
        assert "NOT A COMPLETE INSTALLER" in document
    assert "SHA256SUMS.txt" in windows
    assert "third-party" in published.lower()
    assert "may download" in published.lower()
