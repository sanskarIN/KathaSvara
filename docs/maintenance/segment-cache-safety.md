# Segment-cache maintenance safety

**Status:** post-v0.5.0 source-only maintenance. This document is not
evidence of model readiness, verified Hindi pronunciation, distinct voices,
or a validated clean-Windows installation.

The local segment cache contains content-addressed, mono PCM16 WAV segments.
KathaSvara exposes **inspection and explicitly requested pruning**; neither
operation runs automatically. The cache is not a history backup and its audio
has not been approved through human listening solely because it is cached.

## Entry budget and deletion policy

- The cache inspection scans at most **20,000 direct directory entries**.
  Irrelevant names and symlinks count toward this limit. Inspection and
  pruning return an error on overflow rather than publishing a partial
  inventory or silently pruning from an incomplete snapshot.
- Only direct, regular WAV files matching a 64-character lowercase SHA-256
  filename are eligible. Nested files, unrelated files and symlinks are
  ignored and never deleted by this maintenance action.
- Files younger than **600 seconds** are not eligible for removal, even
  when they exceed the requested size budget. Invalid explicit clocks
  (including NaN and infinity) fail before pruning, so they cannot bypass
  that grace period.
- A deletion requires explicit opt-in. When it runs, an OS-owned
  cross-process cache lock excludes cooperating render workers. The
  complete bounded scan finishes before unlinking. Each candidate's
  regular-file type, inode, size and modification timestamp are rechecked
  immediately before deletion. An unexpected replacement is skipped.
- The deletion operation cannot protect against a malicious process that
  intentionally swaps same-named files in a writable directory or ignores
  KathaSvara's cache lock; it should only operate on the app-owned cache.

## Model-free validation

`services/inference/tests/test_cache.py` exercises the exact scan threshold,
over-limit failure without deletion, ignored filenames, invalid clocks,
the ten-minute grace period and conservative cache selection. Standard CI
runs these tests without loading Chatterbox weights.

For other temporary audio cleanup policies see
`services/inference/kathasvara/temp_cleanup.py`; temporary WAV cleanup
has a **separate** 20,000-entry scan and a 24-hour minimum age.
