# Render journal first-publication safety

**Status:** post-v0.5.0 source development. This is a model-free filesystem
reliability contract, not proof of natural Hindi narration, clean Windows
operation or speech-model compatibility.

KathaSvara keeps a privacy-minimal JSON journal for every explicitly configured
render attempt. Journals contain story/segment identifiers, bounded progress
counts, cache fingerprints, measured durations and completion state. They do
**not** persist Hindi script, the effective text sent to Chatterbox, local model
paths, or generated voice recordings.

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

**Important:** The per-cache cross-process lock already prevents cooperating
KathaSvara workers from concurrently rendering into the same cache. The
no-overwrite publication also protects the journal's first-write race against
uncoordinated file creation. It does **not** protect later replacement from a
malicious worker that can change the journal folder, guarantee durability
across a sudden power loss, or constitute an OS-level immutable snapshot.

The native desktop recovery-history reader performs a bounded scan of up to **20,000 directory entries** (including unrelated filenames), and shows at most 20 valid recent journal records for the selected story. If the folder exceeds the scan limit, it returns an error instead of silently hiding old matching stories or sorting an unbounded directory. History also refuses malformed `completed` entries where the recorded `done` count is less than `total`. These protections do not delete any files, resume jobs or prove speech quality.

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
