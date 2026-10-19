"""Protocol contracts should not require a model download."""
import pytest

from kathasvara.cli import handle
from kathasvara.engine import VoiceSettings


def test_health() -> None:
    assert handle({"action": "health"}) == {
        "ok": True,
        "engine": "chatterbox-multilingual",
        "language": "hi",
    }


def test_unknown_action() -> None:
    with pytest.raises(ValueError, match="Unsupported"):
        handle({"action": "delete_everything"})


def test_settings_validation() -> None:
    VoiceSettings(0.5, 0.5).validate()
    with pytest.raises(ValueError):
        VoiceSettings(-2, 0.5).validate()
    with pytest.raises(ValueError):
        VoiceSettings(0.5, 2.0).validate()
