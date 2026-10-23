# Render journal first-publication safety

**Status:** post-v0.5.0 source development. This is a model-free filesystem
reliability contract, not proof of natural Hindi narration, clean Windows
operation or speech-model compatibility.

KathaSvara keeps a privacy-minimal JSON journal for every explicitly configured
render attempt. Journals contain story/segment identifiers, bounded progress
counts, cache fingerprints, measured durations and completion state. They do
**not** persist Hindi script, the effective text sent to Chatterbox, local model
paths, or generated voice recordings.

## Fixed, privacy-safe recovery diagnostics

Post-v0.5.1 source development categorizes terminal errors without storing
exception messages or arbitrary exception-class names. Python writes only fixed
failure labels (`RuntimeError`, `ValueError`, `OSError`,
`PermissionError`, `FileNotFoundError`, `MemoryError`, and `OtherError`),
plus `IncompleteRender` and `RenderCancelled` for explicit terminal states.
Any unknown custom exception class is saved as `OtherError`.

Native history reduces even these labels to a small allowlist of codes:
`incomplete`, `validation`, `storage`, `resources`, `runtime`, or
`unknown`. Interrupted and cancelled states have their own fixed codes;
running and completed jobs have no failure code. React displays hardcoded
explanations and does not render untrusted journal diagnostic strings.
Previously written arbitrary error labels are safely mapped to `unknown`
without modifying the original journal. Hints are advisory only and cannot
prove why an unsupported model, hardware, or filesystem operation failed.

## Cancellation and progress sidecars

A render's `.cancel` marker is created using an **exclusive create-new**
operation, never `fs::write` against an existing path. A repeated cancellation
request can acknowledge an existing six-byte regular marker without truncating
it. Pre-existing symlinks, directories and invalid-size entries produce an
error instead of writing through or replacing them. The cooperative Python
worker checks for the marker between segments and chunks, not during an
uninterruptible model inference call.

The Python worker writes `.progress.json` using a **randomized, exclusively
created temporary sibling**, then atomically replaces the destination. The
legacy predictable `.partial` path is never opened for writing, so a
pre-existing symbolic link with that name cannot redirect a write into
another file. On a temporary-name collision, a competitor's entry remains
untouched. If replacement fails, the last progress JSON remains intact and
only the temporary file created by that call is cleaned up. Counters are
bounded to 0–256. Recovery readers continue to enforce bounded regular JSON.

These measures protect against accidental collisions and ordinary local
symlinks. They cannot protect against arbitrary malicious processes already
allowed to mutate the entire app-owned jobs directory.

## First creation and retries

1. A new job supplies a unique absolute `.json` journal destination.
2. The first snapshot is written into an exclusive random temporary sibling.
3. On supported local filesystems, the application publishes that snapshot
   using a same-filesystem hard link. Publication fails if another process
   has created any directory entry at the destination in the meantime.
4. The private temporary file is removed whether first publication succeeds
   or fails. No unsafe overwrite fallback is performed if hard-link creation
   is denied.
5. Later updates use an atomic sibling-file replacement to preserve a complete
   JSON document during normal progress and terminal-state transitions.

**Progress publication is transactional.** The Python journal builds the next snapshot without changing the last committed in-memory state, then publishes it. If publication fails (for example, a full disk), the writer retains the last persisted counters instead of accidentally including an unrecorded segment in a later failure snapshot. Recording more than the planned segment count is rejected. A normal context exit with fewer recorded segments is explicitly marked `failed` with `IncompleteRender`, never `completed`. The journal cannot guarantee that an OS crash preserves the latest snapshot or that cached audio itself is human-approved.

**Important:** The per-cache cross-process lock already prevents cooperating
KathaSvara workers from concurrently rendering into the same cache. The
no-overwrite publication also protects the journal's first-write race against
uncoordinated file creation. It does **not** protect later replacement from a
malicious worker that can change the journal folder, guarantee durability
across a sudden power loss, or constitute an OS-level immutable snapshot.

The native desktop recovery-history reader performs a bounded scan of up to **20,000 directory entries** (including unrelated filenames), and shows at most 20 valid recent journal records for the selected story. If the folder exceeds the scan limit, it returns an error instead of silently hiding old matching stories or sorting an unbounded directory. History also refuses malformed `completed` entries where the recorded `done` count is less than `total`. These protections do not delete any files, resume jobs or prove speech quality.

**Recovery JSON reads are bounded twice.** The Windows desktop checks that each journal is a regular file no larger than **64 KiB** (and progress files no larger than **1 KiB**) before opening it, rechecks the opened file's metadata, and uses a capped stream read of at most one byte beyond the limit. A file which grows after its metadata check cannot cause an unbounded allocation. Oversized, malformed, or symlinked journal data is excluded from history; a manual forget refuses it without deleting the record. Missing progress sidecars still display zero progress, whereas malformed present sidecars produce an error. This protects ordinary local file races; it does not make a directory writable by malicious external processes safe against every path-swap attack.

The React recovery panel also keeps a request-generation marker. When the creator edits or switches the story, begins a new render, or forgets a journal, previously requested history responses cannot repopulate an obsolete list or report misleading success. Late render-progress polling responses are ignored when the tracked job changes or the panel unmounts. These are client display guards, not cancellation guarantees for already dispatched filesystem actions.

The desktop's **Retry current full story** action starts a separate new job
against the current document. It does not automatically resume a previous
partial synthesis, reconstitute original selections, or overwrite an existing
journal. Review generated WAV/SRT outputs and Hindi speech manually.

## Automated checks

- Linux Python tests simulate another writer creating the destination file
  or symlink immediately before initial publication, and verify it is preserved.
- Tests also check normal running -> progress -> completed transitions and
  fail-closed behavior if hard-link creation is unsupported.
- A dedicated Windows Python CI job executes the same model-free atomicity
  tests against the native Windows filesystem. Neither test job loads model
  weights or verifies Chatterbox voices.

See the [manual Windows/Hindi acceptance checklist](../qa/windows-hindi-acceptance.md)
and [issue #3](https://github.com/sanskarIN/KathaSvara/issues/3) for
requirements before a stable release.
