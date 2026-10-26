# Changelog

## v0.5.3 draft development (not merged or published)

- Retire pending plan/audit requests when starting narration so late no-model results cannot contaminate active-render status. Prevent export of a privacy-safe audit report after its source audit was invalidated while choosing a destination; check operation ownership before and after I/O. Add mock-Tauri concurrency tests for late plan/audit replies and obsolete exports.


- Isolate asynchronous model-free render plans and production audits by request epoch. Switching documents cancels their UI ownership without letting a late result overwrite the new story or clear a newer loading indicator. Block story saves while narration owns an active render, and suppress late cancellation responses for retired jobs. Cover these cases with mocked desktop concurrency tests.


- Validate **Add character**, **Duplicate voice profile**, and **Add scene** synchronously before updating React state. Report rejected edits without invalidating the current generated WAV, and create new clone IDs once outside state updaters. Add mocked desktop tests for rejected duplicate names, ambiguous profiles, overlong titles and deterministic successful changes.


- Harden local render/preflight selection: refuse nonexistent or duplicate character IDs and ambiguous scene/line IDs (including duplicate stage directions), while allowing independently valid scene scopes. Disable invalid-speaker line retry with an actionable correction hint. Add unit and mocked desktop tests demonstrating invalid requests never reach Tauri/model IPC.


- Guard **Reviewed spoken text** during active parsing/save/render: disable the editor and reject stale blur edits so they cannot retire an in-flight narration or overwrite its source snapshot. A mocked render regression verifies preservation and post-render editing availability.


- Add an accessible **Jump to speaker issue** selector with bounded Hindi text previews, clear missing/unassigned speaker labels, and current issue position feedback. Reveal the target despite search filters, focus its speaker dropdown, and disable navigation when resolved. Includes unit and desktop regression tests; no automated character assignments or model calls.


- Extend speaker review with a **Previous speaker issue** action: navigate backwards across scenes, wrap to the last pending issue, and continue relative to corrected lines. Reuse the existing focus/highlight and filter-reveal behavior without making edits or invoking speech synthesis. Add reverse-order pure unit and mocked desktop tests.


- Add story-wide **Next speaker issue** navigation: jump and focus the next unassigned or invalid spoken line, wrap in original scene order, continue after a repaired line and reset cursor when switching stories. Clear filters that would hide the target; stage directions are excluded and narration/persistence are untouched. Includes model-free and mocked desktop regression tests.


- Repair a scene-review blind spot: include non-null speaker IDs absent from the cast in the **needs speaker review** filter, show their per-scene counts separately from unassigned dialogue, warn before saving or rendering, and make stale speaker IDs explicitly visible in the assignment selector. Ignore invalid metadata on unspoken stage directions. Add model-free TypeScript and mocked React/Tauri tests; still draft-only, with v0.5.2 main unchanged.

- Show a collapsible local cast-coverage summary with per-character spoken turns and scene appearances, plus separate counts for stage directions, unassigned dialogue and unknown cast references. Exclude directions from actor appearances; never send, persist or synthesize content when viewing the report. Add deterministic TypeScript and mocked desktop UI tests.

- Isolate desktop render jobs across story switches and edits: cooperatively cancel retired jobs, reset their UI lock, scope progress polling to the current job, discard late audio responses, and prevent obsolete success/error/finally callbacks from clearing a newer narration attempt. Add mocked React/Tauri race regressions; this does not certify a clean-Windows end-user render or human-reviewed Hindi voices.

- Add a cast-specific filter to the local Hindi scene outline: show scenes containing actual spoken dialogue assigned to a selected character. Combine with existing Unicode search and unresolved-speaker review, exclude stage directions from actor appearances, and clear the filter when switching projects or removing a character. Includes model-free TypeScript and mocked desktop regression coverage; no synthesis, persistence or speech-quality claim.

- Introduce a **local searchable scene outline** in the desktop: find Hindi scene titles, original/reviewed dialogue, source labels, stage directions or production notes; filter scenes with unresolved speech assignments; display counts of spoken lines, directions, unknown speakers and notes. Navigation filtering does not edit/synthesize/transmit project content, and selecting a match opens the full scene. Reset private search/filter state when loading another story. Unit and mocked React tests cover normalized Unicode searches, speaker-resolution updates, empty results, clearing filters, story switching and unchanged story data.

