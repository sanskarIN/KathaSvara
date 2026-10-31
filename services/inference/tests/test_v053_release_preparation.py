"""Model-free policy tests for the future v0.5.3 prerelease workflow.

The current v0.5.2 package/source version and held release SHA remain untouched.
Passing these tests does NOT authorize a v0.5.3 tag or publish action.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
VERSION = "v0.5.3"
PREVIOUS = "v0.5.2"


def test_next_release_is_manual_and_requires_published_previous_version() -> None:
    workflow = (
        ROOT / ".github/workflows/release-v0.5.3.yml"
    ).read_text(encoding="utf-8")
    header, split, jobs = workflow.partition("\npermissions:")
    assert split
    assert "\n  workflow_dispatch:" in header
    assert "\n      release_sha:" in header
    assert not any(
        f"\n  {trigger}:" in header
        for trigger in ("push", "pull_request", "schedule", "workflow_run")
    )
    prepare = jobs.partition("\n  prepare:")[2].partition("\n  python:")[0]
    publish = jobs.partition("\n  publish:")[2]
    assert prepare and publish
    for section in (prepare, publish):
        assert "releases/tags/v0.5.2" in section
        assert "git/ref/tags/v0.5.2" in section
        assert ".prerelease" in section
        assert '[.assets[].name] | sort | join(",")' in section
        assert "KathaSvara-v0.5.2-dev-win64.exe,README.txt,SHA256SUMS.txt" in section
    assert 'test "$GITHUB_REF" = "refs/heads/main"' in prepare
    assert 'test "$main_sha" = "$RELEASE_SHA"' in prepare
    assert "Stop before compilation if v0.5.3 versions are not synchronized" in prepare
    assert 'ref: ${{ steps.verify.outputs.sha }}' in prepare
    assert 'version = "0.5.3"' in prepare
    assert '"version": "0.5.3"' in prepare
    assert 'test "$current_main_sha" = "$RELEASE_SHA"' in publish
    assert 'test "$(git rev-parse HEAD)" = "$RELEASE_SHA"' in publish


def test_next_release_is_immutable_and_requires_verified_assets() -> None:
    workflow = (
        ROOT / ".github/workflows/release-v0.5.3.yml"
    ).read_text(encoding="utf-8")
    for token in (
        "gh release view v0.5.3",
        "git/ref/tags/v0.5.3",
        "gh release create v0.5.3",
        "--prerelease",
        "KathaSvara-v0.5.3-dev-win64.exe",
        "README.txt",
        "SHA256SUMS.txt",
        "sha256sum -c SHA256SUMS.txt",
        "gh release download v0.5.3",
        "docs/releases/v0.5.3-notes.md",
        "docs/installation/portable-windows-v0.5.3.md",
        "version = \"0.5.3\"",
    ):
        assert token in workflow, f"Missing v0.5.3 release invariant: {token}"
    # The older EXE name must appear in the prior-release asset gate.
    # It must never be packaged or published as the new v0.5.3 artifact.
    assert "gh release create v0.5.2" not in workflow
    assert '$name = "KathaSvara-v0.5.2-dev-win64.exe"' not in workflow
    assert "release-assets/KathaSvara-v0.5.2-dev-win64.exe" not in workflow
    assert "KathaSvara-v0.5.2-dev-win64.exe,README.txt,SHA256SUMS.txt" in workflow


def test_future_release_notes_do_not_claim_audio_acceptance_or_publication() -> None:
    notes = (
        ROOT / "docs/releases/v0.5.3-notes.md"
    ).read_text(encoding="utf-8")
    readme = (
        ROOT / "docs/installation/portable-windows-v0.5.3.md"
    ).read_text(encoding="utf-8")
    checklist = (
        ROOT / "docs/releases/v0.5.3-publication-checklist.md"
    ).read_text(encoding="utf-8")
    for text in (notes, readme, checklist):
        assert VERSION in text
        assert PREVIOUS in text
        assert "issue #3" in text
    assert "NOT PUBLISHED" in notes
    assert "NOT STABLE" in notes
    assert "NOT A COMPLETE INSTALLER" in readme
    assert "Python 3.11" in readme
    assert "Chatterbox" in readme
    assert "SHA256SUMS.txt" in checklist
    assert "exact" in checklist.lower()
