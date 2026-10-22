# Hindi-safe long-token chunk boundaries (unreleased)

KathaSvara prepares the final spoken text (including locally reviewed pronunciation replacements) **before** any model is loaded. The speech engine has a default 280-character chunk target. Most Hindi narration splits at spaces or sentence endings without touching any individual word.

## Problem addressed

In the previous splitter, a word longer than the chunk limit was sliced at raw Python string indices. A break could fall between a Devanagari base and its vowel sign or nukta, after a virama in a conjunct (such as `क्ष`), or next to an explicit zero-width joiner/non-joiner. These are not safe word/speech boundaries: the next model input could start with an unattached mark or lose the original syllable composition.

## New conservative behavior

- For long **unspaced** tokens, move a proposed boundary left until it is not directly before a Unicode mark or Indic joiner, and not directly after the Devanagari virama or joiner.
- Keep all chunks at or below the configured limit while preserving every original code point and its order. Short normal words, ordinary paragraph/sentence splitting and long ASCII words retain their previous behavior.
- If a single inseparable written sequence cannot fit in the configured chunk budget, fail with a `ValueError` during the shared model-free render preflight rather than split it into malformed fragments or silently truncate the script. The user can revise the spoken text or pronunciation glossary.
- This **is not** a complete Unicode Extended Grapheme Cluster algorithm and does not promise full segmentation across all world scripts. It is a deliberately narrow guard for Hindi and Unicode combining signs.

The same preflight plan is reused by synthesis, so successful inspection and generation agree about the speech chunks. Cache fingerprints already include the effective speech and the engine version/configuration; existing cached results are not deleted by this source-only change. No story document schema, export path, render journal or release asset changes.

## Verification

From `services/inference` in a suitable Python environment:

```bash
python -m pytest -q tests/test_hindi.py
python -m ruff check kathasvara/hindi.py tests/test_hindi.py
```

The no-model tests cover Devanagari vowels, nukta, virama conjuncts, explicit joiners, Unicode variation marks, exact chunk boundaries, ASCII compatibility, lossless reconstruction and impossible oversize sequences.

**Acceptance limitation:** Safe text chunk boundaries are only a structural improvement. They do not establish natural pronunciation, distinct character voices, a working downloaded model, or clean Windows-machine acceptance. Keep [issue #3](https://github.com/sanskarIN/KathaSvara/issues/3) open until real listening and Windows checks are completed.
