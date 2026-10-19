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


def test_inspection_is_real_and_requires_no_model() -> None:
    result = handle({"action": "inspect", "text": " राजा  भोज।\nक्या हुआ? "})
    report = result["result"]
    assert report["normalized"] == "राजा भोज।\nक्या हुआ?"
    assert report["changed"] is True
    assert report["chunk_count"] == 2
    assert report["chunks"] == ["राजा भोज।", "क्या हुआ?"]


def test_inspection_empty_is_rejected() -> None:
    with pytest.raises(ValueError, match="Enter Hindi"):
        handle({"action": "inspect", "text": "  "})


@pytest.mark.parametrize("bad_value", [float("nan"), float("inf"), -float("inf")])
def test_non_finite_voice_settings_are_rejected(bad_value: float) -> None:
    with pytest.raises(ValueError):
        VoiceSettings(bad_value, 0.5).validate()
    with pytest.raises(ValueError):
        VoiceSettings(0.5, bad_value).validate()
