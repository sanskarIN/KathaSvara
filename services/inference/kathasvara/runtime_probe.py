"""Opt-in import probe for local TTS dependencies; never loads model weights.

This intentionally reports only fixed status codes. Third-party import exceptions
can contain personal filesystem paths or environment details and must not be
returned to the desktop UI.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

from .api_compatibility import inspect_chatterbox_api
from .voice_reference import inspect_reference_wav

_MODULES = (
    ("numpy", "numpy"),
    ("soundfile", "soundfile"),
    ("torch", "torch"),
    ("chatterbox_multilingual", "chatterbox.mtl_tts"),
)


def probe_runtime() -> dict[str, object]:
    """Attempt imports only; do not call from_pretrained or generate."""
    checks: dict[str, str] = {}
    chatterbox_entrypoint: object | None = None
    for key, module_name in _MODULES:
        try:
            module = importlib.import_module(module_name)
            if key == "chatterbox_multilingual" and not hasattr(
                module, "ChatterboxMultilingualTTS"
            ):
                checks[key] = "entrypoint_missing"
            else:
                checks[key] = "ok"
                if key == "chatterbox_multilingual":
                    chatterbox_entrypoint = module.ChatterboxMultilingualTTS
        except Exception:  # noqa: BLE001 - binary/runtime import failures are not ImportError only
            checks[key] = "import_failed"

    incompatible_python = sys.version_info[:2] != (3, 11)
    failed = [name for name, result in checks.items() if result != "ok"]
    # Never echo an arbitrary environment value into the UI: it could contain
    # private paths or tokens. Validate configuration without loading weights.
    requested_device = os.getenv("KATHASVARA_TTS_DEVICE", "auto").strip().lower()
    device_valid = requested_device in {"auto", "cpu"}
    requested_model = os.getenv("KATHASVARA_TTS_MODEL", "v2").strip().lower()
    model_valid = requested_model in {"v2", "v3"}
    reference = os.getenv("KATHASVARA_TTS_REFERENCE_WAV", "").strip()
    reference_status = "not_set"
    if reference:
        try:
            inspect_reference_wav(Path(reference))
            reference_status = "valid"
        except ValueError:
            reference_status = "invalid"
    requested_api_status = inspect_chatterbox_api(
        chatterbox_entrypoint,
        needs_v3=requested_model == "v3",
        needs_reference=reference_status == "valid",
    )
    api_compatible = requested_api_status in {"not_requested", "compatible"}
    imports_ok = not incompatible_python and not failed
    return {
        "python_311": not incompatible_python,
        "checks": checks,
        "failed_components": failed,
        "imports_ok": imports_ok,
        "tts_device_mode": requested_device if device_valid else "invalid",
        "device_configuration_valid": device_valid,
        "tts_model_variant": requested_model if model_valid else "invalid",
        "model_configuration_valid": model_valid,
        "reference_voice_status": reference_status,
        "upstream_api_status": requested_api_status,
        "upstream_api_compatible": api_compatible,
        # An importable but older Chatterbox may lack V3 or reference prompt
        # keywords. A no-model signature check prevents false green results.
        # Even a passing result does NOT verify weights or real Hindi.
        "preflight_ok": (
            imports_ok and device_valid and model_valid
            and reference_status != "invalid" and api_compatible
        ),
        "model_weights_verified": False,
        "audio_synthesis_verified": False,
        "help": (
            "Use Python 3.11 and install the inference project with "
            '`python -m pip install -e ".[tts]"`. Repair the listed library imports '
            "inside the interpreter selected by KATHASVARA_PYTHON. If the "
            "TTS device is invalid, use KATHASVARA_TTS_DEVICE=auto or cpu. "
            "Choose KATHASVARA_TTS_MODEL=v2 (default) or opt in to v3, which "
            "requires an upstream version supporting t3_model=v3 and its weights. "
            "An optional KATHASVARA_TTS_REFERENCE_WAV must point to your own "
            "or consented local PCM16 reference recording. The probe never "
            "returns its path or audio bytes. V3 and local reference mode also "
            "require a compatible installed Chatterbox API; an opaque signature "
            "cannot be certified by this model-free check. A successful probe "
            "does not verify downloaded weights or audible Hindi; run the "
            "explicit real-model smoke test and listen to its WAV separately."
        ),
    }
