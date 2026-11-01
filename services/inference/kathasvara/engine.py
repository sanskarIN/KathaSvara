"""Real Chatterbox Multilingual Hindi model adapter.

Dependencies and pretrained weights are optional. No generated samples are faked.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Any

from .inference_errors import describe_model_failure


@dataclass(frozen=True)
class VoiceSettings:
    exaggeration: float = 0.5
    cfg_weight: float = 0.5

    def validate(self) -> None:
        if not math.isfinite(self.exaggeration) or not 0.25 <= self.exaggeration <= 2.0:
            raise ValueError("Expressiveness must be between 0.25 and 2.0.")
        if not math.isfinite(self.cfg_weight) or not 0.0 <= self.cfg_weight <= 1.0:
            raise ValueError("Guidance must be between 0.0 and 1.0.")


class ChatterboxHindi:
    """Loads one authentic upstream model per process."""

    def __init__(self) -> None:
        self._model: Any = None
        self._model_variant = "v2"

    @property
    def model_variant(self) -> str:
        """Checkpoint family loaded into this adapter (used by the segment cache)."""
        return self._model_variant

    def load(self) -> None:
        # Preserve the original v2 default. v3 is a user-selected experiment,
        # never an implicit download or a source of mixed-checkpoint cache hits.
        requested_variant = os.getenv("KATHASVARA_TTS_MODEL", "v2").strip().lower()
        if requested_variant not in {"v2", "v3"}:
            raise RuntimeError("Unsupported TTS model variant. Use v2 or v3.")
        try:
            import torch
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        except Exception as exc:
            # Native extension failures (especially Windows DLL loading) can be
            # OSError/RuntimeError, not just ImportError. Never send their
            # potentially private paths to the desktop IPC response.
            raise RuntimeError(describe_model_failure(exc, stage="load")) from exc
        # A broken GPU probing library can prevent a valid CPU setup from
        # reaching inference. Only an explicit, documented override bypasses
        # auto-detection; never silently downgrade or reinterpret a typo.
        requested = os.getenv("KATHASVARA_TTS_DEVICE", "auto").strip().lower()
        if requested not in {"auto", "cpu"}:
            raise RuntimeError(
                "Unsupported TTS device override. Use auto or cpu."
            )
        try:
            if requested == "cpu":
                device = "cpu"
            else:
                # Auto mode retains the existing CUDA -> MPS -> CPU priority.
                mps = getattr(torch.backends, "mps", None)
                if torch.cuda.is_available():
                    device = "cuda"
                elif mps is not None and mps.is_available():
                    device = "mps"
                else:
                    device = "cpu"
            if requested_variant == "v3":
                # Upstream multilingual V3 accepts an explicit t3_model selector.
                # Older chatterbox-tts installations may need updating first.
                self._model = ChatterboxMultilingualTTS.from_pretrained(
                    device=device, t3_model="v3",
                )
            else:
                # Do not pass t3_model for legacy runtimes: this preserves
                # behavior and compatibility with historical v2 installations.
                self._model = ChatterboxMultilingualTTS.from_pretrained(device=device)
            self._model_variant = requested_variant
        except Exception as exc:
            raise RuntimeError(describe_model_failure(exc, stage="load")) from exc

    @property
    def sample_rate(self) -> int:
        if self._model is None:
            raise RuntimeError("Model is not loaded.")
        return int(self._model.sr)

    def generate(self, text: str, settings: VoiceSettings) -> Any:
        if self._model is None:
            raise RuntimeError("Model is not loaded.")
        settings.validate()
        try:
            return self._model.generate(
                text,
                language_id="hi",
                exaggeration=settings.exaggeration,
                cfg_weight=settings.cfg_weight,
            )
        except Exception as exc:
            raise RuntimeError(describe_model_failure(exc, stage="generate")) from exc
