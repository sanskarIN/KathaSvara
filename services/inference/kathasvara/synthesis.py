"""Validated speech synthesis and lossless WAV output.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol

from .audio_stream import StreamingWav
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
    except Exception as exc:
        # A broken NumPy/SoundFile binary can raise OSError or RuntimeError
        # containing private DLL locations. Do not forward those details through
        # CLI/desktop IPC, even when the package is technically installed.
        raise RuntimeError(
            "Audio libraries could not initialize. Check Python 3.11, NumPy "
            "and SoundFile compatibility; run the local TTS import probe."
        ) from exc

    adapter = engine if engine is not None else ChatterboxHindi()
    adapter.load()
    rate = adapter.sample_rate
    if not 8_000 <= rate <= 192_000:
        raise RuntimeError("Engine returned an invalid sample rate.")

    silence = np.zeros(int(rate * 0.14), dtype=np.float32)
    chunks = 0
    with StreamingWav(output, rate, sf, rate * 20 * 60) as writer:
        for chunk in split_for_engine(validated):
            audio = adapter.generate(chunk, settings)
            if hasattr(audio, "detach"):
                audio = audio.detach().cpu().numpy()
            samples = np.asarray(audio, dtype=np.float32).squeeze()
            if samples.ndim != 1 or samples.size == 0 or not np.isfinite(samples).all():
                raise RuntimeError("Speech engine returned invalid or empty audio.")
            if float(np.max(np.abs(samples))) > 2.0:
                raise RuntimeError("Speech engine returned implausible sample amplitudes.")
            if chunks:
                writer.write(silence)
            writer.write(np.clip(samples, -1.0, 1.0))
            chunks += 1
        if not chunks:
            raise RuntimeError("No audio was generated.")
        writer.finish()
        duration_seconds = round(writer.frames / rate, 3)

    return {
        "file": str(output),
        "sample_rate": rate,
        "duration_seconds": duration_seconds,
        "chunks": chunks,
    }
