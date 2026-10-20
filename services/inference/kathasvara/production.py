"""Local multi-segment speech composition with bounded caching and atomic WAV writes.

Speaker-specific routing persists supported parameters, but DOES NOT claim unique
voice identities; real Chatterbox speaker conditioning is not wired or verified.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .engine import ChatterboxHindi, VoiceSettings
from .hindi import normalize_hindi, split_for_engine
from .story import StoryDocument

MAX_RENDER_SEGMENTS = 256
MAX_RENDER_CHARACTERS = 100_000
MAX_CHUNKS = 500
MAX_OUTPUT_SECONDS = 1200


class RenderCancelled(RuntimeError):
    """Cooperative cancellation observed between model inference chunks."""


def _samples(audio: Any, np: Any) -> Any:
    if hasattr(audio, "detach"):
        audio = audio.detach().cpu().numpy()
    samples = np.asarray(audio, dtype=np.float32).squeeze()
    if samples.ndim != 1 or samples.size == 0 or not np.isfinite(samples).all():
        raise RuntimeError("Inference returned invalid or empty mono samples.")
    if float(np.max(np.abs(samples))) > 2.0:
        raise RuntimeError("Inference returned implausible sample amplitude.")
    return np.clip(samples, -1.0, 1.0)


def _atomic_wav(path: Path, audio: Any, rate: int, sf: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f"{path.stem}-{uuid.uuid4().hex}.partial.wav")
    try:
        sf.write(str(temp), audio, rate, subtype="PCM_16")
        info = sf.info(str(temp))
        if info.channels != 1 or info.frames <= 0 or info.samplerate != rate:
            raise RuntimeError("Rendered WAV header does not match mono PCM16.")
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


def render_story(
    doc: StoryDocument,
    output: Path,
    cache_dir: Path,
    engine: Any = None,
    on_progress: Callable[[int, int], None] | None = None,
    is_cancelled: Callable[[], bool] | None = None,
    *,
    use_cache: bool = True,
) -> dict[str, Any]:
    """Render resolved segments in order; cache content-addressed source audio.

    A failure leaves completed cache entries in place for explicit retry.
    The final combined audio is atomically replaced only after successful finish.
    """
    doc.validate()
    if not output.is_absolute() or output.suffix.lower() != ".wav" or output.exists():
        raise ValueError("Choose a new absolute WAV destination.")
    if not cache_dir.is_absolute() or cache_dir.resolve() == output.resolve().parent:
        raise ValueError("Use a dedicated absolute cache directory.")
    speech = [
        (seg, next(char for char in doc.characters if char.id == seg.speaker_id))
        for scene in doc.scenes for seg in scene.segments if seg.kind == "speech"
    ]
    if not speech or len(speech) > MAX_RENDER_SEGMENTS:
        raise ValueError("A render needs 1–256 spoken segments.")
    if any(seg.speaker_id is None for scene in doc.scenes for seg in scene.segments
           if seg.kind == "speech"):
        raise ValueError("Assign every unknown speaker manually before rendering.")
    if sum(len(seg.spoken_text) for seg, _ in speech) > MAX_RENDER_CHARACTERS:
        raise ValueError("A render exceeds the 100000-character limit.")
    try:
        import numpy as np
        import soundfile as sf
    except ImportError as exc:
        raise RuntimeError("Install numpy and soundfile to render.") from exc
    adapter = engine if engine is not None else ChatterboxHindi()
    adapter.load()
    rate = adapter.sample_rate
    if not 8_000 <= rate <= 192_000:
        raise RuntimeError("Unsupported sample rate.")
    cache_dir.mkdir(parents=True, exist_ok=True)
    combined_parts: list[Any] = []
    completed: list[dict[str, Any]] = []
    chunk_count = 0
    samples_total = 0
    for index, (seg, character) in enumerate(speech):
        if is_cancelled is not None and is_cancelled():
            raise RenderCancelled("Render cancelled between dialogue segments.")
        profile = character.voice
        profile.validate()
        normalized = normalize_hindi(seg.spoken_text)
        if not normalized:
            raise ValueError("Spoken dialogue cannot be empty.")
        chunks = split_for_engine(normalized)
        if not chunks or len(chunks) > 40:
            raise ValueError("Segment requires too many speech chunks.")
        chunk_count += len(chunks)
        if chunk_count > MAX_CHUNKS:
            raise ValueError("Too many speech chunks in one render.")
        # Cache key represents model ID and all *supported* settings only.
        # The model ID should incorporate the exact revision when known.
        fingerprint = json.dumps({
            "v": 1, "model": profile.model_id, "engine": profile.engine_id,
            "text": normalized, "exaggeration": profile.exaggeration,
            "cfg_weight": profile.cfg_weight, "rate": rate,
        }, sort_keys=True, ensure_ascii=False)
        key = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()
        cached = cache_dir / f"{key}.wav"
        segment_samples = None
        was_cached = False
        if use_cache and cached.exists():
            try:
                info = sf.info(str(cached))
                if info.channels == 1 and info.samplerate == rate and info.frames > 0:
                    candidate, _ = sf.read(str(cached), dtype="float32", always_2d=False)
                    segment_samples = _samples(candidate, np)
                    was_cached = True
            except (OSError, RuntimeError, ValueError):
                # A corrupt cache is never used as valid speech.
                segment_samples = None
        if segment_samples is None:
            parts = []
            for part_index, chunk in enumerate(chunks):
                if is_cancelled is not None and is_cancelled():
                    raise RenderCancelled("Render cancelled between speech chunks.")
                generated = _samples(
                    adapter.generate(chunk, VoiceSettings(
                        exaggeration=profile.exaggeration, cfg_weight=profile.cfg_weight,
                    )),
                    np,
                )
                if part_index:
                    parts.append(np.zeros(int(rate * 0.12), dtype=np.float32))
                parts.append(generated)
            segment_samples = np.concatenate(parts)
            if use_cache:
                _atomic_wav(cached, segment_samples, rate, sf)
        # Measured duration is derived from generated PCM samples, never estimated from words.
        measured = float(segment_samples.size) / float(rate)
        samples_total += segment_samples.size
        if samples_total / rate > MAX_OUTPUT_SECONDS:
            raise ValueError("Render exceeds the 20-minute audio limit.")
        combined_parts.append(segment_samples)
        completed.append({
            "segment_id": seg.id, "speaker_id": seg.speaker_id,
            "cache_key": key if use_cache else None,
            "cached": was_cached, "duration_seconds": round(measured, 4),
        })
        if index != len(speech) - 1:
            pause = min(profile.pause_ms, 2000)
            silence = np.zeros(int(rate * pause / 1000), dtype=np.float32)
            combined_parts.append(silence)
            samples_total += silence.size
        if on_progress is not None:
            on_progress(index + 1, len(speech))
    if is_cancelled is not None and is_cancelled():
        raise RenderCancelled("Render cancelled before WAV finalization.")
    combined = np.concatenate(combined_parts)
    if combined.size == 0:
        raise RuntimeError("No speech generated.")
    _atomic_wav(output, combined, rate, sf)
    return {
        "file": str(output), "sample_rate": rate,
        "duration_seconds": round(float(combined.size) / rate, 3),
        "segments": completed, "chunks": chunk_count,
        "distinct_voices_verified": False,
    }
