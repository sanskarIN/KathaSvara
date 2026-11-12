"""Offline Hindi speech-to-text for short, user-selected WAV recordings.

STT is separate from Chatterbox TTS; the app never accesses a microphone,
downloads a model, or uploads the recording in this path.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import importlib
import stat
import sys
from pathlib import Path

from .wav_acceptance import inspect_wav_candidate

MAX_STT_WAV_BYTES = 6 * 1024 * 1024
MAX_STT_SECONDS = 60
MAX_TRANSCRIPT_CHARS = 8_000
MODEL_FILES = ("config.json", "model.bin", "tokenizer.json")


def inspect_stt_wav(path: Path) -> dict[str, object]:
    """Inspect only bounded local PCM16 audio; do not load recognition weights.

    Reuse the structural and streamed signal inspector from WAV acceptance:
    plain wave.open() alone can accept duplicate/trailing RIFF chunks or a
    truncated/misleading header that the recognition decoder reads differently.
    The returned fixed-shape hints contain no WAV path, digest or transcript.
    """
    if not path.is_absolute() or path.suffix.lower() != ".wav":
        raise ValueError("Select an absolute local PCM16 WAV recording.")
    try:
        metadata = path.lstat()
        if not stat.S_ISREG(metadata.st_mode) or not 44 <= metadata.st_size <= MAX_STT_WAV_BYTES:
            raise ValueError("Select a regular PCM16 WAV under 6 MiB.")
        report = inspect_wav_candidate(path)
    except OSError as exc:
        raise ValueError("Selected recording is not a readable PCM16 WAV.") from exc
    except ValueError as exc:
        # Only our own bounded errors leave this function; third-party
        # decoder/file details never cross the desktop JSON boundary.
        if str(exc) == "Select a regular PCM16 WAV under 6 MiB.":
            raise
        if str(exc) == "Expected mono PCM16 WAV of at most 20 minutes.":
            raise ValueError("Use mono PCM16 WAV audio of 60 seconds or less.") from exc
        raise ValueError("Selected recording is not a readable PCM16 WAV.") from exc

    sample_rate = report["sample_rate_hz"]
    frames = report["frames"]
    if sample_rate not in (8_000, 16_000, 24_000, 48_000) or frames > sample_rate * MAX_STT_SECONDS:
        raise ValueError("Use mono PCM16 WAV audio of 60 seconds or less.")
    hints = report["level_hints"]
    quiet = bool(hints["near_silence_hint"])
    dc_only = bool(hints["dc_only_hint"])
    clipping = bool(hints["possible_clipping_hint"])
    long_pause = bool(hints["long_internal_pause_hint"])
    return {
        "sample_rate": sample_rate,
        "frames": frames,
        "duration_seconds": report["duration_seconds"],
        "near_silence_hint": quiet,
        "dc_only_hint": dc_only,
        "possible_clipping_hint": clipping,
        "long_internal_pause_hint": long_pause,
        "signal_review_required": quiet or dc_only or clipping or long_pause,
        "model_loaded": False,
        "audio_transcribed": False,
        "network_used": False,
    }


def verify_local_model_folder(model_folder: Path) -> None:
    """Accept only local CTranslate2 model directories, never a Hub model ID."""
    if not model_folder.is_absolute() or not model_folder.is_dir() or model_folder.is_symlink():
        raise ValueError("Choose a local faster-whisper model folder before transcribing.")
    for name in MODEL_FILES:
        file = model_folder / name
        # Names alone are insufficient: an interrupted local model copy can
        # leave zero-byte placeholders that incorrectly passed STT preflight.
        # Do not load weights or read model data here; even a nonempty file
        # is still only a setup hint, never evidence of a working model.
        try:
            valid = file.is_file() and not file.is_symlink() and file.stat().st_size > 0
        except OSError:
            valid = False
        if not valid:
            raise ValueError(
                "Local STT model is incomplete. Provide nonempty config.json, model.bin and tokenizer.json."
            )



def inspect_stt_setup(model_path: str | None = None) -> dict[str, object]:
    """Check interpreter, local package import and model files, never load weights.

    The response is a fixed, privacy-safe readiness *hint*, not an assertion
    that a model works, the audio decodes or the transcript is intelligible.
    """
    python_311 = sys.version_info[:2] == (3, 11)
    import_ok = False
    try:
        module = importlib.import_module("faster_whisper")
        import_ok = callable(getattr(module, "WhisperModel", None))
    except Exception:  # noqa: BLE001 - optional native DLL imports can fail
        import_ok = False
    model_files_present = False
    if isinstance(model_path, str) and model_path:
        try:
            verify_local_model_folder(Path(model_path))
            model_files_present = True
        except (ValueError, OSError):
            model_files_present = False
    ready = python_311 and import_ok and model_files_present
    next_action = (
        "select_python_311" if not python_311
        else "install_stt_extra" if not import_ok
        else "select_local_model" if not model_files_present
        else "run_transcription"
    )
    return {
        "python_311": python_311,
        "stt_import_ok": import_ok,
        "model_files_present": model_files_present,
        "ready_to_transcribe": ready,
        "next_action_code": next_action,
        "model_loaded": False,
        "audio_transcribed": False,
        "network_used": False,
    }


def transcribe_hindi_wav(wav_path: str, model_path: str) -> dict[str, object]:
    """Run actual offline ASR; never return a synthetic or placeholder transcript."""
    if not isinstance(wav_path, str) or not isinstance(model_path, str):
        raise TypeError("Select a WAV file and local STT model folder.")
    recording = Path(wav_path)
    model_folder = Path(model_path)
    info = inspect_stt_wav(recording)
    # Refuse effectively silent and DC-only recordings before constructing a
    # resource-heavy model; on silence Whisper can invent plausible words.
    if info["near_silence_hint"] or info["dc_only_hint"]:
        raise ValueError(
            "Recording has no usable speech-level signal. Check microphone input and try again."
        )
    verify_local_model_folder(model_folder)
    try:
        from faster_whisper import WhisperModel
    except (ImportError, OSError) as exc:
        raise RuntimeError(
            "Offline transcription is unavailable. Install the optional STT Python dependencies."
        ) from exc
    try:
        model = WhisperModel(str(model_folder), device="cpu", compute_type="int8",
                             local_files_only=True)
        segments, _ = model.transcribe(str(recording), language="hi", task="transcribe",
                                        beam_size=3, vad_filter=False)
        pieces: list[str] = []
        length = 0
        for index, segment in enumerate(segments):
            if index >= 200:
                raise ValueError("Transcription exceeds the 200-segment review limit.")
            text = segment.text
            if not isinstance(text, str) or any(ord(ch) < 32 and ch not in "\n\t" for ch in text):
                raise ValueError("Speech model produced invalid transcription text.")
            cleaned = text.strip()
            if cleaned:
                length += len(cleaned) + 1
                if length > MAX_TRANSCRIPT_CHARS:
                    raise ValueError("Transcription exceeds the 8000-character review limit.")
                pieces.append(cleaned)
    except (ValueError, TypeError):
        raise
    except Exception as exc:
        raise RuntimeError(
            "Local STT inference failed. Check the model files and available memory."
        ) from exc
    transcript = " ".join(pieces)
    return {"text": transcript, "language": "hi", "duration_seconds": info["duration_seconds"],
            "engine": "faster-whisper-local", "speech_detected": bool(transcript),
            "human_review_required": True, "network_used": False}
