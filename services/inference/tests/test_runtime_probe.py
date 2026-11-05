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


def test_installed_legacy_chatterbox_cannot_claim_v3_support(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class LegacyChatterbox:
        @classmethod
        def from_pretrained(cls, *, device: str) -> None:
            raise AssertionError("No weights should load in preflight.")

        def generate(self, text: str, language_id: str) -> None:
            raise AssertionError("No audio should generate in preflight.")

    monkeypatch.setattr(
        runtime_probe.importlib, "import_module",
        lambda _name: SimpleNamespace(ChatterboxMultilingualTTS=LegacyChatterbox),
    )
    monkeypatch.setenv("KATHASVARA_TTS_DEVICE", "cpu")
    monkeypatch.setenv("KATHASVARA_TTS_MODEL", "v3")
    monkeypatch.delenv("KATHASVARA_TTS_REFERENCE_WAV", raising=False)
    report = runtime_probe.probe_runtime()
    assert report["imports_ok"] == (sys.version_info[:2] == (3, 11))
    assert report["model_configuration_valid"] is True
    assert report["upstream_api_status"] == "v3_unsupported"
    assert report["upstream_api_compatible"] is False
    assert report["preflight_ok"] is False
    assert report["model_weights_verified"] is False


def test_installed_legacy_chatterbox_cannot_claim_reference_support(
    monkeypatch: pytest.MonkeyPatch, tmp_path,
) -> None:
    import wave

    class LegacyChatterbox:
        @classmethod
        def from_pretrained(cls, *, device: str) -> None:
            raise AssertionError("No weights should load in preflight.")

        def generate(self, text: str, language_id: str) -> None:
            raise AssertionError("No audio should generate in preflight.")

    local_voice = tmp_path / "private-reference.wav"
    with wave.open(str(local_voice), "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(24000)
        pair = (
            (1000).to_bytes(2, "little", signed=True)
            + (-1000).to_bytes(2, "little", signed=True)
        )
        stream.writeframes(pair * 36000)
    monkeypatch.setattr(
        runtime_probe.importlib, "import_module",
        lambda _name: SimpleNamespace(ChatterboxMultilingualTTS=LegacyChatterbox),
    )
    monkeypatch.setenv("KATHASVARA_TTS_REFERENCE_WAV", str(local_voice))
    monkeypatch.setenv("KATHASVARA_TTS_MODEL", "v2")
    report = runtime_probe.probe_runtime()
    assert report["reference_voice_status"] == "valid"
    assert report["upstream_api_status"] == "reference_unsupported"
    assert report["upstream_api_compatible"] is False
    assert report["preflight_ok"] is False
    assert str(local_voice) not in str(report)


def test_kwargs_only_chatterbox_wrapper_is_unverifiable_for_v3(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class OpaqueChatterbox:
        @classmethod
        def from_pretrained(cls, **kwargs: object) -> None:
            raise AssertionError("No model loading during preflight.")

        def generate(self, **kwargs: object) -> None:
            raise AssertionError("No generation during preflight.")

    monkeypatch.setattr(
        runtime_probe.importlib, "import_module",
        lambda _name: SimpleNamespace(ChatterboxMultilingualTTS=OpaqueChatterbox),
    )
    monkeypatch.setenv("KATHASVARA_TTS_DEVICE", "cpu")
    monkeypatch.setenv("KATHASVARA_TTS_MODEL", "v3")
    monkeypatch.delenv("KATHASVARA_TTS_REFERENCE_WAV", raising=False)
    report = runtime_probe.probe_runtime()
    assert report["imports_ok"] == (sys.version_info[:2] == (3, 11))
    assert report["upstream_api_status"] == "unverifiable"
    assert report["upstream_api_compatible"] is False
    assert report["preflight_ok"] is False
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


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"python_311": False, "failed_components": ["torch"]},
         "select_python_311"),
        ({"failed_components": ["numpy", "torch"], "device_valid": False},
         "repair_tts_imports"),
        ({"device_valid": False, "model_valid": False},
         "fix_device_override"),
        ({"model_valid": False, "reference_status": "invalid"},
         "fix_model_selection"),
        ({"reference_status": "invalid", "api_status": "v3_unsupported"},
         "replace_reference_wav"),
        ({"api_status": "v3_unsupported"}, "update_chatterbox_api"),
        ({"api_status": "reference_unsupported"}, "update_chatterbox_api"),
        ({"api_status": "unavailable"}, "update_chatterbox_api"),
        ({"api_status": "unverifiable"}, "verify_chatterbox_api"),
        ({}, "run_real_hindi_smoke"),
    ],
)
def test_next_audio_action_selects_first_safe_repair(
    overrides: dict[str, object], expected: str,
) -> None:
    options: dict[str, object] = {
        "python_311": True,
        "failed_components": [],
        "device_valid": True,
        "model_valid": True,
        "reference_status": "not_set",
        "api_status": "not_requested",
    }
    options.update(overrides)
    action = runtime_probe._next_action_code(**options)
    assert action == expected
    assert action in runtime_probe._NEXT_ACTIONS
    assert runtime_probe._NEXT_ACTIONS[action]


def test_probe_next_action_has_no_private_environment_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private_value = r"C:\\Users\\private\\my-token"
    monkeypatch.setattr(
        runtime_probe.importlib,
        "import_module",
        lambda _name: SimpleNamespace(ChatterboxMultilingualTTS=object()),
    )
    monkeypatch.setenv("KATHASVARA_TTS_DEVICE", private_value)
    monkeypatch.setenv("KATHASVARA_TTS_MODEL", "v2")
    monkeypatch.delenv("KATHASVARA_TTS_REFERENCE_WAV", raising=False)
    report = runtime_probe.probe_runtime()
    if report["python_311"]:
        assert report["next_action_code"] == "fix_device_override"
    else:
        assert report["next_action_code"] == "select_python_311"
    assert report["preflight_ok"] is False
    assert private_value not in str(report)
    assert report["audio_synthesis_verified"] is False
