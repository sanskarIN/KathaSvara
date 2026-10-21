# Reproducible frontend dependencies (post-v0.5.0 maintenance)

KathaSvara's *development source* includes `apps/desktop/package-lock.json`, produced on GitHub Actions with **Node 22 / npm 10** from the public npm registry. It pins the exact transitive dependency graph and includes npm's integrity digests. This change is **not** a new tagged release and does **not** change the published v0.5.0 Windows executable.

## Fresh local development checkout

From the repository root:

```sh
cd apps/desktop
node --version
npm --version
npm ci --no-audit --no-fund
npm run test
npm run build
```

Use a supported Node.js 22 environment (as used in CI), and an npm version that supports lockfile version 3. `npm ci` **requires** the checked-in lockfile and fails rather than silently resolving a different dependency tree when it disagrees with `package.json`. `npm ci` removes and recreates `node_modules`; do not run it where you have uncommitted manual changes under that directory. CI and the Windows unsigned candidate now use `npm ci`.

The package-lock was initially generated with `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` by a short-lived, development-branch-only GitHub Action, followed by a successful `npm ci` verification. That privileged bootstrap workflow was **deleted** after generating and committing the lockfile. No separate installer, model weights or private files are included.

## Updating dependencies intentionally

1. Work on a feature branch; review the security advisory and compatibility requirements for the affected package before updating it. A lockfile does **not** make an outdated or vulnerable package safe.
2. Run `npm install <package>@<reviewed-version>` or `npm update <package>` **with a supported Node 22/npm environment** only when you intend to update dependencies. Commit changes to both `package.json` and `package-lock.json` as appropriate.
3. Run `npm ci --no-audit --no-fund`, `npm run test`, `npm run build` and the GitHub Windows Rust / candidate EXE checks. A lockfile that passes tests on one machine is not proof of cross-OS runtime compatibility or of clean Windows usage.
4. Check Dependabot and GitHub security findings. A successful Dependabot update or `npm audit` report is an input for triage, **not** a blanket security guarantee. Review major version upgrades and any plugin/build ABI changes separately.

## Reviewed 2026-10-21 Vite 8 migration (unreleased main-source changes)

The development source now pins **Vite 8.3.5**, **@vitejs/plugin-react 6.1.2** and **Vitest 5.0.5** as exact direct development dependencies, recorded in the committed npm v3 lockfile. The migrated tree contained **159 entries** in the GitHub Node 22 bootstrap. The dedicated GitHub job used `npm ci`, ran all **55 React/Vitest tests** and the TypeScript/Vite build and obtained **`npm audit --audit-level=high`: 0 known reported vulnerabilities** at verification time. It is not a guarantee against future vulnerabilities. The temporary contents-write migration workflow was deleted before merge.

The Vite 8 ecosystem replaces Rollup/esbuild with Rolldown/Oxc internally, so tests and the actual Windows Tauri unsigned EXE build must both pass before merging. Vitest 5 changes its default `clearMocks` behavior; integration tests explicitly reset mocks and remain part of CI. The app's configured Vite dev server continues listening only on **127.0.0.1:1420**, not on a public interface; do not loosen this in an update.

Active CI now runs `npm audit --audit-level=high` after `npm ci`; Dependabot is configured weekly for npm and GitHub Actions. A future registry advisory may cause audit CI to fail deliberately. Evaluate advisories rather than automatically disabling the gate. Follow [issue #33](https://github.com/sanskarIN/KathaSvara/issues/33) for evidence of a successful actual Dependabot update and any remaining dependency checks.

The **published v0.5.0 tag and unsigned developer EXE are immutable** and still contain the source/build versions used at their original publication; these new Vite 8 changes are main-branch development **only**, not a new release. 

## Joint React runtime migration after Vite 8

React `19.3.1`, React DOM `19.3.1`, `@types/react` `19.3.0` and `@types/react-dom` `19.3.0` were installed and verified **together** on Node 22, with a regenerated lockfile. The independently generated React 19 Dependabot PRs [#40](https://github.com/sanskarIN/KathaSvara/pull/40) and [#41](https://github.com/sanskarIN/KathaSvara/pull/41) failed `npm ci` from peer dependency incompatibility because each upgraded only part of the linked runtime pair. Do not merge them individually.

The combined migration passed all **55 Vitest React tests** (including mocked desktop interactions), the TypeScript/Vite production build, and `npm audit --audit-level=high` reporting zero advisories at the time of execution. These checks do **not** establish manual Windows WebView2 launch, real speech-model behavior, or future vulnerability immunity. The short-lived GitHub contents-write workflow was removed before PR merge; Windows release-candidate checks are separate merge gates.

## TypeScript 7 on the upgraded frontend

The development source now resolves **TypeScript 7.0.2** with React 19, Vite 8, Vitest 5 and jsdom 30. The migration from TypeScript 5.9.3 is captured in the lockfile (152 entries in the first regenerated graph). A Node 22 job executed `npm ci`, all **55 React/Vitest tests**, the `tsc --noEmit && vite build` production command and `npm audit --audit-level=high` with zero reported advisories at that moment. Follow-up Windows Rust and unsigned desktop candidate checks remain essential; a successful typecheck is not a runtime acceptance test.

A feature-branch-only bootstrap workflow with write access was removed immediately after updating the reviewed npm files. This change is **not a new release** and does not rewrite the published v0.5.0 artifacts.

## Release immutability and limitations

Previous version-specific GitHub publication workflows are kept unchanged to preserve their tested SHA and release history. Future release workflows should use `npm ci` and a complete pinned graph. The [v0.5.0 pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.5.0) is an unsigned developer EXE, not a complete installer, and manual Chatterbox Hindi playback and clean Windows installation acceptance remain open in [issue #3](https://github.com/sanskarIN/KathaSvara/issues/3).
