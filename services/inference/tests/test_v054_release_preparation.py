"""Archive the published v0.5.4 workflow and model-free release contracts.

A passing source test is not a substitute for the actual GitHub publication
or real Hindi listening. SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
VERSION = "0.5.4"
PREVIOUS = "0.5.3"


def test_v054_workflow_is_exact_sha_manual_only_and_predecessor_gated() -> None:
    source = (
        ROOT / f".github/workflows/release-v{VERSION}.yml"
    ).read_text(encoding="utf-8")
    header, marker, jobs = source.partition("\npermissions:")
    assert marker
    assert re.search(r"(?m)^on:\s*$", header)
    assert re.search(r"(?m)^  workflow_dispatch:\s*$", header)
    assert re.search(r"(?m)^      release_sha:\s*$", header)
    assert not re.search(
        r"(?m)^  (push|pull_request|schedule|workflow_run|repository_dispatch):",
        header,
    )
    prepare = jobs.partition("\n  prepare:")[2].partition("\n  python:")[0]
    publish = jobs.partition("\n  publish:")[2]
    assert prepare and publish
    for section in (prepare, publish):
        assert f"releases/tags/v{PREVIOUS}" in section
        assert f"git/ref/tags/v{PREVIOUS}" in section
        assert f"KathaSvara-v{PREVIOUS}-dev-win64.exe,README.txt,SHA256SUMS.txt" in section
    assert 'test "$GITHUB_REF" = "refs/heads/main"' in prepare
    assert '[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]' in prepare
    assert 'test "$main_sha" = "$RELEASE_SHA"' in prepare
    assert 'test "$current_main_sha" = "$RELEASE_SHA"' in publish
    assert 'test "$(git rev-parse HEAD)" = "$RELEASE_SHA"' in publish
    assert f'git/ref/tags/v{VERSION}' in source
    assert f'gh release view v{VERSION}' in source
    assert f'gh release create v{VERSION}' in publish
    assert f'gh release download v{VERSION}' in publish
    assert '--prerelease' in source
    assert 'sha256sum -c SHA256SUMS.txt' in source
    assert 'actions/upload-artifact@v7' in source
    assert 'actions/download-artifact@v8' in source


def test_v054_release_template_cannot_publish_a_false_draft_banner() -> None:
    workflow = (ROOT / ".github/workflows/release-v0.5.4.yml").read_text(
        encoding="utf-8",
    )
    draft = (ROOT / "docs/releases/v0.5.4-notes.md").read_text(encoding="utf-8")
    published = (
        ROOT / "docs/releases/v0.5.4-published-notes.md"
    ).read_text(encoding="utf-8")
    assert "DRAFT — NOT PUBLISHED" in draft
    assert "DRAFT — NOT PUBLISHED" not in published
    assert "NOT STABLE" in draft
    assert "NOT STABLE" in published
    assert "issue #3" in draft and "issue #3" in published
    assert "--notes-file docs/releases/v0.5.4-published-notes.md" in workflow
    assert "--notes-file docs/releases/v0.5.4-notes.md" not in workflow
    assert "DRAFT — NOT PUBLISHED" in workflow  # fail-closed publication gate
    assert "The published release description must not carry draft status" in workflow
    assert "Python 3.11" in published
    assert "Chatterbox" in published
    assert "NOT A COMPLETE INSTALLER" in published


def test_version_components_match_published_v054_site() -> None:
    package = json.loads((ROOT / "apps/desktop/package.json").read_text(encoding="utf-8"))
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
    for actual in (
        package["version"],
        lock["version"],
        lock["packages"][""]["version"],
        tauri["version"],
        cargo["package"]["version"],
        python["project"]["version"],
    ):
        assert actual == VERSION
    site = (ROOT / "website/index.html").read_text(encoding="utf-8")
    assert 'releases/tag/v0.5.4' in site
    assert "v0.5.4 · Latest experimental pre-release" in site
    assert 'v0.5.4 pre-release ↗' in site
    assert "v0.5.3 · Published experimental pre-release" in site
    assert "v0.5.3 · Latest experimental pre-release" not in site


def test_v054_windows_candidate_and_readme_are_unbundled() -> None:
    candidate = (
        ROOT / ".github/workflows/windows-portable-candidate.yml"
    ).read_text(encoding="utf-8")
    instructions = (
        ROOT / "docs/installation/portable-windows-v0.5.4.md"
    ).read_text(encoding="utf-8")
    assert "KathaSvara-v0.5.4-dev-win64.exe" in candidate
    assert "portable-windows-v0.5.4.md" in candidate
    assert "KathaSvara-v0.5.3-dev-win64.exe" not in candidate
    for term in (
        "NOT A COMPLETE INSTALLER", "NOT STABLE", "Python 3.11",
        "Chatterbox", "SHA256SUMS.txt", "issue #3", "UNSIGNED",
        "UNBUNDLED", "-DoctorOnly", "-InstallDependencies",
    ):
        assert term in instructions