- Extend model-free **native Python round-trip tests** to cover merged Hindi scenes with copied production-note context, preserved dialogue IDs and review/cache metadata, source text equality and render preflight counts; assert 4,000-character notes / 2,000-line scene limits at deserialization. This proves schema interoperability in tests, not real device or voice QA.

- Prevent unsaveable editor documents by validating new scene/character IDs before insertion (nonempty, 80-character cap, no controls/outer spaces) and rejecting cross-scene line moves into a full 2,000-line scene. Test both success cases and rejected edits with the original source untouched.

- Add **Merge with next scene (keep dialogue)** as a confirmed, non-destructive structural edit. Joining adjacent scenes retains every existing line in the same order with its speaker, reviewed text, status and audio metadata; the successor scene's title and production notes are kept in nonspoken production notes. Refuse ambiguous IDs, >2000 combined segments or >4000 combined note characters. The original script remains unchanged and explicit Save is required. Add unit and mocked React desktop tests.


- Harden existing cast and scene mutation helpers against ambiguous IDs: reject missing or repeated scene/character/line identities during rename, reorder, speaker reassignments and reviewed-speech edits. Preserve generated audio/metadata on unchanged speaker, text or same-scene moves; do not append a line when moving it to its own scene. Disable invalid scene-boundary buttons and block desktop mutation controls during parsing/rendering. Add model-free and mocked desktop regressions.

- Ensure **Duplicate scene** adds copy suffixes without cutting a UTF-16 surrogate pair in a long emoji/mixed Unicode scene title, consistent with scene-splitting title safety; add a Unicode regression test.

- Add **Split scene here** before any non-first spoken line or stage direction. Keep original Hindi source text, pronunciation glossary, actor assignments, reviewed lines, existing per-line audio metadata and overall order unchanged. Place the new scene immediately after the source, give it a unique bounded `(part 2)` title and empty editorial notes, and make Save explicit. Reject duplicate/invalid scene identities, ambiguous line IDs and 200-scene overflow. Cover pure TypeScript and mocked desktop React flows (without speech synthesis).

- Fail closed on ambiguous scene IDs during cross-scene line moves and in-scene reordering, and on malformed generated scene/line IDs during duplication. Keep long Unicode character names within safe UTF-16 input bounds without splitting emoji surrogate pairs; add regression tests. Draft-only, no changes to v0.5.2 release gate.

- Harden **Duplicate voice profile** and character creation against invalid or conflicting IDs, accidental over-capacity casts (100 characters), and overlong Hindi copy names. The desktop disables add/duplicate controls at the native validation limit or during renders. Copied settings remain a configuration profile, **not proof of a distinct generated speaker**. Include model-free TypeScript and React boundary regressions.

- Fix deferred React editor updates by capturing speaker, destination scene, character name and voice-slider input values immediately rather than later reading a mutable browser event object. Add a queued scene-move regression and resolved-speaker integration coverage.

- Fix stale unknown-speaker warnings: the banner now reflects active, unresolved scene lines instead of permanently showing the parser's earlier unknown-label list. Correcting a speaker clears the warning without synthesis.

- Add 4000-character **production notes** for scenes, explicitly excluded from narration, with validation and unsaved-state tracking. Add a **confirmed Delete Scene** action that removes only the selected parsed scene, preserves the original script and other content, and falls back to a neighboring scene selection; cancellation leaves the story untouched. Cover controls and pure edit helpers with tests.

- Support **Duplicate scene (fresh audio)** to copy reviewed Hindi dialogue, actor assignments and stage directions with new scene/line identities while explicitly clearing cached/generated audio metadata. Insert directly after its source with a distinguishable title. Enforce the 200-scene and 256-spoken-cue limits and reject ID conflicts. Add unit and React regressions without copying any model output.

- Add in-scene ↑/↓ reordering controls for dialogue and stage directions without altering the original script, scene IDs, spoken Hindi text or actor assignments. Guard missing/duplicated segment identities, disable edge controls, preserve local data and reuse the existing editor's stale-WAV invalidation and unsaved-state tracking. Add unit and mocked-Tauri React tests. Source draft only; v0.5.2 publication and real Hindi/Windows manual acceptance remain separate. [Development notes](docs/releases/v0.5.3-development.md).

