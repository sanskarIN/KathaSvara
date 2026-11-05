"""Only vetted diagnostic text may cross the Python/desktop IPC boundary.

No model weights, GPU or audio output are required.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import io
import json
import sys

import pytest

from kathasvara import cli
from kathasvara.inference_errors import describe_model_failure
from kathasvara.public_errors import public_error_message


@pytest.mark.parametrize("exception", [
    OSError(r"Cannot open C:\\Users\\private\\voice.wav: secret=local-token"),
    RuntimeError("Codec failure at /home/private/voice.wav?token=local-token"),
    ValueError("invalid output: /home/private/story.txt"),
    TypeError("Unexpected story content: private-token"),
    ImportError("Could not import /home/private/custom-library.so"),
])
def test_untrusted_exception_details_are_never_public(exception: Exception) -> None:
    visible = public_error_message(exception)
    assert "private" not in visible
    assert "local-token" not in visible
    assert "/home/" not in visible
    assert "secret=" not in visible
    assert visible


def test_unsupported_action_error_stays_actionable() -> None:
    assert public_error_message(ValueError("Unsupported action.")) == "Unsupported action."


def test_known_model_failure_retains_actionable_hint() -> None:
    message = describe_model_failure(RuntimeError("CUDA out of memory"), stage="generate")
    assert public_error_message(RuntimeError(message)) == message
    assert "GPU memory" in message


def test_prefix_collision_does_not_trust_raw_third_party_error() -> None:
    visible = public_error_message(
        RuntimeError("Unsupported action. C:\\Users\\private\\key.txt")
    )
    assert visible != "Unsupported action. C:\\Users\\private\\key.txt"
    assert "private" not in visible


def test_actual_cli_sanitizes_invalid_voice_setting(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    secret = "private-voice-token"
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps({
        "action": "synthesize",
        "text": "नमस्कार।",
        "output": "/tmp/unused.wav",
        "exaggeration": secret,
    }, ensure_ascii=False)))
    exit_code = cli.main()
    response = json.loads(capsys.readouterr().out)
    assert exit_code == 1
    assert response["ok"] is False
    assert secret not in json.dumps(response)


def test_actual_cli_masks_unexpected_filesystem_error(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    def failed_handle(_request: dict[str, object]) -> dict[str, object]:
        raise OSError(r"Permission denied C:\\Users\\private\\recording.wav")

    monkeypatch.setattr(cli, "handle", failed_handle)
    monkeypatch.setattr(sys, "stdin", io.StringIO('{"action":"health"}'))
    assert cli.main() == 1
    response = json.loads(capsys.readouterr().out)
    assert response["ok"] is False
    assert response["error"] == "OSError"
    assert "private" not in response["message"]
    assert "Local file or audio operation failed" in response["message"]
