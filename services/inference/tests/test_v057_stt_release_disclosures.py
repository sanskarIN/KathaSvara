"""Source-only v0.5.7 STT privacy disclosures, not human audio acceptance.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_prerelease_notes_disclose_private_stt_lifecycle_and_unverified_audio() -> None:
    notes = (ROOT / "docs/releases/v0.5.7-published-notes.md").read_text(
        encoding="utf-8"
    )
    for required in (
        "NOT STABLE", "NOT A COMPLETE INSTALLER", "Fresh consent",
        "Job-scoped native cancellation", "ZWNJ/ZWJ", "Voice Studio",
        "no automatic transcript rewriting", "Windows", "microphone",
        "https://github.com/sanskarIN/KathaSvara/issues/3",
    ):
        assert required.lower() in notes.lower()
    # No source-only release note may claim external model/hardware verification.
    assert "accuracy is verified" not in notes.lower()
    assert "microphone permissions are verified" not in notes.lower()


def test_windows_readme_distinguishes_model_free_checks_from_physical_acceptance() -> None:
    guide = (ROOT / "docs/installation/portable-windows-v0.5.7.md").read_text(
        encoding="utf-8"
    )
    for required in (
        "Python 3.11", "faster-whisper", "NOT A COMPLETE INSTALLER",
        "NOT TESTED", "fresh STT consent", "Job-scoped cancel",
        "does not request permission", "SHA256SUMS.txt",
    ):
        assert required.lower() in guide.lower()
