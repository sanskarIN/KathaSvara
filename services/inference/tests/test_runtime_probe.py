"""No-model import probe tests: never instantiate Chatterbox or download weights."""
from __future__ import annotations

import sys
from types import SimpleNamespace

import pytest

from kathasvara import runtime_probe


class CompatibleFakeChatterbox:
    """Exposes the upstream optional keywords but never loads any model."""

    @classmethod
    def from_pretrained(cls, *, device: str, t3_model: str | None = None) -> object:
        raise AssertionError("No model weights may be loaded by the import probe.")

    def generate(
        self, text: str, language_id: str, audio_prompt_path: str | None = None,
    ) -> object:
        raise AssertionError("The import probe may not synthesize audio.")


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
    monkeypatch.delenv("KATHASVARA_TTS_DEVICE", raising=False)
    monkeypatch.delenv("KATHASVARA_TTS_MODEL", raising=False)
    monkeypatch.delenv("KATHASVARA_TTS_REFERENCE_WAV", raising=False)
    report = runtime_probe.probe_runtime()
    assert requested == ["numpy", "soundfile", "torch", "chatterbox.mtl_tts"]
    assert report["checks"] == {
        "numpy": "ok", "soundfile": "ok", "torch": "ok",
        "chatterbox_multilingual": "ok",
    }
    assert report["imports_ok"] == (sys.version_info[:2] == (3, 11))
    assert report["tts_device_mode"] == "auto"
    assert report["device_configuration_valid"] is True
    assert report["tts_model_variant"] == "v2"
    assert report["model_configuration_valid"] is True
    assert report["reference_voice_status"] == "not_set"
    assert report["upstream_api_status"] == "not_requested"
    assert report["upstream_api_compatible"] is True
    assert report["preflight_ok"] == report["imports_ok"]
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


def test_invalid_device_override_is_safe_and_blocks_preflight(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        runtime_probe.importlib,
        "import_module",
        lambda _name: SimpleNamespace(ChatterboxMultilingualTTS=object()),
    )
    secret = r"C:\Users\private\device-value"
    monkeypatch.setenv("KATHASVARA_TTS_DEVICE", secret)
    report = runtime_probe.probe_runtime()
    assert report["imports_ok"] == (sys.version_info[:2] == (3, 11))
    assert report["device_configuration_valid"] is False
    assert report["tts_device_mode"] == "invalid"
    assert report["preflight_ok"] is False
    assert secret not in str(report)


def test_cpu_override_passes_configuration_check_without_loading_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        runtime_probe.importlib,
        "import_module",
        lambda _name: SimpleNamespace(ChatterboxMultilingualTTS=object()),
    )
    monkeypatch.setenv("KATHASVARA_TTS_DEVICE", " CPU ")
    report = runtime_probe.probe_runtime()
    assert report["tts_device_mode"] == "cpu"
    assert report["device_configuration_valid"] is True
    assert report["preflight_ok"] == report["imports_ok"]
    assert report["model_weights_verified"] is False
    assert report["audio_synthesis_verified"] is False


@pytest.mark.parametrize(("selected", "expected", "valid"), [
    ("v2", "v2", True),
    (" V3 ", "v3", True),
    (r"C:\private\model", "invalid", False),
])
def test_model_selection_probe_never_echoes_invalid_values_or_loads_weights(
    monkeypatch: pytest.MonkeyPatch, selected: str, expected: str, valid: bool,
) -> None:
    monkeypatch.setattr(
        runtime_probe.importlib, "import_module",
        lambda _name: SimpleNamespace(ChatterboxMultilingualTTS=CompatibleFakeChatterbox),
    )
    monkeypatch.setenv("KATHASVARA_TTS_MODEL", selected)
    monkeypatch.setenv("KATHASVARA_TTS_DEVICE", "cpu")
    report = runtime_probe.probe_runtime()
    assert report["tts_model_variant"] == expected
    assert report["model_configuration_valid"] is valid
    assert report["upstream_api_status"] == (
        "compatible" if selected.strip().lower() == "v3" else "not_requested"
    )
    assert report["preflight_ok"] == (valid and report["imports_ok"])
    if not valid:
        assert selected not in str(report)
    assert report["model_weights_verified"] is False
    assert report["audio_synthesis_verified"] is False


def test_reference_probe_never_returns_private_local_path(
    monkeypatch: pytest.MonkeyPatch, tmp_path,
) -> None:
    monkeypatch.setattr(
        runtime_probe.importlib, "import_module",
        lambda _name: SimpleNamespace(ChatterboxMultilingualTTS=object()),
    )
    filename = tmp_path / "private-narrator.wav"
    filename.write_bytes(b"not audio")
    monkeypatch.setenv("KATHASVARA_TTS_REFERENCE_WAV", str(filename))
    monkeypatch.setenv("KATHASVARA_TTS_DEVICE", "cpu")
    monkeypatch.setenv("KATHASVARA_TTS_MODEL", "v2")
    report = runtime_probe.probe_runtime()
    assert report["reference_voice_status"] == "invalid"
    assert report["preflight_ok"] is False
    assert str(filename) not in str(report)
    assert report["model_weights_verified"] is False


def test_cli_exposes_probe_without_speech_generation(monkeypatch: pytest.MonkeyPatch) -> None:
    from kathasvara import cli

    monkeypatch.setattr(cli, "probe_runtime", lambda: {"imports_ok": False})
    assert cli.handle({"action": "probe_runtime"}) == {
        "ok": True, "result": {"imports_ok": False},
    }
