#!/usr/bin/env python3
"""Explicit real-model Hindi smoke test. Requires installed Chatterbox weights/runtime.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

SCRIPT = (
    "नमस्कार मित्रों! कहानी वाली शाम में आपका स्वागत है। "
    "आज की कहानी शुरू होती है एक ऐसे गाँव से, जहाँ हर शाम एक पुरानी घंटी अपने आप बज उठती थी। "
    "आइए, सुनते हैं उसकी अद्भुत कहानी।"
)


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
    digest = hashlib.sha256(args.output.read_bytes()).hexdigest()
    print(json.dumps({"audio": result, "sha256": digest}, ensure_ascii=False, indent=2))
    print("Listen to the WAV. Human evaluation is required before release.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
