"""Real Chatterbox Multilingual Hindi model adapter.

Dependencies and pretrained weights are optional. No generated samples are faked.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import math
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

    def load(self) -> None:
        try:
            import torch
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        except Exception as exc:
            # Native extension failures (especially Windows DLL loading) can be
            # OSError/RuntimeError, not just ImportError. Never send their
            # potentially private paths to the desktop IPC response.
            raise RuntimeError(describe_model_failure(exc, stage="load")) from exc
        try:
            # Device initialization may also fail before from_pretrained runs.
            # Route those errors through the same privacy-safe classifier.
            mps = getattr(torch.backends, "mps", None)
            if torch.cuda.is_available():
                device = "cuda"
            elif mps is not None and mps.is_available():
                device = "mps"
            else:
                device = "cpu"
            self._model = ChatterboxMultilingualTTS.from_pretrained(device=device)
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
