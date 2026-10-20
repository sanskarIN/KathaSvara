"""Protocol contracts should not require a model download."""
import json
import subprocess
import sys

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


def test_actual_cli_inspection_process() -> None:
    request = {"action": "inspect", "text": " राजा  भोज।\nनमस्कार!"}
    completed = subprocess.run(
        [sys.executable, "-m", "kathasvara.cli"],
        input=json.dumps(request, ensure_ascii=False),
        text=True,
        capture_output=True,
        timeout=15,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    response = json.loads(completed.stdout)
    assert response["ok"] is True
    assert response["result"]["normalized"] == "राजा भोज।\nनमस्कार!"
    assert response["result"]["chunks"] == ["राजा भोज।", "नमस्कार!"]


def test_cli_fails_closed_on_unsupported_action() -> None:
    completed = subprocess.run(
        [sys.executable, "-m", "kathasvara.cli"],
        input=json.dumps({"action": "surprise"}),
        text=True,
        capture_output=True,
        timeout=15,
        check=False,
    )
    assert completed.returncode != 0
    response = json.loads(completed.stdout)
    assert response["ok"] is False
    assert "Unsupported action" in response["message"]


def test_diagnostic_never_claims_model_or_audio_validated() -> None:
    result = handle({"action": "diagnose"})
    report = result["result"]
    assert result["ok"] is True
    assert report["python_version"]
    assert report["platform"]
    assert set(report["dependencies"]) == {"numpy", "soundfile", "torch", "chatterbox"}
    assert all(isinstance(value, bool) for value in report["dependencies"].values())
    assert report["model_weights_verified"] is False
    assert report["audio_synthesis_verified"] is False
    assert report["dependencies_present"] is all(report["dependencies"].values())


def test_dialogue_cli_reports_unmapped_speakers_without_voice_fakes() -> None:
    result = handle({
        "action": "parse_dialogue",
        "title": "राजा भोज",
        "script_id": "test-story",
        "text": "राजा भोज: प्रजा कैसी है?\\nअनजान: क्या हुआ?",
        "characters": [{"id": "raja", "name": "राजा भोज"}],
    })
    assert result["ok"] is True
    assert result["distinct_voices_verified"] is False
    assert result["unresolved"] == ["अनजान"]
    scene = result["result"]["scenes"][0]
    assert scene["segments"][0]["speaker_id"] == "raja"
    assert scene["segments"][1]["speaker_id"] is None


def test_dialogue_cli_validates_character_voice_capabilities() -> None:
    with pytest.raises(ValueError, match="Speaker conditioning"):
        handle({
            "action": "parse_dialogue",
            "title": "Example",
            "text": "Narrator: नमस्कार।",
            "characters": [{
                "id": "other", "name": "Other",
                "voice": {"speaker_conditioning": "borrowed-voice"},
            }],
        })