## Unreleased — v0.5.2 experimental developer pre-release candidate (not published)

- Prevent delayed dialogue parsing, v2 story saves and stored-story loads from overwriting the **current** editor after a user changes documents or edits content. Ignore stale render failure notifications and audit-export completion messages, without claiming to cancel a filesystem write already in progress. Add mocked-Tauri React races and stale-error regressions; no speech model or published pre-release affected.

- Read inline WAV previews through the **same opened and RIFF-validated file handle**, rather than reopening the pathname after inspection; cap bytes to the 25 MiB WebView preview budget and compare opened-file metadata before/after reading. Refuse truncated, grown or modified preview sources. Add Rust regressions for exact payload, forged lengths and mutation. This is best-effort file consistency, not an immutable snapshot or real Hindi voice acceptance.

- Compare worker-reported sample rate and duration with the **actual opened PCM16 WAV header and frame count** before returning audio preview/export metadata. Preserve bounded RIFF validation and reject contradictory worker metadata instead of accepting an otherwise well-formed WAV with incorrect timestamps. Add Rust frame-derived-duration and falsified-metadata regressions; these do not prove natural Hindi audio.

- Tighten Rust-side measured subtitle timeline validation before any results reach the desktop: reject duplicate segment IDs, cues that become zero-duration or overlap after SRT millisecond rounding, unwanted control characters and overlong individual Hindi captions. Preserve legitimate multiline Hindi formatting and add native Rust regressions. Structural correctness is not human listening or word-level alignment.

- Harden rendered Hindi caption previews and SRT export against unknown story-segment identities or cue endpoints past the actual WAV duration, including valid rounding tolerances. Add a local-only, bounded text search over already validated cues that resets pagination without changing the exported SRT or QA checklist. Add component and unit regressions; no model loading, released binaries or publication changes. See [v0.5.2 development](docs/releases/v0.5.2-development.md).

- Add a **local Hindi dialogue subtitle cue preview** before exporting SRT: reuse the complete rounded-millisecond SRT validation path, reject duplicate segment IDs and control characters, paginate 10 cues at a time, and seek inline WAV audio to individual cues. A preview does not export a file or mark the human QA checklist. Add React integration and Vitest coverage; published v0.5.1 assets and metadata unchanged. See [v0.5.2 development notes](docs/releases/v0.5.2-development.md).

- Guard cancellation and progress bookkeeping sidecars against clobbering other files. Native Windows cancellation now uses exclusive create-new markers, supports safe repeated requests without rewriting the marker, and rejects pre-existing symlink/directory/oversized entries. Python progress writes use exclusive, randomized sibling files instead of the predictable `.partial` name; do not remove a competitor's temporary entry on collisions, and preserve previous progress if replacement fails. Add Rust and model-free Windows/Python regression tests. Source-only; published v0.5.1 unchanged.

- Add privacy-preserving recovery diagnostics: Python limits persisted exception labels to fixed categories rather than custom class names; the native history API exposes only a fixed, allowlisted failure code; React presents safe, actionable suggestions for interrupted, cancelled, incomplete, storage, validation and runtime failures. Legacy/unknown values are never rendered verbatim. Add Python, Windows Rust and React unit/integration regressions. Source-only; published v0.5.1 assets unchanged.

## v0.5.1 — experimental recovery and cache maintenance pre-release

This section documents source changes prepared for the gated v0.5.1 developer pre-release. It does not certify natural Hindi speech, clean Windows operation or a complete installer. The GitHub release is published only after exact-commit gates pass.

- Bound local segment-cache inventory to **20,000 directory entries** (including irrelevant files and symlinks); inspection and explicitly requested pruning now fail before any deletion if the directory exceeds the limit. Reject NaN/infinite, boolean, negative and implausible caller clocks so the ten-minute cache grace window cannot be bypassed. Add model-free regression tests and maintenance guidance. Source-only; published v0.5.0 pre-release unchanged.

- Keep Python render journal progress transactional: if a disk write fails, restore the prior in-memory progress and terminal state so a subsequent failure record cannot falsely include an uncommitted dialogue segment. Prevent writes beyond the planned segment count, and report an incomplete normal exit as `IncompleteRender` rather than `completed`. Add model-free disk-failure and interruption regressions. No audio or model behavior changed; v0.5.0 remains the published pre-release.

