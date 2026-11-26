"""Model-free contract regressions for optional local speech-to-text.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import hashlib
import io
import struct
import sys
import wave
from pathlib import Path
from types import SimpleNamespace

import pytest

from kathasvara.local_stt import (
    MAX_STT_WAV_BYTES,
    _read_verified_stt_snapshot,
    inspect_stt_setup,
    inspect_stt_wav,
    transcribe_hindi_wav,
)


def wav_file(root: Path, *, frames: int = 16_000, channels: int = 1,
             sample_rate: int = 16_000) -> Path:
    path = root / "spoken.wav"
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
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


@pytest.mark.parametrize("rate", [8_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000])
def test_valid_short_mono_wav_is_inspected_without_model(tmp_path: Path, rate: int) -> None:
    result = inspect_stt_wav(wav_file(tmp_path, frames=rate, sample_rate=rate))
    assert result["sample_rate"] == rate
    assert result["duration_seconds"] == 1.0
    assert result["model_loaded"] is False
    assert result["audio_transcribed"] is False
    assert result["network_used"] is False
    assert result["near_silence_hint"] is False
    assert result["dc_only_hint"] is False
    assert result["signal_review_required"] is False


@pytest.mark.parametrize("rate", [11_025, 96_000])
def test_stt_rejects_unsupported_rate_without_loading_a_model(tmp_path: Path, rate: int) -> None:
    path = wav_file(tmp_path, frames=rate, sample_rate=rate)
    with pytest.raises(ValueError, match="mono PCM16 WAV audio of 60 seconds"):
        inspect_stt_wav(path)


@pytest.mark.parametrize("rate", [8_000, 22_050, 44_100, 48_000])
def test_one_pcm_frame_has_precise_nonzero_duration(tmp_path: Path, rate: int) -> None:
    # The shared signal inspector rounds milliseconds, but STT's native
    # contract explicitly allows one frame and needs a positive duration.
    result = inspect_stt_wav(wav_file(tmp_path, frames=1, sample_rate=rate))
    assert result["frames"] == 1
    assert result["sample_rate"] == rate
    assert result["duration_seconds"] > 0
    assert result["duration_seconds"] == pytest.approx(1 / rate)
    assert result["model_loaded"] is False
    assert result["network_used"] is False


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


@pytest.mark.parametrize("rate", [16_000, 44_100])
def test_offline_asr_uses_local_model_and_real_segment_text(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, rate: int,
) -> None:
    audio = wav_file(tmp_path, frames=rate, sample_rate=rate)
    folder = model_folder(tmp_path)
    used: list[tuple[str, dict[str, object]]] = []

    class FakeModel:
        def __init__(self, path: str, **kwargs: object) -> None:
            used.append((path, kwargs))
            self.model = SimpleNamespace(is_multilingual=True)

        def transcribe(self, source: io.BytesIO, **kwargs: object) -> tuple[list[object], object]:
            assert isinstance(source, io.BytesIO)
            assert source.read() == audio.read_bytes()
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
            self.model = SimpleNamespace(is_multilingual=True)
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


@pytest.mark.parametrize("multilingual", [False, None])
def test_stt_refuses_english_only_or_unverifiable_hindi_model(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, multilingual: bool | None,
) -> None:
    """Never let faster-whisper silently reinterpret a Hindi request as English."""
    audio = wav_file(tmp_path)
    folder = model_folder(tmp_path)
    calls: list[str] = []

    class FakeModel:
        def __init__(self, *_: object, **__: object) -> None:
            self.model = SimpleNamespace(is_multilingual=multilingual)
            calls.append("load")

        def transcribe(self, *_: object, **__: object) -> None:
            calls.append("transcribe")
            raise AssertionError("An incompatible model must not transcribe")

    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=FakeModel))
    with pytest.raises(ValueError, match="Hindi support could not be verified"):
        transcribe_hindi_wav(str(audio), str(folder))
    assert calls == ["load"]


def test_missing_model_fails_before_inference(tmp_path: Path) -> None:
    path = wav_file(tmp_path)
    with pytest.raises(ValueError, match="model folder"):
        transcribe_hindi_wav(str(path), str(tmp_path / "missing"))


@pytest.mark.parametrize("code_point", [
    0x00, 0x80, 0x00AD, 0x034F, 0x061C, 0x200B, 0x200E, 0x200F,
    0x202A, 0x202E, 0x2060, 0x2066, 0x2069, 0x206A, 0x206F, 0xFEFF,
    0xD800, 0xDFFF,  # lone surrogates must not reach UTF-8 JSON/export
])
def test_rejects_untrusted_model_results(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, code_point: int,
) -> None:
    path = wav_file(tmp_path)
    model = model_folder(tmp_path)

    class FakeModel:
        def __init__(self, *_: object, **__: object) -> None:
            self.model = SimpleNamespace(is_multilingual=True)

        def transcribe(self, *_: object, **__: object) -> tuple[list[object], None]:
            return [SimpleNamespace(text="नमस्ते" + chr(code_point) + "भारत")], None

    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=FakeModel))
    with pytest.raises(ValueError, match="invalid transcription"):
        transcribe_hindi_wav(str(path), str(model))


def test_indic_joiners_and_devanagari_marks_remain_valid_in_transcripts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Legitimate Hindi conjuncts need ZWNJ/ZWJ; do not over-sanitize them."""
    path = wav_file(tmp_path)
    model = model_folder(tmp_path)
    words = "क्" + chr(0x200D) + "षत्रिय क्" + chr(0x200C) + "ष हिंदी" + " 🎙️"

    class FakeModel:
        def __init__(self, *_: object, **__: object) -> None:
            self.model = SimpleNamespace(is_multilingual=True)

        def transcribe(self, *_: object, **__: object) -> tuple[list[object], None]:
            return [SimpleNamespace(text=words)], None

    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=FakeModel))
    result = transcribe_hindi_wav(str(path), str(model))
    assert result["text"] == words
    assert result["speech_detected"] is True


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

