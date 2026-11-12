"""Standalone, model-free offline Hindi STT setup doctor.

Used by the legacy Windows PowerShell 5.1 launcher, which can corrupt JSON
piped into a native process. No stdin, recognition model load, network access,
microphone capture, audio file write or transcript is performed.

The selected model folder is supplied only in this child's process environment.
Neither it nor optional-package errors are included in the JSON response.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import json
import os
import sys

from .local_stt import inspect_stt_setup

MODEL_ENV = "KATHASVARA_STT_DOCTOR_MODEL_PATH"
MAX_MODEL_PATH_CHARS = 4096


def probe_from_environment() -> dict[str, object]:
    """Return existing fixed-shape STT readiness hints with no user paths."""
    path = os.environ.get(MODEL_ENV)
    if path and len(path) > MAX_MODEL_PATH_CHARS:
        raise ValueError("Offline STT model selection is invalid.")
    return inspect_stt_setup(path or None)


def main() -> int:
    try:
        result = probe_from_environment()
        response: dict[str, object] = {"ok": True, "result": result}
        exit_code = 0
    except Exception:  # noqa: BLE001 - never expose file paths or native errors
        response = {
            "ok": False,
            "error": "SetupProbeFailed",
            "message": "Offline STT setup could not be checked.",
        }
        exit_code = 1
    print(json.dumps(response, ensure_ascii=True), flush=True)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
