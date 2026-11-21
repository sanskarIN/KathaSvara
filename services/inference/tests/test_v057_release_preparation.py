"""Source-only v0.5.7 manual release gates; no model or publication."""
from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_v057_versions_are_synced_while_v056_remains_published() -> None:
    p = json.loads((ROOT / "apps/desktop/package.json").read_text(encoding="utf-8"))
    lock = json.loads((ROOT / "apps/desktop/package-lock.json").read_text(encoding="utf-8"))
    tauri = json.loads((ROOT / "apps/desktop/src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    cargo = tomllib.loads((ROOT / "apps/desktop/src-tauri/Cargo.toml").read_text(encoding="utf-8"))
    py = tomllib.loads((ROOT / "services/inference/pyproject.toml").read_text(encoding="utf-8"))
    source = (ROOT / "services/inference/kathasvara/__init__.py").read_text(encoding="utf-8")
    assert {p["version"], lock["version"], lock["packages"][""]["version"],
            tauri["version"], cargo["package"]["version"], py["project"]["version"]} == {"0.5.7"}
    assert '__version__ = "0.5.7"' in source
    website = (ROOT / "website/index.html").read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "v0.5.6 · Latest experimental pre-release" in website
    assert "Latest experimental developer pre-release: [KathaSvara v0.5.6]" in readme
    assert "v0.5.7 DEVELOPMENT SOURCE — NOT PUBLISHED" in readme


def test_v057_release_manual_exact_sha_and_predecessor_guards() -> None:
    workflow = (ROOT / ".github/workflows/release-v0.5.7.yml").read_text(encoding="utf-8")
    header, sep, jobs = workflow.partition("\npermissions:")
    assert sep and re.search(r"(?m)^  workflow_dispatch:$", header)
    assert re.search(r"(?m)^      release_sha:$", header)
    assert not re.search(
        r"(?m)^  (push|pull_request|schedule|workflow_run|repository_dispatch):", header
    )
    prep = jobs.partition("\n  prepare:")[2].partition("\n  python:")[0]
    publish = jobs.partition("\n  publish:")[2]
    security = jobs.partition("\n  frontend-security:")[2].partition("\n  frontend:")[0]
    assert security
    assert "needs: prepare" in security
    assert "ref: ${{ needs.prepare.outputs.sha }}" in security
    assert "npm ci --no-audit --no-fund" in security
    assert re.search(r"(?m)^        run: npm audit --audit-level=high$", security)
    assert "frontend-security" in publish.partition("\n    needs: [")[2].split("]", 1)[0]
    assert prep and publish
    for item in ("prepare", "python", "frontend", "frontend-security", "rust-windows", "windows-python-lock",
                 "windows-exe", "publish"):
        assert re.search(rf"(?m)^  {item}:$", jobs)
    for block in (prep, publish):
        assert "releases/tags/v0.5.6" in block
        assert "git/ref/tags/v0.5.6" in block
        assert "KathaSvara-v0.5.6-dev-win64.exe,README.txt,SHA256SUMS.txt" in block
    for marker in ('test "$GITHUB_REF" = "refs/heads/main"',
                   'test "$main_sha" = "$RELEASE_SHA"',
                   'test "$current_main_sha" = "$RELEASE_SHA"',
                   'test "$(git rev-parse HEAD)" = "$RELEASE_SHA"',
                   "git/ref/tags/v0.5.7", "gh release view v0.5.7",
                   "gh release create v0.5.7", "gh release download v0.5.7",
                   "KathaSvara-v0.5.7-dev-win64.exe",
                   "--prerelease", "SHA256SUMS.txt", "sha256sum -c SHA256SUMS.txt"):
        assert marker in workflow


def test_v057_publication_disclosures_and_history() -> None:
    draft = (ROOT / "docs/releases/v0.5.7-notes.md").read_text(encoding="utf-8")
    release = (ROOT / "docs/releases/v0.5.7-published-notes.md").read_text(encoding="utf-8")
    windows = (ROOT / "docs/installation/portable-windows-v0.5.7.md").read_text(
        encoding="utf-8"
    )
    gate = (ROOT / "docs/releases/v0.5.7-publication-checklist.md").read_text(
        encoding="utf-8"
    )
    for document in (draft, release, windows, gate):
        assert "NOT STABLE" in document
        assert "https://github.com/sanskarIN/KathaSvara/issues/3" in document
    assert "DRAFT — NOT PUBLISHED" in draft
    assert "DRAFT — NOT PUBLISHED" in gate
    assert "DRAFT — NOT PUBLISHED" not in release
    # The same published-notes file is used verbatim by gh release create.
    # No draft-only self-description should survive into the public release.
    assert "proposed copy" not in release.lower()
    assert "not proof of actual GitHub publication" not in release.lower()
    for document in (draft, release, windows):
        assert "NOT A COMPLETE INSTALLER" in document
        assert "Python 3.11" in document
        assert "Chatterbox" in document and "faster-whisper" in document
    assert "SHA256SUMS.txt" in windows
    assert "NOT TESTED" in windows
    manual = (ROOT / "docs/qa/windows-v057-stt-manual-acceptance.md").read_text(
        encoding="utf-8"
    )
    assert "NOT STABLE" in manual and "NOT PUBLISHED" in manual
    assert "NOT TESTED" in manual
    for marker in ("inspect-desktop-candidate.ps1", "-SttDoctorOnly",
                   "-VerifyHindiSttWav", "human", "SHA256SUMS.txt"):
        assert marker.lower() in manual.lower()
    assert "v0.5.6" in manual
    # Release documentation must not silently drop hardware-only tests for
    # permission races, expanded PCM file compatibility, or cancel/recovery.
    for gate_id in ("D5", "D6", "D7"):
        assert f"| {gate_id} |" in manual
        assert next(line for line in manual.splitlines()
                    if line.startswith(f"| {gate_id} |")).endswith("| NOT TESTED |")
    for marker in ("44.1 kHz", "22.05", "32 kHz", "track becoming muted",
                   "Python process exit", "consensual Hindi WAV"):
        assert marker.lower() in manual.lower()
    assert "windows-v057-stt-manual-acceptance.md" in draft
    assert "windows-v057-stt-manual-acceptance.md" in gate
