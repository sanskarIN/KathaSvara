# Publishing lifecycle for version-specific release workflows

## Why these workflows are archived

The KathaSvara experimental releases `v0.2.1`, `v0.3.0`, `v0.4.0`, `v0.4.1`, `v0.4.2` and `v0.5.0` are already published, each with an immutable version tag. Earlier workflows used a path-filtered `push` event on `main` so that the initial publication could start automatically when its new workflow file was added.

Once a version is published, modifying its workflow is **not** a reason to publish it again. In October 2026, GitHub Actions dependency updates touched older workflow files, triggering unnecessary failed publish attempts. The existing tag/exact-SHA guards prevented overwriting releases, but noisy failures cost CI capacity and could mislead maintainers about unrelated code changes.

## Archived workflow contract

- Published version workflows are manual-only (`workflow_dispatch`); they have **no push/pull_request/scheduled trigger**. Existing `release_sha` inputs and prepare-job guards remain intact.
- A manual dispatch of an archived workflow will deliberately **fail closed** if the tag/release already exists. It cannot be used to replace binaries or republish historical versions. It may be useful to demonstrate the guard, but should not be part of normal maintenance.
- No release tag, release note, checksum, binary, permission scope or publishing job was altered by this lifecycle hardening.
- Normal app validation still runs on `main` pushes and pull requests through `ci.yml`. The separate Windows unsigned EXE candidate workflow remains independent of historical releases.
- `services/inference/tests/test_release_workflow_policy.py` enforces the archived triggers and expected immutable-tag guard in Python CI so dependency updates do not silently reopen automatic publication.

## Procedure for a future preview release

For the specifically prepared **v0.5.2 experimental developer candidate**, follow the [one-time v0.5.2 publication and verification checklist](../releases/v0.5.2-publication-checklist.md). It documents the exact commit, authenticated manual dispatch, mandatory Windows/Python/React gates, SHA-256 asset verification, honest prerelease disclosures and post-publication website update. Do not treat that checklist as evidence that publication already occurred.

1. Implement features in a development branch, keep `main` protected, review the acceptance limitations and pass the Python/React/Rust and Windows candidate checks.
2. Add a **new** version-specific publication workflow for the new version (rather than reusing or modifying a previous version), with exact main-commit verification, clean tests, checksum verification, refusal to overwrite an existing tag/release and minimal GitHub token permissions.
3. Manually dispatch that workflow with its explicit full 40-character current `main` SHA, review the result and release asset integrity, then publish the exact version's experimental release.
4. After successful publication, archive the new workflow by removing its automatic triggers (if initially enabled) and extend the policy test's published-version list.
5. Do **not** call an unsigned, unbundled developer executable a stable installer; real Hindi model listening and clean Windows-machine verification remain tracked in [issue #3](https://github.com/sanskarIN/KathaSvara/issues/3).

**Limit:** These policy checks are static and do not evaluate a full GitHub Actions workflow YAML schema or replace real CI and release verification. They prevent regression of the specific historic auto-publication hazard.
