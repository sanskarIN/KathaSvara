"""Do not leak native-library error details through the speech IPC.

These tests substitute broken imports; no model is loaded or downloaded.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import builtins
from types import SimpleNamespace

import pytest

from kathasvara.engine import ChatterboxHindi, VoiceSettings
from kathasvara.synthesis import synthesize


def _fail_import(monkeypatch: pytest.MonkeyPatch, target: str) -> None:
    original_import = builtins.__import__

    def failing_import(name: str, *args: object, **kwargs: object) -> object:
        if name == target:
            raise OSError(r"DLL load failed: C:\Users\private\speech_backend.dll")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", failing_import)


def _assert_safe_failure(error: pytest.ExceptionInfo[RuntimeError]) -> None:
    # The underlying exception is retained for local debugging, but no private
    # paths, upstream exception messages or filenames enter the UI-facing text.
    visible = str(error.value)
    assert visible.startswith((
        "Unable to load the speech model:",
        "Unable to load the speech model.",
        "Audio libraries could not initialize.",
    ))
    assert "private" not in visible
    assert "speech_backend.dll" not in visible
    assert "DLL load failed" not in visible
    assert isinstance(error.value.__cause__, OSError)


def test_broken_torch_binary_import_is_sanitized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _fail_import(monkeypatch, "torch")
    with pytest.raises(RuntimeError) as failure:
        ChatterboxHindi().load()
    _assert_safe_failure(failure)


def test_broken_chatterbox_binary_import_is_sanitized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Import the fake torch rather than a real heavyweight library.
    original_import = builtins.__import__

    def import_with_broken_chatterbox(
        name: str, *args: object, **kwargs: object,
    ) -> object:
        if name == "torch":
            return SimpleNamespace()
        if name == "chatterbox.mtl_tts":
            raise OSError(r"DLL load failed: C:\Users\private\speech_backend.dll")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", import_with_broken_chatterbox)
    with pytest.raises(RuntimeError) as failure:
        ChatterboxHindi().load()
    _assert_safe_failure(failure)


def test_device_detection_failure_is_sanitized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_import = builtins.__import__

    def broken_device() -> bool:
        raise OSError(r"GPU probe failed at C:\Users\private\speech_backend.dll")

    def import_with_broken_device(
        name: str, *args: object, **kwargs: object,
    ) -> object:
        if name == "torch":
            return SimpleNamespace(
                backends=SimpleNamespace(mps=None),
                cuda=SimpleNamespace(is_available=broken_device),
            )
        if name == "chatterbox.mtl_tts":
            return SimpleNamespace(ChatterboxMultilingualTTS=object)
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", import_with_broken_device)
    with pytest.raises(RuntimeError) as failure:
        ChatterboxHindi().load()
    assert "private" not in str(failure.value)
    assert "speech_backend.dll" not in str(failure.value)
    assert isinstance(failure.value.__cause__, OSError)


@pytest.mark.parametrize("module", ["numpy", "soundfile"])
def test_broken_audio_extension_import_is_sanitized(
    monkeypatch: pytest.MonkeyPatch, tmp_path: object, module: str,
) -> None:
    _fail_import(monkeypatch, module)
    output = tmp_path / "never-written.wav"
    with pytest.raises(RuntimeError) as failure:
        synthesize("नमस्कार, मित्रों!", output, VoiceSettings())
    _assert_safe_failure(failure)
    assert not output.exists()
