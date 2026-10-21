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

The initial resolved graph includes **Vite 5.4.21** within the previously declared `^5.4.0` range. This maintenance batch **does not** make an untested major Vite, Vitest or Tauri upgrade. Audit findings or future Dependabot PRs require separate compatibility review. See [issue #33](https://github.com/sanskarIN/KathaSvara/issues/33).

## Release immutability and limitations

Previous version-specific GitHub publication workflows are kept unchanged to preserve their tested SHA and release history. Future release workflows should use `npm ci` and a complete pinned graph. The [v0.5.0 pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.5.0) is an unsigned developer EXE, not a complete installer, and manual Chatterbox Hindi playback and clean Windows installation acceptance remain open in [issue #3](https://github.com/sanskarIN/KathaSvara/issues/3).
