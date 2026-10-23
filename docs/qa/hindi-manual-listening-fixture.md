# KathaSvara: human Hindi listening acceptance fixture

**Purpose:** An original, small, reproducible story and a privacy-conscious **blank** evidence log for real model/hardware acceptance. This is a manual test plan, **not** proof that any Chatterbox model has run or that Hindi narration is good. It applies to current development source and to any experimental developer build tested separately.

**Status:** All real audio and clean-device outcomes are **not-tested** until a human performs them. Do not mark them as passed from CI, a synthetic/mock engine, generated file existence, an in-app checkbox, or this document.

## Fixture A — two scenes with a narrator, राजा and किसान

Create three character records with the roles `Narrator` (built-in), `राजा`, and `किसान`. Create two scenes. Copy only the quoted Hindi text below into **speech** segments in order; do not paste the role labels as spoken content.

| Scene | Segment kind / actor | Exact test text |
| --- | --- | --- |
| 1: पुरानी घड़ी | Narrator (speech) | चाँदपुर के गाँव में पुरानी घड़ी ने ठीक सात बजे घंटी बजाई। |
| 1: पुरानी घड़ी | राजा (speech) | यह आवाज़ कहाँ से आई? क्या किसी ने घड़ी को छुआ? |
| 1: पुरानी घड़ी | Stage direction (not speech) | [दरवाज़ा धीरे से खुलता है।] |
| 1: पुरानी घड़ी | किसान (speech) | महाराज, मैंने कुएँ के पास एक हल्की रोशनी देखी थी। |
| 2: सुबह की योजना | Narrator (speech) | अगली सुबह, सब लोग फिर से चौपाल पर इकट्ठा हुए। |
| 2: सुबह की योजना | किसान (speech) | मैंने mobile पर संदेश भेजा, लेकिन network नहीं मिला। |
| 2: सुबह की योजना | राजा (speech) | पहले सबकी सुरक्षा देखेंगे। धन्यवाद, अब आगे चलें। |

**Structural expectations (inspect before loading a real model):** exactly **six speech** segments in their listed order, with the bracketed stage direction excluded from synthesized dialogue. Preflight should retain source text and assign only valid existing actors. A **full-story** render should report six measured speech cues; a **selected scene 1** render should report three, and scene 2 should report three. **Do not invent timestamps**: only the actual generated WAV/PCM and SRT can establish durations.

**Voice identity limitation:** Characters can be assigned records, but KathaSvara currently does not establish that they sound like distinct speakers. Correct turn order and voice distinctness are two **separate** review outcomes; do not mark the latter passed without actual supported voice conditioning and a human listening result.

## Fixture B — one deliberate glossary substitution

In a **copy** of Fixture A, create one explicitly reviewed pronunciation rule for a single chosen word, for example an original fictional name such as `चाँदपुर` mapped to the author's intended spoken rendering. Document the exact before/after values **privately**, inspect the resulting speech plan and render again. Compare the in-app subtitle preview with the exported `.srt`: both should use the **effective speech text captured at render time**, while the saved original script stays unchanged. Later edits to the original story must not retroactively change captions of an already generated WAV.

Do not assume that a textual substitution automatically results in the intended spoken pronunciation: **listen** and record the outcome. Avoid publishing private scripts or voice samples in the acceptance issue.

## Fixture C — longer story and export-only audio

Extend the story with additional original scenes and spoken lines, keeping within the app's published size and 20-minute rendering limits. With more than ten valid speech cues, inspect first, middle and final cue pages; search for a last-page Hindi phrase and ensure its original cue number and seek position remain correct. Confirm the complete exported SRT still includes **all** measured cues even while the UI search filters the preview.

For sufficiently large output, the inline Base64 WAV preview is intentionally disabled above **25 MiB**. Do not increase the app's inline preview limit merely for the test: export the WAV explicitly and listen in an external trusted player, then verify SRT playback separately. A small mock PCM file may check structural behavior, but it cannot replace a human hearing actual generated narration.

## What a human must check

| Gate | How to test | Expected judgment |
| --- | --- | --- |
| Hindi clarity | Listen to all lines without reading the source first, then compare | Words intelligible; note mispronunciations and missing words |
| Hindi punctuation | Listen around `?`, commas, `।` and story transitions | Pauses and questions make sense; do not infer from punctuation alone |
| Hindi-English mixed text | Listen to `mobile` and `network` in the fifth speech line | Reviewer records intelligibility and unintended word substitution |
| Turn order | Compare actual audio against the six actor-tagged speech lines | All six lines play once in order, with no spoken stage direction |
| Speaker distinctness | Compare narrator/राजा/किसान turns by ear | Mark **not-tested/blocked** unless real, supported independent voices exist |
| Glossary | Listen to the specifically changed word | Actual pronunciation agrees with the reviewer-intended rendering |
| SRT | Open exported SRT with the exported WAV in an independent player/editor | Actual segment-level onset/end and rendered text agree sufficiently for use |
| WAV structure | Run the no-model inspector on the **same exported file** | Record its PCM rate, frame duration and SHA-256; this does not prove quality |
| Storage/recovery | Save/reload scenes; separately cancel and retry a render | No lost text, spurious approvals, or other story's recovery state |
| Trust and Windows launch | Test on an authorized clean Windows x64 system without disabling security | Record true launch result and any signature or runtime blocker |

For all gates, use only these dispositions: `pass`, `fail`, `blocked`, `not-tested`. If a voice feature is unsupported, record `blocked`, not a fabricated pass.

## Private evidence log template

Copy and fill this **privately** for each model, platform and exact build. Store recordings securely and share no voice samples without rights and consent.

```text
Date (local): [not-tested]
Build tag / exact commit: [not-tested]
Build source: source checkout / verified GitHub release / other
Release EXE SHA-256 matched companion? [not-tested]
Windows build (coarse): [not-tested]
CPU/GPU/RAM class (coarse): [not-tested]
Python / Chatterbox / checkpoint version and terms reviewed: [not-tested]
Scene fixture: A / B / C
WAV sample rate, length and local SHA-256: [not-tested]
Audio generated from real approved model? [not-tested]
Human actually listened to the file? [not-tested]
Hindi clarity: not-tested
Punctuation and pacing: not-tested
Hindi-English words: not-tested
Character turn ordering: not-tested
Separate voices supported and actually distinguishable: not-tested
Glossary speech actually pronounced as expected: not-tested
SRT text and measured cue timing: not-tested
Save/recovery and export-only WAV: not-tested
Windows clean launch without bypassing safeguards: not-tested
Failure details without private absolute paths or model secrets:
Release acceptance disposition: BLOCKED (manual checks not yet completed)
```

**Evidence hygiene:** Do not post personally identifying file paths, serial numbers, paid-model credentials, private story text, reference voices or unconsented recordings. An exported audio SHA-256 is useful for matching a local evaluation to one precise file but should be shared only when appropriate.

For detailed setup and security precautions, use [Windows and Hindi narration acceptance](windows-hindi-acceptance.md), [offline WAV inspection](offline-wav-inspection.md), and [open acceptance issue #3](https://github.com/sanskarIN/KathaSvara/issues/3). Only a human reviewer who performed the run can record listening acceptance.