- Protect the desktop recovery panel from stale asynchronous results: invalidate pending history loads on edits, document switches and fresh narration; ignore late deletion feedback for an obsolete story; prevent completed progress polls from a previous job from repainting the current job. Add mocked Tauri React integration regressions. No model is loaded, and the published v0.5.0 pre-release remains unchanged.

- Cap **actual** native recovery JSON reads, not just pre-read filesystem sizes: read at most 65,537 bytes for journal histories and 1,025 bytes for progress files, validate regular files and their opened handles, and refuse oversize/malformed data. Apply the same bounded parser to manual journal forgetting and keep existing story/identity safety checks. Add Windows Rust regressions for growing streams, symlinks, oversized histories and progress counters. Source-only; v0.5.0 prerelease unchanged.

- Bound the native Windows recovery-history directory scan to 20,000 entries including non-journal files; fail clearly instead of sorting an unbounded folder or silently hiding older matching stories. Ignore inconsistent `completed` records whose `done` count is below `total`. Add model-free Rust regression tests for limit boundaries, filtering and terminal progress validity. Source-only; the existing v0.5.0 developer release stays unchanged.

- Harden initial render-journal publication against a concurrent destination-file or symlink creation: create a complete temporary JSON snapshot, use atomic no-overwrite hard-link publication for the first write, and fail closed if linking is unavailable. Keep later atomic journal updates and privacy-minimal metadata unchanged. Add no-model race regressions and a dedicated native-Windows Python test gate. [Journal safety contract](docs/maintenance/render-journal-safety.md). Source only; published v0.5.0 assets remain unchanged.

- Make the desktop model-free WAV review parser fail closed on contradictory inspection results: validate mono PCM16 sample rate/frame count, reported duration and minimum container size, sensible dBFS values and agreement between quality hints and the aggregate review flag. Allow rounding tolerance at precise advisory thresholds, without auto-approving Hindi speech. Add Vitest and mocked desktop IPC regression coverage. Source only; the v0.5.0 developer binary remains unchanged.

- Align the Python read-only WAV inspector with native Rust RIFF/PCM16 header checks: verify complete RIFF and chunk lengths, PCM byte-rate/block alignment, reject duplicate fmt/data chunks and excessive metadata, while allowing bounded padded non-audio chunks. Add no-model malformed-container regression tests. Source only; v0.5.0 prerelease unchanged.

- Tighten native WAV preview/export header consistency: verify PCM16 byte rate equals sample rate × two bytes, reject ambiguous duplicate fmt/data chunks in the small in-memory preview validator, bound metadata-chunk count and reject recordings beyond 20 minutes. Add Rust tests using correctly sized but malformed headers. No new model, changed audio output, or published release assets.

- Suppress stale WAV and dialogue SRT export **success/error UI feedback** if a creator clears, replaces or edits the active audio while native export is still running. Keep subtitle manual-review eligibility scoped to the current audio. Add mocked desktop race regressions for delayed WAV/SRT success and errors. A completed old export may still exist at its explicit destination, but it must not be attributed to the new preview.

- Detect concurrent changes to locally generated WAV files during native streaming export even when their byte lengths stay unchanged. Compare opened-file modification timestamps and size before/after container validation and the output copy; remove the newly created destination if a change is detected. Add deterministic Rust metadata regression coverage. This is best-effort race detection, not a filesystem snapshot or human Hindi acceptance.

- Connect the existing offline, model-free WAV quality inspector to the **Character and Scene Studio** desktop review panel. Use only a UUID-scoped generated audio path in Rust, sanitize private error paths, display quiet/clipping/long-pause hints and allow a local seek to an internal pause; reject stale inspections when the project/audio changes. Add Python protocol, TypeScript report-validation and mocked desktop IPC regressions. This does not auto-approve the human listening checklist or change published v0.5.0 assets.

- Add model-free, streaming **long internal quiet-span inspection** to exported mono PCM16 WAV acceptance reports: record the longest low-amplitude pause and its seek offset only when bounded by audible samples, while excluding leading/trailing silence. Flag 3-second internal gaps for optional human review without treating quiet passages as corrupt files. Includes regression tests across 8192-frame blocks and updated [WAV QA guidance](docs/qa/offline-wav-inspection.md). No real Hindi model or Windows listening acceptance is claimed.

