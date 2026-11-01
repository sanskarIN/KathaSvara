"""No-model checks for optional upstream Chatterbox API compatibility.

These fixtures deliberately fail on inference invocation. Only method
signatures are examined; no model weights or personal audio are loaded.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from kathasvara.api_compatibility import inspect_chatterbox_api


class LegacyApi:
    @classmethod
    def from_pretrained(cls, *, device: str) -> object:
        raise AssertionError("No weights should load in the diagnostic.")

    def generate(self, text: str, language_id: str) -> object:
        raise AssertionError("No audio should be generated in diagnostics.")


class V3OnlyApi:
    @classmethod
    def from_pretrained(cls, *, device: str, t3_model: str | None = None) -> object:
        raise AssertionError("No weights should load in the diagnostic.")

    def generate(self, text: str, language_id: str) -> object:
        raise AssertionError("No audio should be generated in diagnostics.")


class CompatibleApi:
    @classmethod
    def from_pretrained(cls, *, device: str, t3_model: str | None = None) -> object:
        raise AssertionError("No weights should load in the diagnostic.")

    def generate(
        self, text: str, language_id: str, audio_prompt_path: str | None = None,
    ) -> object:
        raise AssertionError("No audio should be generated in diagnostics.")


class WrappedApi:
    from_pretrained = classmethod(lambda cls, **kwargs: None)

    def generate(self, *args: object, **kwargs: object) -> None:
        raise AssertionError("No audio should be generated in diagnostics.")


@pytest.mark.parametrize(("api", "v3", "reference", "expected"), [
    (LegacyApi, False, False, "not_requested"),
    (LegacyApi, True, False, "v3_unsupported"),
    (LegacyApi, False, True, "reference_unsupported"),
    (V3OnlyApi, True, False, "compatible"),
    (V3OnlyApi, True, True, "reference_unsupported"),
    (CompatibleApi, True, True, "compatible"),
    (CompatibleApi, False, True, "compatible"),
    (WrappedApi, True, True, "compatible"),
    (None, True, False, "unavailable"),
    (SimpleNamespace(), True, False, "v3_unsupported"),
])
def test_opt_in_api_signature_diagnostics(
    api: object, v3: bool, reference: bool, expected: str,
) -> None:
    assert inspect_chatterbox_api(
        api, needs_v3=v3, needs_reference=reference,
    ) == expected


def test_default_v2_does_not_require_new_api_signature() -> None:
    assert inspect_chatterbox_api(
        LegacyApi, needs_v3=False, needs_reference=False,
    ) == "not_requested"