@pytest.mark.parametrize(("segment_lengths", "allowed"), [
    ((8000,), True),
    ((4000, 3999), True),  # One actual joining space: exactly 8000 chars.
    ((4000, 4000), False),  # One joining space makes 8001.
    ((8001,), False),
    ((4000, 0, 3999), True),  # Empty segments add no separator.
])
def test_transcript_limit_counts_only_emitted_text_and_spaces(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    segment_lengths: tuple[int, ...], allowed: bool,
) -> None:
    """Prevent off-by-one rejection of valid Hindi at the review limit."""
    audio = wav_file(tmp_path)
    folder = model_folder(tmp_path)
    texts = ["क" * count for count in segment_lengths]

    class FakeModel:
        def __init__(self, *_: object, **__: object) -> None:
            self.model = SimpleNamespace(is_multilingual=True)

        def transcribe(self, *_: object, **__: object) -> tuple[list[object], None]:
            return [SimpleNamespace(text=text) for text in texts], None

    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=FakeModel))
    if allowed:
        result = transcribe_hindi_wav(str(audio), str(folder))
        assert result["text"] == " ".join(text for text in texts if text)
        assert len(result["text"]) == 8000
        assert result["network_used"] is False
        assert result["human_review_required"] is True
    else:
        with pytest.raises(ValueError, match="8000-character review limit"):
            transcribe_hindi_wav(str(audio), str(folder))


@pytest.mark.parametrize("change", ["different_bytes", "missing", "directory", "oversize"])
def test_verified_stt_snapshot_rejects_changed_input(tmp_path: Path, change: str) -> None:
    audio = wav_file(tmp_path)
    digest = hashlib.sha256(audio.read_bytes()).hexdigest()
    if change == "different_bytes":
        altered = bytearray(audio.read_bytes())
        altered[44:46] = struct.pack("<h", 700)
        audio.write_bytes(altered)
    elif change == "missing":
        audio.unlink()
    elif change == "directory":
        audio.unlink()
        audio.mkdir()
    else:
        with audio.open("ab") as stream:
            stream.truncate(MAX_STT_WAV_BYTES + 1)

    with pytest.raises(ValueError, match="Recording changed during offline transcription"):
        _read_verified_stt_snapshot(audio, digest)


def test_verified_stt_snapshot_rejects_symlink_to_identical_recording(tmp_path: Path) -> None:
    audio = wav_file(tmp_path)
    digest = hashlib.sha256(audio.read_bytes()).hexdigest()
    other = tmp_path / "other.wav"
    audio.rename(other)
    try:
        audio.symlink_to(other)
    except (NotImplementedError, OSError):
        pytest.skip("Symbolic links are unavailable on this runner.")
    with pytest.raises(ValueError, match="Recording changed during offline transcription"):
        _read_verified_stt_snapshot(audio, digest)


def test_verified_stt_snapshot_is_exact_and_independent_of_later_edits(tmp_path: Path) -> None:
    audio = wav_file(tmp_path)
    original = audio.read_bytes()
    snapshot = _read_verified_stt_snapshot(audio, hashlib.sha256(original).hexdigest())
    audio.write_bytes(b"replacement")
    assert type(snapshot) is bytes
    assert snapshot == original


