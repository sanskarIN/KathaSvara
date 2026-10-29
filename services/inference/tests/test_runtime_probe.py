"""No-model import probe tests: never instantiate Chatterbox or download weights."""
from __future__ import annotations

import sys
from types import SimpleNamespace

import pytest

from kathasvara import runtime_probe


def test_import_probe_reports_all_available_without_claiming_audio(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requested: list[str] = []

    def import_ok(name: str) -> object:
        requested.append(name)
        if name == "chatterbox.mtl_tts":
            return SimpleNamespace(ChatterboxMultilingualTTS=object())
        return SimpleNamespace()

    monkeypatch.setattr(runtime_probe.importlib, "import_module", import_ok)
    report = runtime_probe.probe_runtime()
    assert requested == ["numpy", "soundfile", "torch", "chatterbox.mtl_tts"]
    assert report["checks"] == {
        "numpy": "ok", "soundfile": "ok", "torch": "ok",
        "chatterbox_multilingual": "ok",
    }
    assert report["imports_ok"] == (sys.version_info[:2] == (3, 11))
    assert report["failed_components"] == []
    assert report["model_weights_verified"] is False
    assert report["audio_synthesis_verified"] is False


def test_broken_binary_import_does_not_expose_private_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def import_broken(name: str) -> object:
        if name == "torch":
            raise OSError(r"C:\Users\someone\private\torch_backend.dll")
        if name == "chatterbox.mtl_tts":
            return SimpleNamespace(ChatterboxMultilingualTTS=object())
        return SimpleNamespace()

    monkeypatch.setattr(runtime_probe.importlib, "import_module", import_broken)
    report = runtime_probe.probe_runtime()
    assert report["checks"]["torch"] == "import_failed"
    assert report["failed_components"] == ["torch"]
    assert report["imports_ok"] is False
    assert "someone" not in str(report)
    assert ".dll" not in str(report)


def test_wrong_chatterbox_api_is_detected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        runtime_probe.importlib, "import_module", lambda _name: SimpleNamespace(),
    )
    report = runtime_probe.probe_runtime()
    assert report["checks"]["chatterbox_multilingual"] == "entrypoint_missing"
    assert report["failed_components"] == ["chatterbox_multilingual"]
    assert report["imports_ok"] is False


def test_cli_exposes_probe_without_speech_generation(monkeypatch: pytest.MonkeyPatch) -> None:
    from kathasvara import cli

    monkeypatch.setattr(cli, "probe_runtime", lambda: {"imports_ok": False})
    assert cli.handle({"action": "probe_runtime"}) == {
        "ok": True, "result": {"imports_ok": False},
    }
