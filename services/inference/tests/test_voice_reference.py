"""Synthetic model-free tests for safe, opt-in local reference WAV usage.

These clips are generated numerical fixtures, not real speakers or verified
Hindi audio; they are never uploaded or used for model training.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import hashlib
import sys
import types
import wave
from pathlib import Path
from types import SimpleNamespace

import pytest

from kathasvara.engine import ChatterboxHindi, VoiceSettings
from kathasvara.public_errors import public_error_message
from kathasvara.voice_reference import REFERENCE_ERROR, inspect_reference_wav


def make_reference(path: Path, *, value: int = 1000, seconds: int = 3) -> None:
    frame = value.to_bytes(2, "little", signed=True)
    with wave.open(str(path), "wb") as recording:
        recording.setnchannels(1)
        recording.setsampwidth(2)
        recording.setframerate(24_000)
        recording.writeframes(frame * (24_000 * seconds))


def install_fake_tts(
    monkeypatch: pytest.MonkeyPatch, *,
    has_builtin_voice: bool,
) -> tuple[list[str], list[dict[str, object]]]:
    loads: list[str] = []
    requests: list[dict[str, object]] = []
    torch = types.ModuleType("torch")
    torch.cuda = SimpleNamespace(is_available=lambda: False)
    torch.backends = SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False))
    chatterbox = types.ModuleType("chatterbox")
    chatterbox.__path__ = []
    multilingual = types.ModuleType("chatterbox.mtl_tts")

    def from_pretrained(*, device: str, t3_model: str | None = None) -> object:
        loads.append(f"{device}:{t3_model or 'v2'}")

        def generate(_text: str, **options: object) -> object:
            requests.append(options)
            return object()

        return SimpleNamespace(
            sr=24_000,
            conds=object() if has_builtin_voice else None,
            generate=generate,
        )

    multilingual.ChatterboxMultilingualTTS = SimpleNamespace(
        from_pretrained=from_pretrained,
    )
    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setitem(sys.modules, "chatterbox", chatterbox)
    monkeypatch.setitem(sys.modules, "chatterbox.mtl_tts", multilingual)
    monkeypatch.setenv("KATHASVARA_TTS_DEVICE", "cpu")
    monkeypatch.setenv("KATHASVARA_TTS_MODEL", "v2")
    return loads, requests


def test_reference_sha_tracks_contents_not_path(tmp_path: Path) -> None:
    a = tmp_path / "first.wav"
    b = tmp_path / "second.wav"
    make_reference(a)
    b.write_bytes(a.read_bytes())
    assert inspect_reference_wav(a) == inspect_reference_wav(b)
    assert inspect_reference_wav(a) == hashlib.sha256(a.read_bytes()).hexdigest()
    make_reference(b, value=500)
    assert inspect_reference_wav(b) != inspect_reference_wav(a)


@pytest.mark.parametrize("bad", ["missing", "relative", "text", "short", "truncated"])
def test_invalid_reference_never_leaks_file_path(
    tmp_path: Path, bad: str,
) -> None:
    target = tmp_path / "private-voice.wav"
    if bad == "relative":
        target = Path("relative.wav")
    elif bad == "text":
        target.write_text("not a valid wav", encoding="utf-8")
    elif bad == "short":
        make_reference(target, seconds=1)
    elif bad == "truncated":
        make_reference(target)
        target.write_bytes(target.read_bytes()[:1024])
    with pytest.raises(ValueError) as caught:
        inspect_reference_wav(target)
    assert str(caught.value) == REFERENCE_ERROR
    assert "private-voice.wav" not in str(caught.value)


def test_silent_voice_reference_is_rejected(tmp_path: Path) -> None:
    silent = tmp_path / "silent.wav"
    make_reference(silent, value=0)
    with pytest.raises(ValueError, match="Reference voice WAV is invalid"):
        inspect_reference_wav(silent)


def test_sparse_spike_voice_reference_is_rejected(tmp_path: Path) -> None:
    filename = tmp_path / "spike.wav"
    make_reference(filename, value=0)
    raw = bytearray(filename.read_bytes())
    # Change one PCM16 sample while leaving the WAV header intact.
    raw[44:46] = (50).to_bytes(2, "little", signed=True)
    filename.write_bytes(raw)
    with pytest.raises(ValueError, match="Reference voice WAV is invalid"):
        inspect_reference_wav(filename)


def test_reference_symlink_not_followed(tmp_path: Path) -> None:
    original = tmp_path / "original.wav"
    link = tmp_path / "reference.wav"
    make_reference(original)
    try:
        link.symlink_to(original)
    except (OSError, NotImplementedError):
        pytest.skip("Symlink creation unavailable on this filesystem")
    with pytest.raises(ValueError, match="Reference voice WAV is invalid"):
        inspect_reference_wav(link)


def test_missing_default_conditioning_is_diagnosed_before_generation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("KATHASVARA_TTS_REFERENCE_WAV", raising=False)
    loads, requests = install_fake_tts(monkeypatch, has_builtin_voice=False)
    with pytest.raises(RuntimeError, match="no built-in voice conditioning") as caught:
        ChatterboxHindi().load()
    assert loads == ["cpu:v2"]
    assert requests == []
    assert public_error_message(caught.value) == str(caught.value)


def test_consent_reference_is_only_read_on_first_chunk_and_never_in_fingerprint(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    path = tmp_path / "my-private-speech.wav"
    make_reference(path)
    monkeypatch.setenv("KATHASVARA_TTS_REFERENCE_WAV", str(path))
    loads, requests = install_fake_tts(monkeypatch, has_builtin_voice=False)
    model = ChatterboxHindi()
    model.load()
    assert loads == ["cpu:v2"]
    assert model.conditioning_fingerprint == (
        "reference-sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()
    )
    assert str(path) not in model.conditioning_fingerprint
    model.generate("नमस्कार।", VoiceSettings())
    model.generate("यह अगला वाक्य है।", VoiceSettings())
    assert requests[0]["audio_prompt_path"] == str(path)
    assert "audio_prompt_path" not in requests[1]
    assert requests[0]["language_id"] == requests[1]["language_id"] == "hi"


def test_bad_reference_is_rejected_before_model_download(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    filename = tmp_path / "not-a-valid-recording.wav"
    filename.write_bytes(b"private data")
    monkeypatch.setenv("KATHASVARA_TTS_REFERENCE_WAV", str(filename))
    loads, _ = install_fake_tts(monkeypatch, has_builtin_voice=True)
    with pytest.raises(ValueError) as caught:
        ChatterboxHindi().load()
    assert loads == []
    assert str(caught.value) == REFERENCE_ERROR
    assert public_error_message(caught.value) == REFERENCE_ERROR
