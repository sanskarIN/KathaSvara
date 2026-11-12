"""Model-free STT doctor contracts, including private-path non-disclosure.

No recognition weights, audio files, network access or microphone are used.
SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from kathasvara import stt_doctor


def test_doctor_no_model_uses_offline_fixed_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(stt_doctor.MODEL_ENV, raising=False)
    report = stt_doctor.probe_from_environment()
    assert report["python_311"] is True
    assert report["model_files_present"] is False
    assert report["ready_to_transcribe"] is False
    assert report["model_loaded"] is False
    assert report["audio_transcribed"] is False
    assert report["network_used"] is False


def test_doctor_local_folder_preflight_never_loads_weights(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    folder = tmp_path / "Private Hindi मॉडल"
    folder.mkdir()
    for name in ("model.bin", "config.json", "tokenizer.json"):
        (folder / name).write_bytes(b"fixture")
    monkeypatch.setenv(stt_doctor.MODEL_ENV, str(folder))

    class MustNotLoad:
        def __init__(self, *_: object, **__: object) -> None:
            raise AssertionError("Preflight must not load inference weights")

    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=MustNotLoad))
    report = stt_doctor.probe_from_environment()
    assert report["ready_to_transcribe"] is True
    assert report["model_files_present"] is True
    assert report["next_action_code"] == "run_transcription"
    assert report["model_loaded"] is False
    assert report["audio_transcribed"] is False
    assert report["network_used"] is False

    assert stt_doctor.main() == 0


def test_doctor_rejects_unbounded_path_without_disclosing_it(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    secret = "PRIVATE_PATH=" + "Z" * 4096
    monkeypatch.setenv(stt_doctor.MODEL_ENV, secret)
    assert stt_doctor.main() == 1
    output = capsys.readouterr().out
    response = json.loads(output)
    assert response["ok"] is False
    assert response["error"] == "SetupProbeFailed"
    assert secret not in output
    assert "model_path" not in output


def test_standalone_doctor_process_requires_no_optional_packages() -> None:
    env = os.environ.copy()
    env.pop(stt_doctor.MODEL_ENV, None)
    completed = subprocess.run(
        [sys.executable, "-m", "kathasvara.stt_doctor"],
        input="", text=True, capture_output=True, env=env, timeout=15, check=False,
    )
    assert completed.returncode == 0
    response = json.loads(completed.stdout)
    assert response["ok"] is True
    assert response["result"]["model_loaded"] is False
    assert response["result"]["audio_transcribed"] is False
    assert response["result"]["network_used"] is False
