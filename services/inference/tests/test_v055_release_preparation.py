"""Prepare v0.5.5 as a manual-only experimental developer prerelease.

Pure static checks: no network, models, real speech or release authorization.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
VERSION = "0.5.5"
PREVIOUS = "0.5.4"
CURRENT_SOURCE_VERSION = "0.5.6"


def test_current_source_versions_remain_synchronized_after_v055_publication() -> None:
    package = json.loads(
        (ROOT / "apps/desktop/package.json").read_text(encoding="utf-8")
    )
    lock = json.loads(
        (ROOT / "apps/desktop/package-lock.json").read_text(encoding="utf-8")
    )
    tauri = json.loads(
        (ROOT / "apps/desktop/src-tauri/tauri.conf.json").read_text(encoding="utf-8")
    )
    cargo = tomllib.loads(
        (ROOT / "apps/desktop/src-tauri/Cargo.toml").read_text(encoding="utf-8")
    )
    python = tomllib.loads(
        (ROOT / "services/inference/pyproject.toml").read_text(encoding="utf-8")
    )
    assert {
        package["version"],
        lock["version"],
        lock["packages"][""]["version"],
        tauri["version"],
        cargo["package"]["version"],
        python["project"]["version"],
    } == {CURRENT_SOURCE_VERSION}


def test_v055_workflow_is_immutable_manual_and_predecessor_gated() -> None:
    source = (
        ROOT / ".github/workflows/release-v0.5.5.yml"
    ).read_text(encoding="utf-8")
    header, boundary, jobs = source.partition("\npermissions:")
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
    assert 'test "$GITHUB_REF" = "refs/heads/main"' in prepare
    assert 'test "$main_sha" = "$RELEASE_SHA"' in prepare
    assert 'test "$current_main_sha" = "$RELEASE_SHA"' in publish
    assert 'test "$(git rev-parse HEAD)" = "$RELEASE_SHA"' in publish
    assert '[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]' in prepare
    for section in (prepare, publish):
        assert f"releases/tags/v{PREVIOUS}" in section
        assert f"git/ref/tags/v{PREVIOUS}" in section
        assert f"KathaSvara-v{PREVIOUS}-dev-win64.exe,README.txt,SHA256SUMS.txt" in section
    for key in ("prepare", "python", "frontend", "rust-windows",
                "windows-python-lock", "windows-exe", "publish"):
        assert re.search(rf"(?m)^  {key}:$", jobs)
    for token in (
        "gh release create v0.5.5",
        "gh release view v0.5.5",
        "git/ref/tags/v0.5.5",
        "KathaSvara-v0.5.5-dev-win64.exe",
        "README.txt",
        "SHA256SUMS.txt",
        "sha256sum -c SHA256SUMS.txt",
        "gh release download v0.5.5",
        "docs/releases/v0.5.5-published-notes.md",
        "--prerelease",
    ):
        assert token in source


def test_v055_published_notes_cannot_be_false_draft() -> None:
    source = (
        ROOT / ".github/workflows/release-v0.5.5.yml"
    ).read_text(encoding="utf-8")
    draft = (
        ROOT / "docs/releases/v0.5.5-notes.md"
    ).read_text(encoding="utf-8")
    publication = (
        ROOT / "docs/releases/v0.5.5-published-notes.md"
    ).read_text(encoding="utf-8")
    windows = (
        ROOT / "docs/installation/portable-windows-v0.5.5.md"
    ).read_text(encoding="utf-8")
    assert "DRAFT — NOT PUBLISHED" in draft
    assert "DRAFT — NOT PUBLISHED" not in publication
    assert "DRAFT — NOT PUBLISHED" in source  # fail-closed publication check
    assert "--notes-file docs/releases/v0.5.5-published-notes.md" in source
    assert "--notes-file docs/releases/v0.5.5-notes.md" not in source
    for page in (draft, publication, windows):
        assert "NOT STABLE" in page
        assert "issue #3" in page
        assert "Python 3.11" in page
        assert "Chatterbox" in page
    for page in (publication, windows):
        assert "NOT A COMPLETE INSTALLER" in page
        assert "KathaSvara-v0.5.5-dev-win64.exe" in page
    assert "SHA256SUMS.txt" in windows


def test_v055_windows_candidate_and_published_site_confirm_publication() -> None:
    candidate = (
        ROOT / ".github/workflows/windows-portable-candidate.yml"
    ).read_text(encoding="utf-8")
    site = (ROOT / "website/index.html").read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "KathaSvara-v0.5.6-dev-win64.exe" in candidate
    assert "portable-windows-v0.5.6.md" in candidate
    assert "KathaSvara-v0.5.4-dev-win64.exe" not in candidate
    for page in (site, readme):
        assert "releases/tag/v0.5.5" in page
        assert "v0.5.5" in page
        assert "releases/tag/v0.5.4" in page  # Retain predecessor history.
    assert "v0.5.5 · Latest experimental pre-release" in site
    assert "v0.5.5 pre-release ↗" in site
    assert "v0.5.4 · Historical experimental pre-release" in site
    assert "v0.5.4 · Latest experimental pre-release" not in site
    assert "Latest experimental developer pre-release: [KathaSvara v0.5.5]" in readme
    assert "The v0.5.5 source includes model-free diagnostics" in site


def test_v055_new_features_are_not_mistaken_for_real_speech() -> None:
    native = (
        ROOT / "apps/desktop/src-tauri/src/main.rs"
    ).read_text(encoding="utf-8")
    ui = (ROOT / "apps/desktop/src/App.tsx").read_text(encoding="utf-8")
    draft = (
        ROOT / "docs/releases/v0.5.5-notes.md"
    ).read_text(encoding="utf-8")
    assert "configure_local_inference" in native
    assert "clear_local_inference" in native
    assert "probe_audio_io" in native and "probe_audio_io" in ui
    assert "Choose Python and inference folder" in ui
    assert "synthetic" in draft.lower()
    assert "NOT A COMPLETE INSTALLER" in draft
    assert "not tested" in draft.lower()
