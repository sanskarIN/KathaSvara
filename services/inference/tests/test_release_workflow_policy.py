"""Prevent old KathaSvara version-specific release workflows from auto-running.

This test inspects the workflow event and immutable-tag guard using stdlib only.
It is deliberately independent of yaml parsing and speech/model dependencies.

SPDX-License-Identifier: MPL-2.0
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
PUBLISHED_VERSIONS = (
    "v0.2.1",
    "v0.3.0",
    "v0.4.0",
    "v0.4.1",
    "v0.4.2",
    "v0.5.0",
    "v0.5.1",
)


@pytest.mark.parametrize("version", PUBLISHED_VERSIONS)
def test_published_release_workflow_is_manual_and_refuses_existing_tag(
    version: str,
) -> None:
    path = REPO_ROOT / ".github" / "workflows" / f"release-{version}.yml"
    workflow = path.read_text(encoding="utf-8")
    header, separator, _jobs = workflow.partition("\npermissions:")
    assert separator, f"{path.name}: expected a top-level permissions boundary"
    assert re.search(r"(?m)^on:\s*$", header)
    assert re.search(r"(?m)^  workflow_dispatch:\s*$", header)
    assert re.search(r"(?m)^      release_sha:\s*$", header)
    assert not re.search(
        r"(?m)^  (push|pull_request|schedule|workflow_run|repository_dispatch):",
        header,
    ), f"{path.name}: previously published tags must not be auto-republished"

    assert f'git/ref/tags/{version}"' in workflow
    assert f"gh release view {version} --repo" in workflow
    assert 'test "$GITHUB_REF" = "refs/heads/main"' in workflow
    assert 'test "$main_sha" = "$RELEASE_SHA"' in workflow
    assert '[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]' in workflow


def test_active_validation_workflows_keep_regular_ci_events() -> None:
    ci = (REPO_ROOT / ".github" / "workflows" / "ci.yml").read_text(
        encoding="utf-8",
    )
    event_header = ci.partition("\npermissions:")[0]
    assert re.search(r"(?m)^  push:\s*$", event_header)
    assert re.search(r"(?m)^  pull_request:\s*$", event_header)
