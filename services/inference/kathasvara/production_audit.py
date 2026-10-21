"""Read-only, model-free Hindi story production readiness audit.

No source text, speaker names, speaker IDs or voice parameters are returned.
Scene IDs allow the local desktop to label reports using its own copy of the
document. A readiness report is not a model compatibility or audio guarantee.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from .render_preflight import prepare_render_plan
from .story import StoryDocument


def _code(error: ValueError) -> str:
    """Convert internally safe validation failures into closed reason codes."""
    message = str(error)
    if "Assign every unknown speaker" in message:
        return "unassigned_speaker"
    if "1–256 spoken segments" in message:
        return "no_dialogue"
    if ("limit" in message.lower() or "Too many" in message or
        "chunks" in message or "exceeds" in message):
        return "over_limit"
    return "needs_review"


def audit_production_readiness(document: StoryDocument) -> dict[str, object]:
    """Independently check every scene plus the combined story, without I/O."""
    document.validate()
    scenes: list[dict[str, object]] = []
    for scene in document.scenes:
        count = sum(segment.kind == "speech" for segment in scene.segments)
        if count == 0:
            scenes.append({
                "scene_id": scene.id, "ready": False, "reason": "no_dialogue",
                "segments": 0, "chunks": 0,
            })
            continue
        try:
            plan = prepare_render_plan(document, selected_scene_ids={scene.id})
        except ValueError as error:
            scenes.append({
                "scene_id": scene.id, "ready": False, "reason": _code(error),
                "segments": count, "chunks": 0,
            })
            continue
        scenes.append({
            "scene_id": scene.id, "ready": True, "reason": "ready",
            "segments": len(plan.lines), "chunks": plan.chunk_count,
        })
    try:
        full = prepare_render_plan(document)
    except ValueError as error:
        full_ready, full_reason, full_chunks = False, _code(error), 0
    else:
        full_ready, full_reason, full_chunks = True, "ready", full.chunk_count
    return {
        "total_scenes": len(scenes),
        "ready_scenes": sum(scene["ready"] is True for scene in scenes),
        "full_story_ready": full_ready,
        "full_story_reason": full_reason,
        "full_story_chunks": full_chunks,
        "scenes": scenes,
        "model_loaded": False,
        "audio_verified": False,
        "distinct_voices_verified": False,
    }
