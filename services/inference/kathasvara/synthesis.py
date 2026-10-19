"""Validated speech synthesis and lossless WAV output.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from pathlib import Path
from typing import Protocol, Any

from .engine import ChatterboxHindi, VoiceSettings
from .hindi import split_for_engine, validate_story


class SpeechEngine(Protocol):
    @property
    def sample_rate(self) -> int: ...
    def load(self) -> None: ...
    def generate(self, text: str, settings: VoiceSettings) -> Any: ...


def synthesize(
    text: str,
    output: Path,
    settings: VoiceSettings,
    engine: SpeechEngine | None = None,
) -> dict[str, int | float | str]:
    """Generate authentic audio; an injected engine is permitted for isolated tests."""
    validated = validate_story(text)
    settings.validate()
    if not output.is_absolute() or output.suffix.lower() != ".wav":
        raise ValueError("Output must be an absolute .wav filename.")
    if output.exists():
        raise FileExistsError("Refusing to overwrite existing audio.")
    try:
        import numpy as np
        import soundfile as sf
    except ImportError as exc:
        raise RuntimeError('Audio dependencies missing; install pip install -e ".[tts]".') from exc

    adapter = engine if engine is not None else ChatterboxHindi()
    adapter.load()
    rate = adapter.sample_rate
    if not 8_000 <= rate <= 192_000:
        raise RuntimeError("Engine returned an invalid sample rate.")

    parts: list[Any] = []
    for chunk in split_for_engine(validated):
        audio = adapter.generate(chunk, settings)
        if hasattr(audio, "detach"):
            audio = audio.detach().cpu().numpy()
        samples = np.asarray(audio, dtype=np.float32).squeeze()
        if samples.ndim != 1 or samples.size == 0 or not np.isfinite(samples).all():
            raise RuntimeError("Speech engine returned invalid or empty audio.")
        if float(np.max(np.abs(samples))) > 2.0:
            raise RuntimeError("Speech engine returned implausible sample amplitudes.")
        parts.append(np.clip(samples, -1.0, 1.0))
    if not parts:
        raise RuntimeError("No audio was generated.")

    silence = np.zeros(int(rate * 0.14), dtype=np.float32)
    sequence: list[Any] = []
    for index, part in enumerate(parts):
        if index:
            sequence.append(silence)
        sequence.append(part)
    combined = np.concatenate(sequence)
    if combined.size == 0:
        raise RuntimeError("Generated audio was empty.")

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.stem + ".partial.wav")
    try:
        sf.write(str(temporary), combined, rate, subtype="PCM_16")
        metadata = sf.info(str(temporary))
        if metadata.channels != 1 or metadata.samplerate != rate or metadata.frames <= 0:
            raise RuntimeError("WAV verification failed.")
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)

    return {
        "file": str(output),
        "sample_rate": rate,
        "duration_seconds": round(float(metadata.duration), 3),
        "chunks": len(parts),
    }
