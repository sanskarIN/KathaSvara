"""Conservative, model-free compatibility check for opt-in Chatterbox APIs.

Python signatures are inspected only: this module must never instantiate a
checkpoint, prepare a voice prompt, make network requests, or emit private
argument values. A wrapped/opaque signature is classified as unverified.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import inspect
from typing import Any


def _accepts_keyword(method: Any, keyword: str) -> bool | None:
    if not callable(method):
        return False
    try:
        parameters = inspect.signature(method).parameters
    except (TypeError, ValueError):
        return None
    named = parameters.get(keyword)
    if named is not None and named.kind in (
        inspect.Parameter.POSITIONAL_OR_KEYWORD,
        inspect.Parameter.KEYWORD_ONLY,
    ):
        return True
    # A generic **kwargs wrapper accepts the keyword syntactically but might
    # discard it, transform it or pass it into an older incompatible runtime.
    # It is not evidence of actual V3/reference support.
    if any(
        parameter.kind == inspect.Parameter.VAR_KEYWORD
        for parameter in parameters.values()
    ):
        return None
    return False


def inspect_chatterbox_api(
    entrypoint: Any, *, needs_v3: bool, needs_reference: bool,
) -> str:
    """Return a fixed status code for the requested optional features.

    Default V2/no-reference operation preserves older working installations;
    no introspection is required for that legacy usage.
    """
    if not needs_v3 and not needs_reference:
        return "not_requested"
    if entrypoint is None:
        return "unavailable"
    unknown = False
    if needs_v3:
        v3_supported = _accepts_keyword(
            getattr(entrypoint, "from_pretrained", None), "t3_model",
        )
        if v3_supported is False:
            return "v3_unsupported"
        unknown = unknown or v3_supported is None
    if needs_reference:
        reference_supported = _accepts_keyword(
            getattr(entrypoint, "generate", None), "audio_prompt_path",
        )
        if reference_supported is False:
            return "reference_unsupported"
        unknown = unknown or reference_supported is None
    return "unverifiable" if unknown else "compatible"
