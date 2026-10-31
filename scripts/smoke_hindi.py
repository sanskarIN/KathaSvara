#!/usr/bin/env python3
"""Explicit real-model Hindi smoke test. Requires installed Chatterbox weights/runtime.

Model-free unit tests may exercise the verification helper, but never synthesize
fake evidence or claim that human Hindi listening has occurred.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SCRIPT = (
    "नमस्कार मित्रों! कहानी वाली शाम में आपका स्वागत है। "
    "आज की कहानी शुरू होती है एक ऐसे गाँव से, जहाँ हर शाम एक पुरानी घंटी अपने आप बज उठती थी। "
    "आइए, सुनते हैं उसकी अद्भुत कहानी।"
)


def verify_smoke_output(output: Path, synthesis: dict[str, Any]) -> dict[str, Any]:
    """Verify generated PCM, timing and signal without loading model weights."""
    from kathasvara.wav_acceptance import inspect_wav_candidate

    report = inspect_wav_candidate(output)
    if (
        report["structure_valid"] is not True
        or report["codec"] != "pcm_s16le"
        or report["channels"] != 1
        or report["frames"] <= 0
        or report["duration_seconds"] <= 0
        or report["human_review_required"] is not True
        or report["hindi_listening_verified"] is not False
    ):
        raise RuntimeError("Real Hindi smoke WAV failed basic PCM acceptance.")
    if (
        report["sample_rate_hz"] != synthesis.get("sample_rate")
        or abs(report["duration_seconds"] - synthesis.get("duration_seconds", -1)) > 0.02
    ):
        raise RuntimeError("Real Hindi smoke WAV disagrees with synthesis metadata.")
    if report["level_hints"]["near_silence_hint"]:
        raise RuntimeError(
            "Real Hindi smoke WAV is near-silent. "
            "Check the model, output audio and speech runtime."
        )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate and verify REAL Hindi WAV audio.")
    parser.add_argument("--output", type=Path, required=True, help="New absolute .wav output file")
    parser.add_argument("--allow-model-downloads", action="store_true")
    args = parser.parse_args()
    if not args.allow_model_downloads:
        parser.error("Pass --allow-model-downloads to acknowledge model download/terms.")
    from kathasvara.engine import VoiceSettings
    from kathasvara.synthesis import synthesize

    result = synthesize(SCRIPT, args.output, VoiceSettings())
    report = verify_smoke_output(args.output, result)
    # The inspector computes the SHA-256 in bounded chunks; never read an
    # entire long WAV into memory solely to calculate its digest.
    print(json.dumps({
        "audio": result,
        "sha256": report["sha256"],
        "wav_inspection": {
            "structure_valid": report["structure_valid"],
            "duration_seconds": report["duration_seconds"],
            "sample_rate_hz": report["sample_rate_hz"],
            "level_hints": report["level_hints"],
            "hindi_listening_verified": False,
            "human_review_required": True,
        },
    }, ensure_ascii=False, indent=2))
    print("Listen to the WAV. Human evaluation is required before release.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
