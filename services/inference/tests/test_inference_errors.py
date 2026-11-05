"""Model-free regression coverage for actionable, privacy-safe engine errors.

No voice weights are loaded, no audio is generated, and no network is accessed.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import errno
import sys
import types
from types import SimpleNamespace

import pytest

from kathasvara.engine import ChatterboxHindi, VoiceSettings
from kathasvara.inference_errors import describe_model_failure


@pytest.mark.parametrize(("error", "hint"), [
    (RuntimeError("CUDA out of memory"), "GPU memory"),
    (OSError(errno.ENOSPC, "No space left on device"), "disk space"),
    (RuntimeError("GatedRepoError: access denied"), "model access"),
    (ConnectionError("network is unreachable"), "network access"),
    (ImportError("DLL load failed while importing torch"), "dependencies"),
])
def test_model_failure_classification_has_actionable_hint(
    error: Exception, hint: str,
) -> None:
    message = describe_model_failure(error, stage="load")
    assert hint in message
    assert "Unable to load the speech model" in message


def test_upstream_error_details_never_leak_to_public_response() -> None:
    private = r"C:\\Users\\Example\\private-model-token.txt"
    text = describe_model_failure(
        RuntimeError("An unexpected error occurred at " + private),
        stage="generate",
    )
    assert private not in text
    assert "No WAV has been verified" in text


def test_unsupported_stage_is_rejected() -> None:
    with pytest.raises(ValueError, match="Unknown"):
        describe_model_failure(RuntimeError("error"), stage="preview")


def test_model_generation_error_is_converted_without_private_message() -> None:
    class FailingModel:
        def generate(self, *args, **kwargs):
            raise RuntimeError("CUDA out of memory: secret=/private/path")

    engine = ChatterboxHindi()
    engine._model = FailingModel()
    with pytest.raises(RuntimeError, match="GPU memory") as caught:
        engine.generate("नमस्कार", VoiceSettings())
    assert "secret=" not in str(caught.value)


def test_model_startup_error_uses_safe_hint(monkeypatch: pytest.MonkeyPatch) -> None:
    class GatedRepoError(Exception):
        pass

    class FakeTTS:
        @staticmethod
        def from_pretrained(*, device: str):
            assert device == "cpu"
            raise GatedRepoError("access denied: account=private")

    torch = types.ModuleType("torch")
    torch.cuda = SimpleNamespace(is_available=lambda: False)
    torch.backends = SimpleNamespace(mps=None)
    chatterbox = types.ModuleType("chatterbox")
    chatterbox.__path__ = []
    multilingual = types.ModuleType("chatterbox.mtl_tts")
    multilingual.ChatterboxMultilingualTTS = FakeTTS
    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setitem(sys.modules, "chatterbox", chatterbox)
    monkeypatch.setitem(sys.modules, "chatterbox.mtl_tts", multilingual)

    engine = ChatterboxHindi()
    with pytest.raises(RuntimeError, match="model access") as caught:
        engine.load()
    assert "account=private" not in str(caught.value)
    assert engine._model is None
