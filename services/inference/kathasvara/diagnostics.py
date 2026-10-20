"""Lightweight, non-invasive local inference readiness checks.

No model weights are loaded or downloaded; dependency presence is not a voice-quality test.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import importlib.util
import platform
import sys


def diagnose() -> dict[str, object]:
    """Provide a reproducible checklist for configuring local Hindi synthesis."""
    installed = {
        "numpy": importlib.util.find_spec("numpy") is not None,
        "soundfile": importlib.util.find_spec("soundfile") is not None,
        "torch": importlib.util.find_spec("torch") is not None,
        "chatterbox": importlib.util.find_spec("chatterbox") is not None,
    }
    return {
        "python_version": ".".join(str(part) for part in sys.version_info[:3]),
        "platform": platform.system(),
        "dependencies": installed,
        "dependencies_present": all(installed.values()),
        "model_weights_verified": False,
        "audio_synthesis_verified": False,
        "help": (
            'Install in Python 3.11 with `pip install -e ".[tts]"`, '
            "then perform an actual Hindi smoke test and listen to the WAV."
        ),
    }
