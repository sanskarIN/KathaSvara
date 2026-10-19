"""Real Chatterbox Multilingual Hindi model adapter.

Dependencies and pretrained weights are optional. No generated samples are faked.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any


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
        except ImportError as exc:
            raise RuntimeError(
                'Speech engine missing. Install Python 3.11 and pip install -e ".[tts]".'
            ) from exc
        # Not every installed PyTorch build supports the MPS backend.
        mps = getattr(torch.backends, "mps", None)
        if torch.cuda.is_available():
            device = "cuda"
        elif mps is not None and mps.is_available():
            device = "mps"
        else:
            device = "cpu"
        self._model = ChatterboxMultilingualTTS.from_pretrained(device=device)

    @property
    def sample_rate(self) -> int:
        if self._model is None:
            raise RuntimeError("Model is not loaded.")
        return int(self._model.sr)

    def generate(self, text: str, settings: VoiceSettings) -> Any:
        if self._model is None:
            raise RuntimeError("Model is not loaded.")
        settings.validate()
        return self._model.generate(
            text,
            language_id="hi",
            exaggeration=settings.exaggeration,
            cfg_weight=settings.cfg_weight,
        )
