"""Local stdin/stdout one-shot protocol for the Tauri process bridge.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from .engine import VoiceSettings
from .hindi import split_for_engine, validate_story
from .synthesis import synthesize


def handle(request: dict[str, object]) -> dict[str, object]:
    if request.get("action") == "health":
        return {"ok": True, "engine": "chatterbox-multilingual", "language": "hi"}
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
        payload = sys.stdin.read(16_384)
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
