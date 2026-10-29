"""Opt-in import probe for local TTS dependencies; never loads model weights.

This intentionally reports only fixed status codes. Third-party import exceptions
can contain personal filesystem paths or environment details and must not be
returned to the desktop UI.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import importlib
import sys

_MODULES = (
    ("numpy", "numpy"),
    ("soundfile", "soundfile"),
    ("torch", "torch"),
    ("chatterbox_multilingual", "chatterbox.mtl_tts"),
)


def probe_runtime() -> dict[str, object]:
    """Attempt imports only; do not call from_pretrained or generate."""
    checks: dict[str, str] = {}
    for key, module_name in _MODULES:
        try:
            module = importlib.import_module(module_name)
            if key == "chatterbox_multilingual" and not hasattr(
                module, "ChatterboxMultilingualTTS"
            ):
                checks[key] = "entrypoint_missing"
            else:
                checks[key] = "ok"
        except Exception:  # noqa: BLE001 - binary/runtime import failures are not ImportError only
            checks[key] = "import_failed"

    incompatible_python = sys.version_info[:2] != (3, 11)
    failed = [name for name, result in checks.items() if result != "ok"]
    return {
        "python_311": not incompatible_python,
        "checks": checks,
        "failed_components": failed,
        "imports_ok": not incompatible_python and not failed,
        "model_weights_verified": False,
        "audio_synthesis_verified": False,
        "help": (
            "Use Python 3.11 and install the inference project with "
            '`python -m pip install -e ".[tts]"`. Repair the listed library imports '
            "inside the interpreter selected by KATHASVARA_PYTHON. A successful "
            "probe does not verify downloaded weights or audible Hindi; run the "
            "explicit real-model smoke test and listen to its WAV separately."
        ),
    }
