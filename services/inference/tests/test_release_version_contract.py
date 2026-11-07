"""Model-free checks against mismatched prerelease identities and missing warnings.

Run as part of ordinary Python CI, without GPU or Chatterbox checkpoints.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import json
import tomllib
from pathlib import Path

VERSION = "0.5.5"
# Public landing page must match the last actually published GitHub prerelease.
PUBLISHED_VERSION = "0.5.4"
ROOT = Path(__file__).resolve().parents[3]


def test_prerelease_components_share_exact_version() -> None:
    package = json.loads((ROOT / "apps/desktop/package.json").read_text(encoding="utf-8"))
    lock = json.loads((ROOT / "apps/desktop/package-lock.json").read_text(encoding="utf-8"))
    tauri = json.loads(
        (ROOT / "apps/desktop/src-tauri/tauri.conf.json").read_text(encoding="utf-8")
    )
    cargo = tomllib.loads(
        (ROOT / "apps/desktop/src-tauri/Cargo.toml").read_text(encoding="utf-8")
    )
    python = tomllib.loads(
        (ROOT / "services/inference/pyproject.toml").read_text(encoding="utf-8")
    )
    assert package["version"] == VERSION
    assert lock["version"] == VERSION
    assert lock["packages"][""]["version"] == VERSION
    assert tauri["version"] == VERSION
    assert cargo["package"]["version"] == VERSION
    assert python["project"]["version"] == VERSION


def test_pre_release_workflow_has_exact_tag_guards_and_three_assets() -> None:
    workflow = (
        ROOT / f".github/workflows/release-v{VERSION}.yml"
    ).read_text(encoding="utf-8")
    expected_exe = f"KathaSvara-v{VERSION}-dev-win64.exe"
    for token in (
        "workflow_dispatch:",
        "release_sha:", "refs/heads/main", "git/ref/heads/main",
        "git/ref/tags/v0.5.5", "gh release view v0.5.5",
        "gh release create v0.5.5", "--prerelease",
        expected_exe, "README.txt", "SHA256SUMS.txt",
        "sha256sum -c SHA256SUMS.txt",
        "actions/download-artifact", "gh release download v0.5.5",
        'test "$(git rev-parse HEAD)" = "$RELEASE_SHA"',
        'test "$(gh api "repos/$GITHUB_REPOSITORY/releases/tags/v0.5.5" --jq \'.assets | length\')" = 3',
    ):
        assert token in workflow, f"Missing release guard: {token}"


def test_prerelease_disclosures_remain_explicit() -> None:
    instructions = (
        ROOT / "docs/installation/portable-windows-v0.5.5.md"
    ).read_text(encoding="utf-8")
    notes = (ROOT / f"docs/releases/v{VERSION}-notes.md").read_text(encoding="utf-8")
    for content in (instructions, notes):
        assert f"v{VERSION}" in content
        assert "Python 3.11" in content
        assert "issue #3" in content
        assert "unsigned" in content.lower()
        assert "Chatterbox" in content
    assert "NOT A COMPLETE INSTALLER" in instructions
    assert "NOT STABLE" in notes
    assert "KathaSvara-v0.5.5-dev-win64.exe" in notes
    published_notes = (ROOT / "docs/releases/v0.5.5-published-notes.md").read_text(encoding="utf-8")
    assert "NOT STABLE" in published_notes
    assert "DRAFT — NOT PUBLISHED" not in published_notes
    assert "issue #3" in published_notes


def test_public_site_uses_latest_published_prerelease_without_stable_claims() -> None:
    site = (ROOT / "website/index.html").read_text(encoding="utf-8")
    latest = f"https://github.com/sanskarIN/KathaSvara/releases/tag/v{PUBLISHED_VERSION}"
    assert site.count(latest) >= 2
    assert f"v{PUBLISHED_VERSION} · Latest experimental pre-release" in site
    assert f">v{PUBLISHED_VERSION} pre-release ↗" in site
    assert "not a self-contained installer" in site
    assert "Real Hindi listening" in site
    assert "remain unverified" in site
    assert "issues/3" in site
    assert "v0.5.3 · Published experimental pre-release" in site
    assert "https://github.com/sanskarIN/KathaSvara/releases/tag/v0.5.3" in site
    assert "v0.5.2 · Published experimental pre-release" in site
    assert "https://github.com/sanskarIN/KathaSvara/releases/tag/v0.5.2" in site
    assert "v0.5.1 · Published experimental pre-release" in site
    assert "https://github.com/sanskarIN/KathaSvara/releases/tag/v0.5.1" in site


def test_manual_windows_qa_uses_latest_published_preview() -> None:
    qa = (ROOT / "docs/qa/windows-hindi-acceptance.md").read_text(
        encoding="utf-8",
    )
    assert f"releases/tag/v{PUBLISHED_VERSION}" in qa
    assert f"KathaSvara-v{PUBLISHED_VERSION}-dev-win64.exe" in qa
    assert "Latest verified published experimental pre-release" in qa
    assert "v0.5.4" in qa and "unpublished source release candidate" not in qa
    assert "not-tested" in qa
    assert "real-model" in qa.lower() and "listening" in qa.lower()


def test_public_support_link_matches_repository_funding() -> None:
    site = (ROOT / "website/index.html").read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    funding = (ROOT / ".github/FUNDING.yml").read_text(encoding="utf-8")
    url = "https://buymeacoffee.com/sanskarIN"
    assert url in site
    assert url in readme
    assert url in funding
    for text in (site, readme, funding):
        assert "buymeacoffee.com/SanskarCodes" not in text



def test_v052_publication_requires_manual_intent() -> None:
    workflow = (ROOT / ".github/workflows/release-v0.5.2.yml").read_text(
        encoding="utf-8",
    )
    event_header = workflow.partition("\npermissions:")[0]
    assert "\n  workflow_dispatch:" in event_header
    assert "\n  push:" not in event_header
    assert "\n  pull_request:" not in event_header
    assert "\n  schedule:" not in event_header
    assert "release_sha:" in event_header
    assert "git/ref/tags/v0.5.2" in workflow
    assert "gh release view v0.5.2" in workflow
    assert "test \"$main_sha\" = \"$RELEASE_SHA\"" in workflow
    publish = workflow.partition("\n  publish:")[2]
    assert publish, "The release must retain its gated publication job"
    assert 'current_main_sha="$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main"' in publish
    assert 'test "$current_main_sha" = "$RELEASE_SHA"' in publish
