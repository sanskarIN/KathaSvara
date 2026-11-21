"""Guard source-only v0.5.7 pre-release validation against accidental publish.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = ROOT / ".github/workflows/release-v0.5.7.yml"


def test_v057_manual_dispatch_defaults_to_validation_only() -> None:
    workflow = WORKFLOW.read_text(encoding="utf-8")
    dispatch = workflow.partition("\npermissions:")[0]
    assert re.search(r"(?m)^  workflow_dispatch:$", dispatch)
    assert re.search(r"(?m)^      release_sha:$", dispatch)
    assert re.search(
        r"(?m)^      publish_release:\n"
        r"        description: .*\n"
        r"        required: true\n"
        r"        default: false\n"
        r"        type: boolean$",
        dispatch,
    )
    assert not re.search(
        r"(?m)^  (push|pull_request|schedule|workflow_run):", dispatch
    )


def test_v057_publication_requires_opt_in_after_successful_build() -> None:
    workflow = WORKFLOW.read_text(encoding="utf-8")
    publish = workflow.partition("\n  publish:")[2]
    assert publish, "Expected guarded publish job"
    assert re.search(
        r"(?m)^    if: \$\{\{ success\(\) && inputs\.publish_release == true \}\}$",
        publish,
    )
    assert "gh release create v0.5.7" in publish
    assert "--prerelease" in publish
