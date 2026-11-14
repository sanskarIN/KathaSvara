"""Model-free contract regressions for optional local speech-to-text.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import struct
import sys
import wave
from pathlib import Path
from types import SimpleNamespace

import pytest

from kathasvara.local_stt import inspect_stt_setup, inspect_stt_wav, transcribe_hindi_wav


def wav_file(root: Path, *, frames: int = 16_000, channels: int = 1) -> Path:
    path = root / "spoken.wav"
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        # Varying mono PCM16 signal rather than a constant DC-only buffer.
        wav.writeframes((struct.pack("<h", 250) + struct.pack("<h", -250))
                        * (frames * channels // 2)
                        + (struct.pack("<h", 250) if frames * channels % 2 else b""))
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
    assert result["model_loaded"] is False
    assert result["audio_transcribed"] is False
    assert result["network_used"] is False
    assert result["near_silence_hint"] is False
    assert result["dc_only_hint"] is False
    assert result["signal_review_required"] is False


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


def test_model_free_wav_probe_identifies_silence_dc_and_clipping(tmp_path: Path) -> None:
    path = wav_file(tmp_path)
    # Complete digital silence is a warning before model loading.
    path.write_bytes(path.read_bytes()[:44] + bytes(16_000 * 2))
    silence = inspect_stt_wav(path)
    assert silence["near_silence_hint"] is True
    assert silence["signal_review_required"] is True
    assert silence["network_used"] is False

    # A loud constant offset can pass naïve RMS/peak tests but has no speech AC.
    path.write_bytes(path.read_bytes()[:44] + struct.pack("<h", 8000) * 16_000)
    dc = inspect_stt_wav(path)
    assert dc["dc_only_hint"] is True
    assert dc["near_silence_hint"] is False

    path.write_bytes(path.read_bytes()[:44] +
                     (struct.pack("<h", 32767) + struct.pack("<h", -32768)) * 8000)
    clipped = inspect_stt_wav(path)
    assert clipped["possible_clipping_hint"] is True
    assert clipped["signal_review_required"] is True


def test_stt_refuses_silent_and_dc_audio_before_loading_model(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = wav_file(tmp_path)
    model = model_folder(tmp_path)
    monkeypatch.setitem(sys.modules, "faster_whisper", None)
    for sample in (0, 8000):
        path.write_bytes(path.read_bytes()[:44] + struct.pack("<h", sample) * 16_000)
        with pytest.raises(ValueError, match="no usable speech-level signal"):
            transcribe_hindi_wav(str(path), str(model))


def test_stt_strict_riff_validation_rejects_extra_chunks(tmp_path: Path) -> None:
    path = wav_file(tmp_path)
    altered = bytearray(path.read_bytes())
    altered.extend(b"data" + (2).to_bytes(4, "little") + bytes(2))
    altered[4:8] = (len(altered) - 8).to_bytes(4, "little")
    path.write_bytes(altered)
    with pytest.raises(ValueError, match="not a readable PCM16 WAV"):
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


@pytest.mark.parametrize("when", ["model_load", "transcription"])
def test_stt_rejects_recording_replaced_during_inference(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, when: str,
) -> None:
    """A recognized transcript must belong to the WAV the user inspected."""
    audio = wav_file(tmp_path)
    model = model_folder(tmp_path)
    called: list[str] = []

    def change_audio() -> None:
        # Change a single PCM sample without altering valid RIFF structure,
        # file length, rate or duration. Metadata-only comparisons miss this.
        content = bytearray(audio.read_bytes())
        content[44:46] = struct.pack("<h", 1200)
        audio.write_bytes(content)

    class FakeModel:
        def __init__(self, *_: object, **__: object) -> None:
            called.append("load")
            if when == "model_load":
                change_audio()

        def transcribe(self, *_: object, **__: object) -> tuple[list[object], None]:
            called.append("transcribe")
            if when == "transcription":
                change_audio()
            return [SimpleNamespace(text="नमस्ते")], None

    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=FakeModel))
    with pytest.raises(ValueError, match="Recording changed during offline transcription"):
        transcribe_hindi_wav(str(audio), str(model))
    assert called == (["load"] if when == "model_load" else ["load", "transcribe"])


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


def test_stt_setup_probe_does_not_load_model_or_use_network(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    model = model_folder(tmp_path)
    calls: list[str] = []

    class LocalWhisper:
        def __init__(self, *_: object, **__: object) -> None:
            raise AssertionError("A readiness check must never load model weights.")

    def import_probe(name: str) -> object:
        calls.append(name)
        assert name == "faster_whisper"
        return SimpleNamespace(WhisperModel=LocalWhisper)

    monkeypatch.setattr("kathasvara.local_stt.importlib.import_module", import_probe)
    report = inspect_stt_setup(str(model))
    assert calls == ["faster_whisper"]
    assert report["stt_import_ok"] is True
    assert report["model_files_present"] is True
    assert report["ready_to_transcribe"] == (sys.version_info[:2] == (3, 11))
    assert report["model_loaded"] is False
    assert report["audio_transcribed"] is False
    assert report["network_used"] is False


@pytest.mark.parametrize("empty_name", ["config.json", "model.bin", "tokenizer.json"])
def test_stt_setup_rejects_zero_byte_model_placeholders_before_loading_weights(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, empty_name: str,
) -> None:
    model = model_folder(tmp_path)
    (model / empty_name).write_bytes(b"")
    wav = wav_file(tmp_path)

    class MustNotLoad:
        def __init__(self, *_: object, **__: object) -> None:
            raise AssertionError("An incomplete model must fail before loading weights.")

    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=MustNotLoad))
    report = inspect_stt_setup(str(model))
    assert report["model_files_present"] is False
    assert report["ready_to_transcribe"] is False
    assert report["model_loaded"] is False
    assert report["network_used"] is False

    with pytest.raises(ValueError, match="nonempty config.json"):
        transcribe_hindi_wav(str(wav), str(model))


def test_stt_setup_reports_absent_package_or_model_without_private_paths(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    def no_package(_: str) -> object:
        raise OSError("C:\\Users\\private\\missing_library.dll")

    monkeypatch.setattr("kathasvara.local_stt.importlib.import_module", no_package)
    report = inspect_stt_setup(str(tmp_path / "secret-model"))
    assert report["stt_import_ok"] is False
    assert report["model_files_present"] is False
    assert report["ready_to_transcribe"] is False
    assert report["network_used"] is False
    assert "private" not in str(report) and "secret-model" not in str(report)
    assert report["next_action_code"] in {"select_python_311", "install_stt_extra"}
