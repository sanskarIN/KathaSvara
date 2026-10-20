"""Lightweight, non-invasive local inference readiness checks.

No model weights are loaded or downloaded; dependency presence is not a voice-quality test.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import importlib.util
import os
import platform
import sys
import tempfile
from pathlib import Path


def diagnose() -> dict[str, object]:
    """Provide a reproducible checklist for configuring local Hindi synthesis."""
    installed = {
        "numpy": importlib.util.find_spec("numpy") is not None,
        "soundfile": importlib.util.find_spec("soundfile") is not None,
        "torch": importlib.util.find_spec("torch") is not None,
        "chatterbox": importlib.util.find_spec("chatterbox") is not None,
    }
    configured_python = os.getenv("KATHASVARA_PYTHON")
    inference_dir = os.getenv("KATHASVARA_INFERENCE_DIR")
    python_candidate = Path(configured_python) if configured_python else None
    source_candidate = Path(inference_dir) if inference_dir else None
    writable_temp = False
    try:
        with tempfile.TemporaryFile() as output:
            output.write(b"doctor")
            output.flush()
            writable_temp = True
    except OSError:
        pass
    return {
        "python_311": sys.version_info[:2] == (3, 11),
        "runtime_python_configured": bool(configured_python),
        # Deliberately report only booleans, never absolute private paths.
        "runtime_python_path_exists": bool(
            python_candidate and python_candidate.is_absolute() and python_candidate.is_file()
        ),
        "inference_dir_configured": bool(inference_dir),
        "inference_dir_looks_valid": bool(
            source_candidate and source_candidate.is_absolute()
            and (source_candidate / "kathasvara" / "cli.py").is_file()
        ),
        "temporary_write_test_passed": writable_temp,
        "tested_on_this_machine": False,
        "real_speech_verified": False,
        "python_version": ".".join(str(part) for part in sys.version_info[:3]),
        "platform": platform.system(),
        "dependencies": installed,
        "dependencies_present": all(installed.values()),
        "model_weights_verified": False,
        "audio_synthesis_verified": False,
        "help": (
            'Install in Python 3.11 with `pip install -e ".[tts]"`, '
            "configure KATHASVARA_PYTHON and KATHASVARA_INFERENCE_DIR for the portable EXE, "
            "then perform an actual Hindi smoke test and listen to the WAV."
        ),
    }
