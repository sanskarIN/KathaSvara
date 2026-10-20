"""Model-free readiness diagnostics must remain truthful and deterministic."""
from __future__ import annotations

import importlib.util

import pytest

from kathasvara.diagnostics import diagnose


@pytest.mark.parametrize("installed", [True, False])
def test_dependency_probe_distinguishes_presence_without_claiming_model(
    monkeypatch: pytest.MonkeyPatch, installed: bool,
) -> None:
    names: list[str] = []

    def fake_spec(name: str) -> object | None:
        names.append(name)
        return object() if installed else None

    monkeypatch.setattr(importlib.util, "find_spec", fake_spec)
    report = diagnose()
    assert set(names) == {"numpy", "soundfile", "torch", "chatterbox"}
    assert report["dependencies_present"] is installed
    assert all(value is installed for value in report["dependencies"].values())
    assert report["model_weights_verified"] is False
    assert report["audio_synthesis_verified"] is False


def test_diagnostic_exposes_version_and_platform_without_private_paths() -> None:
    report = diagnose()
    assert isinstance(report["python_version"], str)
    assert isinstance(report["platform"], str)
    assert "home_directory" not in report
    assert "user" not in report