def test_stt_decoder_cannot_read_transient_replacement(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Even a replace/restore during lazy decoding cannot alter the input stream."""
    audio = wav_file(tmp_path)
    folder = model_folder(tmp_path)
    original = audio.read_bytes()
    replacement = bytearray(original)
    replacement[44:46] = struct.pack("<h", 700)
    observed: list[io.BytesIO] = []

    class FakeModel:
        def __init__(self, *_: object, **__: object) -> None:
            self.model = SimpleNamespace(is_multilingual=True)

        def transcribe(self, source: io.BytesIO, **_: object):
            observed.append(source)

            def lazy_segments():
                audio.write_bytes(replacement)
                try:
                    assert source.read() == original
                    assert not source.closed
                    yield SimpleNamespace(text="नमस्ते")
                finally:
                    audio.write_bytes(original)

            return lazy_segments(), None

    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=FakeModel))
    result = transcribe_hindi_wav(str(audio), str(folder))
    assert result["text"] == "नमस्ते"
    assert observed[0].closed
    assert audio.read_bytes() == original


def test_stt_closes_snapshot_stream_on_lazy_recognition_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    audio = wav_file(tmp_path)
    folder = model_folder(tmp_path)
    observed: list[io.BytesIO] = []

    class FakeModel:
        def __init__(self, *_: object, **__: object) -> None:
            self.model = SimpleNamespace(is_multilingual=True)

        def transcribe(self, source: io.BytesIO, **_: object):
            observed.append(source)

            def lazy_segments():
                yield SimpleNamespace(text="नमस्ते")
                raise RuntimeError("Private decoder error")

            return lazy_segments(), None

    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=FakeModel))
    with pytest.raises(RuntimeError, match="Local STT inference failed"):
        transcribe_hindi_wav(str(audio), str(folder))
    assert observed[0].closed


def test_stt_snapshot_failure_precedes_optional_model_loading(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    audio = wav_file(tmp_path)
    folder = model_folder(tmp_path)

    def reject_snapshot(*_: object) -> bytes:
        raise ValueError("Recording changed during offline transcription")

    class MustNotLoad:
        def __init__(self, *_: object, **__: object) -> None:
            pytest.fail("The local model must not load after a snapshot failure.")

    monkeypatch.setattr("kathasvara.local_stt._read_verified_stt_snapshot", reject_snapshot)
    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=MustNotLoad))
    with pytest.raises(ValueError, match="Recording changed during offline transcription"):
        transcribe_hindi_wav(str(audio), str(folder))


def test_recognition_only_runs_expensive_signal_inspection_once(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from kathasvara import local_stt

    audio = wav_file(tmp_path)
    folder = model_folder(tmp_path)
    original_inspector = local_stt.inspect_wav_candidate
    inspected: list[Path] = []

    def inspect(path: Path):
        inspected.append(path)
        return original_inspector(path)

    class FakeModel:
        def __init__(self, *_: object, **__: object):
            self.model = SimpleNamespace(is_multilingual=True)

        def transcribe(self, *_: object, **__: object):
            return [SimpleNamespace(text="नमस्ते भारत")], None

    monkeypatch.setattr(local_stt, "inspect_wav_candidate", inspect)
    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=FakeModel))
    result = transcribe_hindi_wav(str(audio), str(folder))
    assert result["text"] == "नमस्ते भारत"
    assert inspected == [audio]


@pytest.mark.parametrize("when", ["load", "transcribe", "lazy_segment"])
@pytest.mark.parametrize("error_type", [ValueError, TypeError, RuntimeError])
def test_model_owned_errors_are_redacted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, when: str, error_type: type[Exception],
) -> None:
    audio = wav_file(tmp_path)
    folder = model_folder(tmp_path)
    private_error = "Private model failure: " + str(folder)

    class FakeModel:
        def __init__(self, *_: object, **__: object):
            if when == "load":
                raise error_type(private_error)
            self.model = SimpleNamespace(is_multilingual=True)

        def transcribe(self, *_: object, **__: object):
            if when == "transcribe":
                raise error_type(private_error)

            def segments():
                yield SimpleNamespace(text="नमस्ते")
                raise error_type(private_error)

            return segments(), None

    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=FakeModel))
    with pytest.raises(RuntimeError, match="Local STT inference failed") as caught:
        transcribe_hindi_wav(str(audio), str(folder))
    assert str(folder) not in str(caught.value)
    assert "Private model failure" not in str(caught.value)


def test_snapshot_refuses_oversized_file_before_open(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from kathasvara import local_stt

    audio = wav_file(tmp_path)
    digest = hashlib.sha256(audio.read_bytes()).hexdigest()
    with audio.open("ab") as stream:
        stream.truncate(MAX_STT_WAV_BYTES + 1)

    def unexpected(*_args, **_kwargs):
        pytest.fail("Oversized recording must not be opened")

    monkeypatch.setattr(local_stt.os, "open", unexpected)
    with pytest.raises(ValueError, match="Recording changed"):
        _read_verified_stt_snapshot(audio, digest)


def test_revalidation_detects_growth_after_model_load_without_signal_rescan(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from kathasvara import local_stt

    audio = wav_file(tmp_path)
    folder = model_folder(tmp_path)
    inspector = local_stt.inspect_wav_candidate
    calls = []

    def inspect(path: Path):
        calls.append(path)
        assert len(calls) == 1
        return inspector(path)

    class FakeModel:
        def __init__(self, *_: object, **__: object):
            self.model = SimpleNamespace(is_multilingual=True)
            with audio.open("ab") as stream:
                stream.truncate(MAX_STT_WAV_BYTES + 1)

        def transcribe(self, *_: object, **__: object):
            pytest.fail("Changed recording must not be transcribed")

    monkeypatch.setattr(local_stt, "inspect_wav_candidate", inspect)
    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=FakeModel))
    with pytest.raises(ValueError, match="Recording changed"):
        transcribe_hindi_wav(str(audio), str(folder))
    assert calls == [audio]
