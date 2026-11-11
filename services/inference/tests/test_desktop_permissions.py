"""Fail closed when native file/folder selection dialogs lose their capability.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_desktop_has_minimal_open_and_save_dialog_permissions() -> None:
    """Open is required for Python, model, STT WAV and reference selections."""
    capability = json.loads(
        (ROOT / "apps/desktop/src-tauri/capabilities/default.json").read_text(
            encoding="utf-8"
        )
    )
    assert capability["windows"] == ["main"]
    assert set(capability["permissions"]) == {
        "core:default",
        "dialog:allow-open",
        "dialog:allow-save",
    }
    # A broad dialog:default grants unrelated dialogs; use only these actions.
    assert "dialog:default" not in capability["permissions"]


def test_stt_and_speech_setup_still_use_explicit_native_picker() -> None:
    source = (ROOT / "apps/desktop/src/App.tsx").read_text(encoding="utf-8")
    assert 'from "@tauri-apps/plugin-dialog"' in source
    for function in (
        "chooseLocalRuntime",
        "chooseReferenceVoice",
        "chooseSttWav",
        "chooseSttModel",
    ):
        assert f"async function {function}(" in source
    assert "title: \"Select a local Hindi recording to transcribe\"" in source
    assert "title: \"Select an existing offline faster-whisper model folder\"" in source