- Strengthen the read-only offline WAV inspector to reject concurrent file mutations even when the file length stays unchanged, using opened-file identity and nanosecond modification/metadata timestamps around the existing PCM and SHA-256 scans. Include a no-model regression test; these checks cannot certify an adversarial immutable snapshot or genuine Hindi narration.

- Retire automatic `push` triggers for **already published** v0.2.1–v0.5.0 release workflows, retaining manual exact-SHA/tag-existence guards to prevent accidental republishing when workflow dependencies change. Add automated policy regressions and [release workflow lifecycle guidance](docs/maintenance/release-workflow-lifecycle.md). No tags or assets modified.

- Preserve Devanagari written units when splitting overlong, unspaced speech tokens: avoid breaking vowel signs, nukta, virama conjuncts or zero-width Indic joiners at model-input chunk boundaries. Fail closed for a written unit larger than the 280-character chunk budget, without truncating the source. Add no-model regressions and [chunk-boundary QA notes](docs/qa/hindi-chunk-boundaries.md). This is source development, not real-model Hindi acceptance or a new published release.

- Update source-build TypeScript from 5.9.3 to **7.0.2** on top of tested React 19/Vite 8/jsdom 30 dependencies. Rebuild the npm lockfile, verify all 55 React tests, successful TypeScript 7 typecheck/Vite production build and npm audit. Use the normal Windows Rust and unsigned EXE candidate checks as merge gates; no v0.5.0 tag or published binary changes.

- Upgrade the React 18 desktop runtime to **React 19.3.1 and React DOM 19.3.1 together**, with corresponding 19.3 type packages and refreshed npm lockfile. Both independent Dependabot PRs #40/#41 failed npm ci due to mismatched peers; the combined source-only migration passed 55 React tests, TypeScript production build and npm security audit before Windows CI. Remove the one-time privileged bootstrap workflow. Published v0.5.0 assets remain unchanged.

- Migrate source-build tooling from Vite 5.4.21 / React plugin 4.7.0 / Vitest 2.1.9 to exact Vite 8.3.5 / React plugin 6.1.2 / Vitest 5.0.5; regenerate npm lockfile (159 entries) and run 55 React tests, TS build and npm audit on Node 22. Add high-severity npm audit to CI, lockfile cache and weekly Dependabot configuration for npm/Actions. Keep changes unreleased, with original tag/assets untouched.
- Commit npm v3 lockfile generated and verified in GitHub Actions with Node 22, and use `npm ci` for React CI and the Windows executable candidate. The one-time branch-only bootstrap workflow was removed immediately after use. Preserve previously published prerelease assets and workflows; no model/Windows acceptance claims. See [npm dependency policy](docs/maintenance/npm-dependencies.md).


## [v0.5.0 — Experimental developer pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.5.0)

- **Experimental Windows x64 developer EXE, README and SHA-256 checksums** published only if the exact-SHA release workflow succeeds. No bundled Python/model, signed installer or manually accepted Hindi voice quality. [Release notes](docs/releases/v0.5.0-notes.md).

- Add conservative streamed offline WAV level statistics (RMS/peak dBFS, clipped-sample fraction, silence/clipping hints) for human QA triage. Metrics do not certify Hindi listening, synthesis quality or voice distinction.

- Add mocked React desktop interaction tests for model-free audit/export, scoped WAV/SRT generation, per-WAV review, stale-dialog invalidation and confirmed history retry; expand Windows/Hindi manual listening and clean-machine acceptance guidance, without claiming real-model results.

- Suggest matching Hindi-safe WAV/SRT filenames tied to the original render scope (whole story, selected scene or line), not to the current UI tab; reject stale save dialogs if the document or active audio changes.

- Offer explicitly confirmed fresh full-story retries for failed/cancelled/interrupted render journals tied to the current story, reusing only valid unchanged cached dialogue (not silently reconstructing original scene selection).
- Add an opt-in, nonpersistent, per-WAV human QA checklist for listening, pronunciation, dialogue turns and exported Hindi SRT review; no item is auto-approved, and re-render/edits reset the checklist.

