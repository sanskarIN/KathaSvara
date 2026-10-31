"""Model-free regression coverage for the opt-in CPU-only TTS runtime.

No torch packages, pretrained weights or audio generation are used.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import sys
import types
from types import SimpleNamespace

import pytest

from kathasvara.engine import ChatterboxHindi
from kathasvara.public_errors import public_error_message


def _install_fake_runtime(
    monkeypatch: pytest.MonkeyPatch, *,
    cuda_available: bool,
    mps_available: bool,
    fail_gpu_probe: bool = False,
) -> list[str]:
    selected: list[str] = []

    def probe_cuda() -> bool:
        if fail_gpu_probe:
            raise OSError("GPU probe crashed at C:/Users/private/driver.dll")
        return cuda_available

    def probe_mps() -> bool:
        if fail_gpu_probe:
            raise OSError("MPS probe failed")
        return mps_available

    def from_pretrained(*, device: str) -> object:
        selected.append(device)
        return SimpleNamespace(sr=24_000)

    torch = types.ModuleType("torch")
    torch.cuda = SimpleNamespace(is_available=probe_cuda)
    torch.backends = SimpleNamespace(mps=SimpleNamespace(is_available=probe_mps))
    chatterbox = types.ModuleType("chatterbox")
    chatterbox.__path__ = []
    multilingual = types.ModuleType("chatterbox.mtl_tts")
    multilingual.ChatterboxMultilingualTTS = SimpleNamespace(
        from_pretrained=from_pretrained,
    )
    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setitem(sys.modules, "chatterbox", chatterbox)
    monkeypatch.setitem(sys.modules, "chatterbox.mtl_tts", multilingual)
    return selected


def test_cpu_override_skips_broken_gpu_driver_probes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("KATHASVARA_TTS_DEVICE", "cpu")
    selected = _install_fake_runtime(
        monkeypatch, cuda_available=False, mps_available=False,
        fail_gpu_probe=True,
    )
    adapter = ChatterboxHindi()
    adapter.load()
    assert selected == ["cpu"]
    assert adapter.sample_rate == 24_000


@pytest.mark.parametrize(("cuda", "mps", "expected"), [
    (True, False, "cuda"),
    (False, True, "mps"),
    (False, False, "cpu"),
])
def test_default_device_selection_is_unchanged(
    monkeypatch: pytest.MonkeyPatch, cuda: bool, mps: bool, expected: str,
) -> None:
    monkeypatch.setenv("KATHASVARA_TTS_DEVICE", "auto")
    selected = _install_fake_runtime(
        monkeypatch, cuda_available=cuda, mps_available=mps,
    )
    ChatterboxHindi().load()
    assert selected == [expected]


@pytest.mark.parametrize("invalid", ["cuda", "mps", "random", "cpu;rm -rf /"])
def test_invalid_device_override_is_safe_and_does_not_load_weights(
    monkeypatch: pytest.MonkeyPatch, invalid: str,
) -> None:
    monkeypatch.setenv("KATHASVARA_TTS_DEVICE", invalid)
    selected = _install_fake_runtime(
        monkeypatch, cuda_available=False, mps_available=False,
    )
    with pytest.raises(RuntimeError, match="Unsupported TTS device override") as caught:
        ChatterboxHindi().load()
    assert selected == []
    assert public_error_message(caught.value) == str(caught.value)
    assert invalid not in str(caught.value)


def test_cpu_device_override_accepts_case_and_whitespace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("KATHASVARA_TTS_DEVICE", " CPU ")
    selected = _install_fake_runtime(
        monkeypatch, cuda_available=True, mps_available=True,
        fail_gpu_probe=True,
    )
    ChatterboxHindi().load()
    assert selected == ["cpu"]
