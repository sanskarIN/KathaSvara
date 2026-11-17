"""Explicit real offline Hindi WAV recognition smoke probe for Windows setup.

The probe calls the same user-consented local ASR engine as the desktop, but
returns only bounded status metadata: no transcript, private paths, hashes or
raw optional-model errors reach stdout. It never downloads a checkpoint,
records from the microphone, or writes user audio to disk.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path

from .local_stt import MAX_TRANSCRIPT_CHARS, transcribe_hindi_wav

WAV_ENV = "KATHASVARA_STT_SMOKE_WAV_PATH"
MODEL_ENV = "KATHASVARA_STT_SMOKE_MODEL_PATH"
MAX_PATH_CHARS = 4096


def probe_from_environment() -> dict[str, object]:
    """Run real local transcription from two explicit, child-scoped paths."""
    wav_path = os.environ.get(WAV_ENV, "")
    model_path = os.environ.get(MODEL_ENV, "")
    if not wav_path or not model_path or (
        len(wav_path) > MAX_PATH_CHARS or len(model_path) > MAX_PATH_CHARS
    ) or not Path(wav_path).is_absolute() or not Path(model_path).is_absolute():
        raise ValueError("Select an absolute local WAV and model folder.")

    report = transcribe_hindi_wav(wav_path, model_path)
    text = report.get("text")
    duration = report.get("duration_seconds")
    if (
        not isinstance(text, str) or len(text) > MAX_TRANSCRIPT_CHARS
        or not isinstance(duration, (int, float)) or isinstance(duration, bool)
        or not math.isfinite(duration) or not 0 < duration <= 60
        or report.get("speech_detected") is not bool(text)
        or report.get("language") != "hi"
        or report.get("engine") != "faster-whisper-local"
        or report.get("human_review_required") is not True
        or report.get("network_used") is not False
    ):
        raise ValueError("The offline STT engine returned an invalid result.")

    return {
        "language": "hi",
        "engine": "faster-whisper-local",
        "duration_seconds": float(duration),
        "speech_detected": bool(text),
        "transcript_characters": len(text),
        "real_inference_attempted": True,
        "human_review_required": True,
        "hindi_accuracy_verified": False,
        "network_used": False,
    }


def main() -> int:
    try:
        result = probe_from_environment()
        response: dict[str, object] = {"ok": True, "result": result}
        status = 0
    except Exception:  # noqa: BLE001 - native model errors may include private paths
        response = {
            "ok": False,
            "error": "LocalSttSmokeFailed",
            "message": "Offline Hindi STT smoke test failed. Check local model, WAV and memory.",
        }
        status = 1
    print(json.dumps(response, ensure_ascii=True), flush=True)
    return status


if __name__ == "__main__":
    sys.exit(main())
