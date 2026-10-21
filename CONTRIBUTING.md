# Contributing to KathaSvara

Thank you for improving accessible Hindi storytelling.

1. Check current issues, especially [manual real-Hindi and Windows acceptance #3](https://github.com/sanskarIN/KathaSvara/issues/3), and the [Windows/Hindi acceptance protocol](docs/qa/windows-hindi-acceptance.md). Do not claim model quality from mocked audio tests.
2. Fork the repository or work in a descriptive feature branch.
3. Keep changes small, tested and licensed under MPL-2.0 with accurate attributions.
4. Prefer real speech examples and clear reproducible reports over unsupported quality claims.
5. Never commit model weights, credentials, proprietary scripts, private recordings or generated user audio.
6. Only contribute reference-voice data with explicit authorization from the voice owner.
7. Submit a pull request with what changed, test commands/results and known limitations.

## Local checks

Python: from services/inference run python -m pytest -q and python -m ruff check .

Desktop: from apps/desktop on Node 22 run **npm ci**, `npm audit --audit-level=high`, npm run test, npm run build and npm run tauri dev. Frontend uses Vite 8/React plugin 6/Vitest 5; review migration compatibility and security alerts when changing these tools. Commit package-lock.json with any dependency update; see [dependency policy](docs/maintenance/npm-dependencies.md).

Rust: from apps/desktop/src-tauri run cargo fmt --check, cargo clippy --all-targets and cargo test.

Do not state a check passed unless you executed it. Contributions must distinguish automated checks from real native Hindi listening evaluations.

For a security vulnerability, contact [project maintainer](https://sanskarin.github.io/contact/#send-a-message) privately rather than opening a public issue.
