"""Model-free contract regressions for optional local speech-to-text.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path
from types import SimpleNamespace
import wave

import pytest

from kathasvara.local_stt import inspect_stt_wav, transcribe_hindi_wav


def wav_file(root: Path, *, frames: int = 16_000, channels: int = 1) -> Path:
    path = root / "spoken.wav"
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(struct.pack("<h", 250) * frames * channels)
    return path


def model_folder(root: Path) -> Path:
    model = root / "whisper"
    model.mkdir()
    for item in ("config.json", "model.bin", "tokenizer.json"):
        (model / item).write_bytes(b"dummy")
    return model


def test_valid_short_mono_wav_is_inspected_without_model(tmp_path: Path) -> None:
    result = inspect_stt_wav(wav_file(tmp_path))
    assert result["sample_rate"] == 16000
    assert result["duration_seconds"] == 1.0


def test_stt_rejects_invalid_and_oversized_audio(tmp_path: Path) -> None:
    path = wav_file(tmp_path, channels=2)
    with pytest.raises(ValueError, match="mono PCM16"):
        inspect_stt_wav(path)
    path.write_bytes(b"NOT A WAV")
    with pytest.raises(ValueError):
        inspect_stt_wav(path)
    path = wav_file(tmp_path, frames=16000 * 61)
    with pytest.raises(ValueError, match="60 seconds"):
        inspect_stt_wav(path)
    path = tmp_path / "shortcut.wav"
    try:
        path.symlink_to(tmp_path / "spoken.wav")
    except (NotImplementedError, OSError):
        return
    with pytest.raises(ValueError):
        inspect_stt_wav(path)


def test_offline_asr_uses_local_model_and_real_segment_text(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    audio = wav_file(tmp_path)
    folder = model_folder(tmp_path)
    used: list[tuple[str, dict[str, object]]] = []

    class FakeModel:
        def __init__(self, path: str, **kwargs: object) -> None:
            used.append((path, kwargs))

        def transcribe(self, path: str, **kwargs: object) -> tuple[list[object], object]:
            assert path == str(audio)
            assert kwargs["language"] == "hi" and kwargs["task"] == "transcribe"
            return [SimpleNamespace(text=" नमस्ते "), SimpleNamespace(text="भारत")], None

    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=FakeModel))
    result = transcribe_hindi_wav(str(audio), str(folder))
    assert result == {
        "text": "नमस्ते भारत", "language": "hi", "duration_seconds": 1.0,
        "engine": "faster-whisper-local", "speech_detected": True,
        "human_review_required": True, "network_used": False,
    }
    assert used == [(str(folder), {"device": "cpu", "compute_type": "int8",
                                   "local_files_only": True})]


def test_missing_model_fails_before_inference(tmp_path: Path) -> None:
    path = wav_file(tmp_path)
    with pytest.raises(ValueError, match="model folder"):
        transcribe_hindi_wav(str(path), str(tmp_path / "missing"))


def test_rejects_untrusted_model_results(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = wav_file(tmp_path)
    model = model_folder(tmp_path)

    class FakeModel:
        def __init__(self, *_: object, **__: object) -> None:
            pass

        def transcribe(self, *_: object, **__: object) -> tuple[list[object], None]:
            return [SimpleNamespace(text="secret\x00path")], None

    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=FakeModel))
    with pytest.raises(ValueError, match="invalid transcription"):
        transcribe_hindi_wav(str(path), str(model))
