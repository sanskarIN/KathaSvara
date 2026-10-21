"""Local stdin/stdout one-shot protocol for the Tauri process bridge.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from .cache import CACHE_BUDGET_BYTES, inspect_cache, prune_cache
from .diagnostics import diagnose
from .dialogue import parse_dialogue, unresolved_labels
from .engine import VoiceSettings
from .hindi import split_for_engine, validate_story
from .production import render_story
from .render_preflight import inspect_render_plan
from .pronunciation import apply_glossary
from .story import Character, VoiceProfile, from_dict, narrator
from .synthesis import synthesize
from .temp_cleanup import cleanup_partial_wavs


def handle(request: dict[str, object]) -> dict[str, object]:
    if request.get("action") == "health":
        return {"ok": True, "engine": "chatterbox-multilingual", "language": "hi"}
    if request.get("action") == "diagnose":
        return {"ok": True, "result": diagnose()}
    if request.get("action") == "abandoned_wav_cleanup":
        root = request.get("root")
        dry_run = request.get("dry_run", True)
        if not isinstance(root, str):
            raise TypeError("Recovery cleanup needs an absolute app-data root.")
        return {"ok": True, "result": cleanup_partial_wavs(
            Path(root), dry_run=dry_run,
        )}
    if request.get("action") in ("cache_stats", "cache_prune"):
        cache_path = request.get("cache")
        if not isinstance(cache_path, str):
            raise TypeError("Cache maintenance requires an absolute cache directory.")
        cache = Path(cache_path)
        if request["action"] == "cache_stats":
            return {"ok": True, "result": inspect_cache(cache)}
        report = prune_cache(
            cache, max_bytes=request.get("max_bytes", CACHE_BUDGET_BYTES),
            dry_run=request.get("dry_run", True),
        )
        return {"ok": True, "result": report}
    if request.get("action") == "parse_dialogue":
        text = request.get("text")
        title = request.get("title", "Hindi Story")
        characters = request.get("characters", [])
        if not isinstance(text, str) or not isinstance(title, str):
            raise TypeError("Dialogue parsing requires a story title and text.")
        if not isinstance(characters, list) or len(characters) > 100:
            raise ValueError("Expected at most 100 character profiles.")
        configured = [narrator()]
        for entry in characters:
            if not isinstance(entry, dict):
                raise TypeError("Invalid character profile.")
            voice = entry.get("voice", {})
            if not isinstance(voice, dict):
                raise TypeError("Invalid voice profile.")
            character = Character(
                id=entry["id"], name=entry["name"],
                voice=VoiceProfile(**voice),
                description=entry.get("description", ""),
            )
            if character.id == "narrator":
                configured[0] = character
            else:
                configured.append(character)
        script_id = request.get("script_id")
        if script_id is not None and not isinstance(script_id, str):
            raise TypeError("Script ID must be a string.")
        document = parse_dialogue(title, text, configured, script_id=script_id)
        return {
            "ok": True, "result": document.to_dict(),
            "unresolved": unresolved_labels(document),
            "distinct_voices_verified": False,
        }
    if request.get("action") == "inspect":
        text = request.get("text")
        if not isinstance(text, str):
            raise TypeError("Inspection requires story text.")
        normalized = validate_story(text)
        chunks = split_for_engine(normalized)
        return {
            "ok": True,
            "result": {
                "normalized": normalized,
                "characters": len(normalized),
                "chunks": chunks,
                "chunk_count": len(chunks),
                "changed": normalized != text,
            },
        }
    if request.get("action") == "preview_pronunciation":
        project = request.get("project")
        segment_id = request.get("segment_id")
        if not isinstance(project, dict) or not isinstance(segment_id, str):
            raise TypeError("Preview requires a story document and segment identifier.")
        document = from_dict(project)
        for scene in document.scenes:
            for segment in scene.segments:
                if segment.id == segment_id:
                    if segment.kind != "speech":
                        raise ValueError("Stage directions are not synthesized.")
                    result = apply_glossary(segment.spoken_text, document.pronunciation_glossary)
                    return {"ok": True, "result": {
                        "original": segment.original_text,
                        "reviewed": segment.spoken_text,
                        "effective": result["text"],
                        "changes": result["changes"],
                    }}
        raise ValueError("Segment does not belong to the selected story.")
    if request.get("action") == "preflight_render":
        project = request.get("project")
        if not isinstance(project, dict):
            raise TypeError("Preflight requires a story document.")
        filters: dict[str, set[str] | None] = {}
        for name in ("selected_scene_ids", "selected_segment_ids", "force_segment_ids"):
            ids = request.get(name)
            if ids is not None and (
                not isinstance(ids, list) or len(ids) > 256 or
                not all(isinstance(item, str) for item in ids)
            ):
                raise TypeError("Preflight selections must be bounded arrays of identifiers.")
            filters[name] = set(ids) if ids is not None else None
        return {"ok": True, "result": inspect_render_plan(from_dict(project), **filters)}
    if request.get("action") == "render_story":
        project = request.get("project")
        output = request.get("output")
        cache = request.get("cache")
        cancel = request.get("cancel_file")
        progress = request.get("progress_file")
        journal = request.get("journal_file")
        selected = request.get("selected_scene_ids")
        selected_segments = request.get("selected_segment_ids")
        force = request.get("force_segment_ids")
        if not isinstance(project, dict):
            raise TypeError("Expected a version 2 story document.")
        if not isinstance(output, str) or not isinstance(cache, str):
            raise TypeError("Render requires output and cache filenames.")
        if cancel is not None and not isinstance(cancel, str):
            raise TypeError("Cancellation sentinel must be a filename.")
        if progress is not None and not isinstance(progress, str):
            raise TypeError("Progress file must be a filename.")
        if journal is not None and not isinstance(journal, str):
            raise TypeError("Journal file must be a filename.")
        if selected is not None and (
            not isinstance(selected, list) or
            not all(isinstance(item, str) for item in selected)
        ):
            raise TypeError("Selected scenes must be an ID array.")
        if selected_segments is not None and (
            not isinstance(selected_segments, list) or
            not all(isinstance(item, str) for item in selected_segments) or
            len(selected_segments) > 256
        ):
            raise TypeError("Selected dialogue lines must be a bounded ID array.")
        if force is not None and (
            not isinstance(force, list) or
            not all(isinstance(item, str) for item in force)
        ):
            raise TypeError("Forced segments must be an ID array.")
        doc = from_dict(project)
        cancel_path = Path(cancel) if cancel else None
        progress_path = Path(progress) if progress else None

        def cancelled() -> bool:
            return cancel_path is not None and cancel_path.exists()

        def report(done: int, total: int) -> None:
            if progress_path is not None:
                progress_path.parent.mkdir(parents=True, exist_ok=True)
                tmp = progress_path.with_name(progress_path.name + ".partial")
                tmp.write_text(json.dumps({"done": done, "total": total}), encoding="utf-8")
                tmp.replace(progress_path)

        result = render_story(
            doc, Path(output), Path(cache), on_progress=report, is_cancelled=cancelled,
            selected_scene_ids=set(selected) if selected is not None else None,
            selected_segment_ids=set(selected_segments) if selected_segments is not None else None,
            force_segment_ids=set(force) if force is not None else None,
            journal_path=Path(journal) if journal is not None else None,
        )
        return {"ok": True, "result": result}
    if request.get("action") != "synthesize":
        raise ValueError("Unsupported action.")
    text = request.get("text")
    output = request.get("output")
    if not isinstance(text, str) or not isinstance(output, str):
        raise TypeError("Synthesis requires text and an output filename.")
    settings = VoiceSettings(
        exaggeration=float(request.get("exaggeration", 0.5)),
        cfg_weight=float(request.get("cfg_weight", 0.5)),
    )
    result = synthesize(text, Path(output), settings)
    return {"ok": True, "result": result}


def main() -> int:
    try:
        # Bound input to 250000 Unicode code points; large scripts must not be
        # silently truncated into a different parse or audio request.
        payload = sys.stdin.read(250_001)
        if len(payload) > 250_000:
            raise ValueError("Inference request exceeds the maximum input size.")
        request = json.loads(payload)
        if not isinstance(request, dict):
            raise TypeError("Request must be a JSON object.")
        response = handle(request)
        exit_code = 0
    except (ValueError, RuntimeError, OSError, ImportError, TypeError) as exc:
        response = {"ok": False, "error": type(exc).__name__, "message": str(exc)}
        exit_code = 1
    except Exception:  # noqa: BLE001 — protect renderer from upstream model errors
        response = {"ok": False, "error": "InferenceFailed", "message": "Speech generation failed. Consult local logs."}
        exit_code = 1
    print(json.dumps(response, ensure_ascii=False), flush=True)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
