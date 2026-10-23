"""Model-free checks against mismatched prerelease identities and missing warnings.

Run as part of ordinary Python CI, without GPU or Chatterbox checkpoints.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import json
import tomllib
from pathlib import Path

VERSION = "0.5.1"
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
        "workflow_dispatch:", "branches: [main]",
        "release_sha:", "refs/heads/main", "git/ref/heads/main",
        "git/ref/tags/v0.5.1", "gh release view v0.5.1",
        "gh release create v0.5.1", "--prerelease",
        expected_exe, "README.txt", "SHA256SUMS.txt",
        "sha256sum -c SHA256SUMS.txt",
        "actions/download-artifact", "gh release download v0.5.1",
        'test "$(git rev-parse HEAD)" = "$RELEASE_SHA"',
        'test "$(gh api "repos/$GITHUB_REPOSITORY/releases/tags/v0.5.1" --jq \'.assets | length\')" = 3',
    ):
        assert token in workflow, f"Missing release guard: {token}"


def test_prerelease_disclosures_remain_explicit() -> None:
    instructions = (
        ROOT / "docs/installation/portable-windows-candidate.md"
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
    assert "KathaSvara-v0.5.1-dev-win64.exe" in notes