- Add opt-in, strictly bounded privacy-safe JSON production manifest export. Export only scene numbers, aggregate render-plan counts and fixed readiness codes, with no script text, actor names, IDs or voice settings; Rust rejects extra fields and existing output files.

- Introduce model-free, per-scene Hindi production readiness audit with aggregate counts and privacy-safe reason codes; report whole-story plan readiness separately from individually valid scenes.
- Wire the read-only audit through Python CLI, Rust/Tauri IPC and CastStudio and add model-free regression tests; no genuine speech or Windows acceptance claims.

## [v0.4.2 — Published experimental developer prerelease](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.4.2)

- **Published October 21, 2026** from exact release SHA `07fb6f4`; [guarded release workflow](https://github.com/sanskarIN/KathaSvara/actions/runs/39540443967) passed all test/build and uploaded-asset checks. Includes an unsigned Windows x64 developer EXE and SHA-256 companion, not a complete installer.

- Enable explicit full-story or selected-scene model-free preflight with a shared typed render scope, preserving scene/line retry parity and private script text.
- Reject over-budget cached WAVs by header frame count before loading PCM; skip symlinked cache aliases before metadata inspection. Add model-free tests for both.

- Begin a privacy-preserving model-free render-plan inspection path with selected segment validation and counts computed after Hindi pronunciation rules. No audio-quality claims or release yet.
- Share one pre-synthesis, in-memory Hindi effective-text/chunk snapshot between model-free preflight and actual render, preventing duplicate glossary passes and preserving summary privacy. Add model-free regressions for unchanged scripts and targeted retries.

## [v0.4.1 — Published experimental developer pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.4.1)

- Reject selected or forced-retry segment IDs outside the chosen scene/line set before model loading instead of silently ignoring requests; respond to pre-load cancellation before doing expensive inference setup.
- Enforce 20-minute cumulative audio frame limits on model chunks and planned inter-speaker pauses **before** writing reusable cache WAVs; model-free regressions assert rejected renders do not publish oversized cache/audio files.
- Keep verified long-story WAV outputs on disk when they exceed the 25 MiB inline webview preview threshold, exposing an **export-only** UI state instead of deleting valid audio.
- Stream native WAV export to a new destination without buffering the entire recording; reject malformed RIFF/PCM16 headers, invalid durations, oversized files and existing export paths.
- Carry ephemeral, pronunciation-glossary-adjusted spoken text alongside measured dialogue timings so Hindi SRT export matches the generated narration rather than a potentially changed source document.
- Confirm through Python/Rust/React tests that persistent render journals do not record the story text and that large local WAV exports are bounded and safe.
- Correct native SubRip export to accept real newlines instead of literal backslash characters; validate actual cue ordering, sequence numbers, timestamps, readable text, 20-minute duration and 256-cue bounds.
- Validate rounded millisecond cue times consistently between React and Rust; reject zero-length/overlapping captions before writing.
- Reject incomplete or inconsistent synthesis metadata and delete only the failed job's WAV rather than allowing silent orphan files after a completed Python subprocess.
- Add Hindi SRT, malformed/escaped caption, native large-WAV recovery and rounded-timing regression cases.
- Add explicit Settings preview and confirmed cleanup for **abandoned generated `.partial.wav` files older than 24 hours** in the dedicated audio and segment-cache folders; never remove final WAVs, story files, audio exports, recovery journals, recent files, symlinks or unrelated filenames.
- Use the cross-process speech-cache lock for both inspection and destructive cleanup; block active in-app renders and cap scans to 20,000 entries and deletions to 1,024 files per confirmation.
- Add no-model tests for dry-run reporting, permission-free simulated stale entries, preservation of valid assets, symlink refusal and active-worker contention.
- Fix abandoned partial WAV cleanup to recognize the actual `uuid4().hex` suffix generated by both the streaming composer and speech cache writers; earlier v0.4.1 cleanup tests used an incompatible second hyphenated UUID.
- Complete and validate the bounded directory scan before any deletion; refuse symlinked target folders, out-of-scope names, and oversized scans without partially cleaning eligible files.
- When explicitly forgetting an inactive render-history record, remove only matching UUID progress/cancellation sidecars after validating their type and size. Do not touch the rendered WAV, speech cache, story file, or other jobs' bookkeeping files.
- Expand no-model Python and Windows Rust regression tests for actual writer filenames, scan-abort non-deletion and safe job-specific sidecar removal.
- **Publication:** the [v0.4.1 prerelease](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.4.1) was published from exact commit `0ec3d9e` after the [guarded release workflow](https://github.com/sanskarIN/KathaSvara/actions/runs/39535984065) passed all checks and verified three uploaded assets. Real Hindi voice-quality and Windows clean-install acceptance remain open.

## [v0.4.0 — Published experimental developer pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.4.0)

- Protect destructive segment-cache deletion and story rendering across participating Python worker processes with a persistent OS-owned advisory file lock (POSIX flock / Windows byte-range locking); automatically release it when a worker exits, but never unlink its sentinel.
- Return measured per-dialogue PCM-frame start and end timestamps from multi-scene narration.
- Export a new UTF-8 Hindi **SubRip (.srt)** subtitle file using existing reviewed story text and the *measured segment timings*; this is scene/dialogue-level, not word-aligned transcription.
- Validate SRT cue ordering, duration, text and destination; refuse to overwrite an existing subtitle file.
- Add model-free cross-process Python lock contention tests, Hindi SRT Vitest coverage, Rust segment-timing/export tests, and Windows Python lock smoke verification in the release workflow.
- Synchronize version numbers and unsigned Windows candidate naming to v0.4.0. Publish only after exact-commit GitHub Actions verifies Python, React, Windows Rust, Windows Python locks, EXE compilation, release checksums and immutable tag.
- **Publication:** v0.4.0 was published from exact tested commit [`6773bf9`](https://github.com/sanskarIN/KathaSvara/commit/6773bf918839a215618ae8500fea1cda1b7a7b29) after the [successful guarded workflow](https://github.com/sanskarIN/KathaSvara/actions/runs/39388218828). Attached an unsigned 10,411,008-byte Windows developer EXE (SHA-256: `7ce3d90219580da15342c36967371a91bd75d63bfa02c5bf19fd6caab0465677`), `README.txt` and `SHA256SUMS.txt`. Not a standalone or signed installer.
- **Still not accepted:** real Hindi audio listening, distinct character voices, clean Windows GUI setup, bundled Python/models or a production-grade installer. See issue #3.

## [v0.3.0 — Published experimental developer pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.3.0)

- Add model-free inspection of the local SHA-256 speech-segment cache and opt-in bounded oldest-entry cleanup.
- Provide a dry-run plan before asking for explicit confirmation in the desktop Settings page; preserve recent cache entries and ignore symlinks, projects, and unrelated output files.
- Protect the Rust/Python bridge against oversized worker output deadlocks by continuing to drain stdout without exceeding the response memory cap.
- Stream composed story WAV output to a temporary file instead of retaining the full story waveform in memory; finalize the WAV and refuse to overwrite a new destination.
- Keep privacy-minimal, atomic per-job render journals with completed segment IDs, cached fingerprints and terminal states; show recent attempts per story with explicit retry guidance.
- Extend regression coverage for cache-assisted retries, cancellation and partial-file cleanup while maintaining the requirement for manual real-model acceptance.
- Classify recorded running jobs as potentially interrupted after app restart while leaving active in-process jobs marked live; limit recent history to the selected story.
- Add user-confirmed, ownership-checked removal of an individual obsolete render journal without deleting projects, audio, or speech caches.
- Preserve early cancellation requests and prevent new cache pruning during live rendering in the same app process, with Rust regression tests.
- **Release packaging:** synchronize desktop/Rust/Tauri/Python versions to v0.3.0, update the Windows developer-EXE disclaimer, add SHA-256 companions and version-locked CI publication safeguards.
- **Release status:** GitHub [published v0.3.0](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.3.0) after [all exact-commit release checks passed](https://github.com/sanskarIN/KathaSvara/actions/runs/39380201497), including SHA-256 verification of the 10,412,032-byte unsigned Windows developer executable. Release commit: `3b5c810c3f535c86cc522e1879d600f231641fd6`. v0.2.2 development was incorporated into this prerelease and was never separately published. Real Hindi audio/Windows GUI acceptance remains open.

## [v0.2.1 — Published experimental developer pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.2.1)

- Add a validated project-local pronunciation glossary (NFC, Devanagari-aware word boundaries, escaped literal matching, deterministic nonrecursive overrides), plus no-model exact pre-TTS text preview.
- Support reversible editing of reviewed spoken text without altering original story scripts or stage directions.
- Keep schema v2 backwards-compatible with v0.2.0 projects that lack optional glossary records; preserve v0.1.x files separately.
- Add stricter cache format/sample checks and reuse unchanged effective speech after unrelated pronunciation corrections; mock-engine tests never count as human voice evidence.
- Improve redacted Environment Doctor for Python/inference directory configuration and local write readiness.
- Handle first-time story IDs and stale in-flight audio more cautiously; retain unsupported/unknown speaker labels honestly.
- Add Python/React/Rust regression coverage, and replace the v0.2.0 commit-message publisher with a guarded v0.2.1 SHA-pinned manual pre-release workflow.
- **Distribution:** published an unsigned, unbundled Windows x64 EXE after [passing exact-commit checks](https://github.com/sanskarIN/KathaSvara/actions/runs/39370507279) and SHA-256 asset verification; no packaged weights, signed installer, real Hindi listening claim, or verified separate character voices. See [acceptance issue #3](https://github.com/sanskarIN/KathaSvara/issues/3).


## [v0.2.0 — Experimental developer pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.2.0)

- Add validated schema v2 for cast, voice profiles, scenes and dialogue segments, retaining v0.1.x project data without in-place rewrite.
- Parse explicitly labeled Hindi dialogue, narrator blocks, Markdown scene headings and stage directions; preserve unknown labels for manual resolution.
- Add Rust/Tauri v2 story persistence, Hindi parse bridge and a dedicated cast/scene editor.
- Add scene order, manual corrections, character duplication/reassignment and bounded per-character supported voice settings.
- Add model-reusing multi-segment PCM16 render orchestration, SHA-256 content cache, pause/fade assembly, progress, cooperative cancel signal and selective regeneration.
- Extend Python, Rust and TypeScript tests; start an unsigned Windows EXE candidate build workflow for internal verification.
- **Published as an experimental GitHub pre-release**, with an unsigned Windows EXE, checksum and explicit setup disclaimer. The EXE compiled in GitHub Actions, but real distinct-character voices, Chatterbox listening tests, clean Windows launch and production-ready installer remain unverified.


## [v0.1.1 — Source-only developer pre-release](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.1.1)

- Add a no-download diagnostics action that reports whether optional Python TTS dependencies are discoverable.
- Expose dependency findings in desktop Settings, while clearly marking model weights and Hindi audio playback **unverified**.
- Add deterministic diagnostic tests for missing and installed dependencies; no actual model downloads required.


## v0.1.0 — Source-only developer preview (pre-release candidate)

### Added

- Initial local inference module, Chatterbox Hindi adapter, Unicode processing and WAV assembly.
- Tauri Rust commands for local story projects, voice generation and WAV export.
- React Hindi story studio with basic voice controls and playback UI.
- Test foundation and CI workflow.
- Contributor, security, licensing, installation and model setup documents.

### Reliability and creator workflow improvements

- Added optional inspect-before-synthesize workflow showing exact normalized Hindi text and proposed speech chunks without model downloads.
- Added local TXT and Markdown story import with size/type validation.
- Remember supported voice parameters between desktop sessions.
- Invalidate generated-audio preview after changes to the script or voice settings.
- Reject NaN/Infinity voice parameters and use safer optional GPU-backend detection.
- Bound the local Python worker execution time and validate WAV chunk structure before playback/export.
- Added test cases and tightened CI scheduling to cancel superseded runs.
- Added explicit **Clear preview** handling and UUID-scoped deletion of cached WAV files when audio becomes stale.
- Clean up UUID-specific partial audio output if an inference worker fails or times out.

### Not yet verified

Real Hindi synthesis, supported OS desktop launches, complete end-to-end export, dependency compatibility, Windows packaging and standalone release artifacts. No v0.1.0 GitHub Release is claimed here.

> Publication is performed only by the passing v0.1.0 GitHub Actions release job. This changelog does not by itself confirm that a GitHub Release is live.
