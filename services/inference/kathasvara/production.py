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
from contextlib import nullcontext
from pathlib import Path
from typing import Any

from .audio_stream import StreamingWav
from .cache_lock import exclusive_cache_access
from .engine import ChatterboxHindi, VoiceSettings
from .render_journal import RenderJournal
from .render_preflight import prepare_render_plan
from .story import StoryDocument

MAX_OUTPUT_SECONDS = 1200


class RenderCancelled(RuntimeError):
    """Cooperative cancellation observed between model inference chunks."""


def _samples(audio: Any, np: Any) -> Any:
    if hasattr(audio, "detach"):
        audio = audio.detach().cpu().numpy()
    samples = np.asarray(audio, dtype=np.float32).squeeze()
    if samples.ndim != 1 or samples.size == 0 or not np.isfinite(samples).all():
        raise RuntimeError("Inference returned invalid or empty mono samples.")
    peak = float(np.max(np.abs(samples)))
    if peak > 2.0:
        raise RuntimeError("Inference returned implausible sample amplitude.")
    # The same gate protects both newly synthesized and reused cached WAVs.
    # A practically silent PCM16 segment must not poison the reusable cache.
    if peak < 1.0 / 32768.0:
        raise RuntimeError(
            "Speech engine returned effectively silent audio. "
            "Check model weights, hardware and speech generation."
        )
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
    selected_scene_ids: set[str] | None = None,
    selected_segment_ids: set[str] | None = None,
    force_segment_ids: set[str] | None = None,
    journal_path: Path | None = None,
) -> dict[str, Any]:
    """Render resolved segments in order; cache content-addressed source audio.

    A failure leaves completed cache entries in place for explicit retry.
    The final combined audio is atomically replaced only after successful finish.
    """
    plan = prepare_render_plan(
        doc, selected_scene_ids=selected_scene_ids,
        selected_segment_ids=selected_segment_ids,
        force_segment_ids=force_segment_ids,
    )
    if not output.is_absolute() or output.suffix.lower() != ".wav" or output.exists():
        raise ValueError("Choose a new absolute WAV destination.")
    if not cache_dir.is_absolute() or cache_dir.resolve() == output.resolve().parent:
        raise ValueError("Use a dedicated absolute cache directory.")
    speech = plan.lines
    try:
        import numpy as np
        import soundfile as sf
    except Exception as exc:
        # A present package can still fail to import its native extension
        # (e.g. a Windows DLL mismatch). Never send its raw exception text,
        # local filenames or third-party details to the desktop IPC response.
        raise RuntimeError(
            "Story audio libraries could not initialize. Check Python 3.11, "
            "NumPy and SoundFile compatibility; run the local TTS import probe."
        ) from exc
    # An OS-managed advisory lock spans model loading, WAV composition and cache writes.
    # The kernel releases it on worker exit; never delete the lock sentinel.
    with exclusive_cache_access(cache_dir):
        journal_context = (
            RenderJournal(journal_path, doc.id, len(speech))
            if journal_path is not None else nullcontext(None)
        )
        with journal_context as journal:
            if is_cancelled is not None and is_cancelled():
                raise RenderCancelled("Render cancelled before model loading.")
            adapter = engine if engine is not None else ChatterboxHindi()
            adapter.load()
            rate = adapter.sample_rate
            if not 8_000 <= rate <= 192_000:
                raise RuntimeError("Unsupported sample rate.")
            cache_dir.mkdir(parents=True, exist_ok=True)
            completed: list[dict[str, Any]] = []
            chunk_count = plan.chunk_count
            samples_total = 0
            # The composer holds only the current dialogue segment; no full-story array.
            with StreamingWav(output, rate, sf, rate * MAX_OUTPUT_SECONDS) as output_stream:
                for index, line in enumerate(speech):
                    if is_cancelled is not None and is_cancelled():
                        raise RenderCancelled("Render cancelled between dialogue segments.")
                    seg, character = line.segment, line.character
                    profile = character.voice
                    # Use the exact text and chunk snapshot checked by preflight:
                    # no second glossary pass or divergent re-chunking.
                    normalized, chunks = line.effective_text, line.chunks
                    # Cache key represents model ID and all *supported* settings only.
                    # The model ID should incorporate the exact revision when known.
                    fingerprint = json.dumps({
                        "v": 2, "model": profile.model_id, "engine": profile.engine_id,
                        "text": normalized, "exaggeration": profile.exaggeration,
                        "cfg_weight": profile.cfg_weight, "rate": rate,
                    }, sort_keys=True, ensure_ascii=False)
                    key = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()
                    cached = cache_dir / f"{key}.wav"
                    # Reserve the next silence before reading a reusable WAV into
                    # memory. An oversized valid cache entry must not cause a
                    # large allocation when the remaining story is nearly full.
                    pause_frames = (
                        int(rate * min(profile.pause_ms, 2000) / 1000)
                        if index != len(speech) - 1 else 0
                    )
                    remaining_frames = rate * MAX_OUTPUT_SECONDS - samples_total - pause_frames
                    if remaining_frames <= 0:
                        raise ValueError("Render exceeds the 20-minute audio limit.")
                    segment_samples = None
                    was_cached = False
                    cached_over_budget = False
                    if (use_cache and not cached.is_symlink() and cached.exists()
                        and seg.id not in (force_segment_ids or set())):
                        try:
                            info = sf.info(str(cached))
                            if (info.format == "WAV" and info.subtype == "PCM_16" and
                                info.channels == 1 and info.samplerate == rate and
                                0 < info.frames <= rate * MAX_OUTPUT_SECONDS):
                                if info.frames > remaining_frames:
                                    cached_over_budget = True
                                else:
                                    candidate, _ = sf.read(
                                        str(cached), dtype="float32", always_2d=False,
                                    )
                                    segment_samples = _samples(candidate, np)
                                    was_cached = True
                        except (OSError, RuntimeError, ValueError):
                            # A corrupt cache is never used as valid speech.
                            segment_samples = None
                    if cached_over_budget:
                        raise ValueError("Render exceeds the 20-minute audio limit.")
                    if segment_samples is None:
                        parts = []
                        generated_frames = 0
                        for part_index, chunk in enumerate(chunks):
                            if is_cancelled is not None and is_cancelled():
                                raise RenderCancelled("Render cancelled between speech chunks.")
                            generated = _samples(
                                adapter.generate(chunk, VoiceSettings(
                                    exaggeration=profile.exaggeration, cfg_weight=profile.cfg_weight,
                                )),
                                np,
                            ).copy()
                            # Reject oversized model output before concatenating chunks or
                            # publishing a potentially huge reusable cache entry.
                            join_frames = int(rate * 0.12) if part_index else 0
                            if (samples_total + generated_frames + join_frames + generated.size >
                                rate * MAX_OUTPUT_SECONDS):
                                raise ValueError("Render exceeds the 20-minute audio limit.")
                            # Fade to zero at edit boundaries to avoid hard-edge clicks
                            # when appending neighboring chunk waveforms or silence.
                            fade = min(int(rate * 0.008), generated.size // 4)
                            if fade > 1:
                                generated[:fade] *= np.linspace(0, 1, fade, dtype=np.float32)
                                generated[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
                            if part_index:
                                parts.append(np.zeros(join_frames, dtype=np.float32))
                            parts.append(generated)
                            generated_frames += join_frames + generated.size
                        segment_samples = np.concatenate(parts)
                    # Check the spoken frames AND the planned inter-speaker silence
                    # before caching new audio, so failed long renders cannot fill the cache.
                    if segment_samples.size > remaining_frames:
                        raise ValueError("Render exceeds the 20-minute audio limit.")
                    if not was_cached and use_cache:
                        _atomic_wav(cached, segment_samples, rate, sf)
                    # Measured duration is derived from generated PCM samples, never estimated from words.
                    measured = float(segment_samples.size) / float(rate)
                    start_frame = samples_total
                    samples_total += segment_samples.size
                    output_stream.write(segment_samples)
                    completed.append({
                        "segment_id": seg.id, "speaker_id": seg.speaker_id,
                        "cache_key": key if use_cache else None,
                        "cached": was_cached, "duration_seconds": round(measured, 4),
                        "start_seconds": round(start_frame / rate, 4),
                        "end_seconds": round(samples_total / rate, 4),
                        # IPC-only subtitle snapshot of exactly the reviewed and
                        # glossary-adjusted text sent to the speech engine.
                        # RenderJournal.record deliberately does not persist it.
                        "effective_text": normalized,
                    })
                    # A zero-millisecond pause is a valid voice setting.
                    # StreamingWav deliberately rejects empty writes, so skip
                    # the inter-speaker buffer when no silence was requested.
                    if index != len(speech) - 1 and pause_frames > 0:
                        silence = np.zeros(pause_frames, dtype=np.float32)
                        output_stream.write(silence)
                        samples_total += pause_frames
                    if journal is not None:
                        journal.record(completed[-1])
                    if on_progress is not None:
                        on_progress(index + 1, len(speech))
                if is_cancelled is not None and is_cancelled():
                    raise RenderCancelled("Render cancelled before WAV finalization.")
                if samples_total == 0:
                    raise RuntimeError("No speech generated.")
                output_stream.finish()
            return {
                "file": str(output), "sample_rate": rate,
                "duration_seconds": round(float(samples_total) / rate, 3),
                "segments": completed, "chunks": chunk_count,
                "distinct_voices_verified": False,
            }
