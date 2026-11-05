"""Safe, actionable hints for real speech-model failures.

Do not echo arbitrary upstream exception text: it may contain local paths,
download URLs or credentials. This classifier is only a hint, never a claim
that model weights or Hindi output have been verified.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import errno


def describe_model_failure(exc: Exception, *, stage: str) -> str:
    """Categorize upstream loading/generation errors without exposing internals."""
    if stage not in {"load", "generate"}:
        raise ValueError("Unknown speech operation.")
    name = type(exc).__name__.casefold()
    # Inspect details only for categories; never include them in the reply.
    details = f"{name} {exc}".casefold()[:4096]
    activity = "load the speech model" if stage == "load" else "generate speech"

    if isinstance(exc, MemoryError) or any(term in details for term in (
        "out of memory", "outofmemoryerror", "cuda error: out of memory",
        "not enough memory",
    )):
        return (
            f"Unable to {activity}: insufficient RAM or GPU memory is possible. "
            "Close memory-heavy applications or try supported hardware."
        )
    if (isinstance(exc, OSError) and exc.errno == errno.ENOSPC) or any(
        term in details for term in ("no space left on device", "disk full")
    ):
        return (
            f"Unable to {activity}: disk space may be exhausted. "
            "Free space for model weights and audio output, then retry."
        )
    if any(term in details for term in (
        "gatedrepoerror", "gated repo", "repositorynotfounderror",
        "401 client error", "403 client error", "access to model is restricted",
    )):
        return (
            f"Unable to {activity}: model access may require approval or "
            "authentication under the upstream model terms. Check official "
            "model access and permissions."
        )
    if any(term in details for term in (
        "connectionerror", "connecttimeout", "readtimeout", "name resolution",
        "nameresolutionerror", "network is unreachable", "ssLError".casefold(),
        "offline mode",
    )):
        return (
            f"Unable to {activity}: model download or network access may be "
            "unavailable. Check connectivity and the local model cache."
        )
    if any(term in details for term in (
        "no module named", "cannot import name", "dll load failed",
        "undefined symbol", "incompatible", "operator torchvision",
    )):
        return (
            f"Unable to {activity}: speech dependencies may be missing or "
            "incompatible. Verify Python 3.11 and reinstall a compatible "
            "Chatterbox/PyTorch environment."
        )
    return (
        f"Unable to {activity}. Run the explicit local Hindi speech smoke test "
        "and review Python/Chatterbox compatibility and model access. "
        "No WAV has been verified."
    )
