# Explicit real Hindi desktop audio smoke test — manual acceptance

> **Development-only; not yet in a published KathaSvara release.** This feature is stacked on [guided speech readiness PR #132](https://github.com/sanskarIN/KathaSvara/pull/132). The latest published GitHub developer preview is still [v0.5.4](https://github.com/sanskarIN/KathaSvara/releases/tag/v0.5.4), until a newer release is independently verified. This document is not evidence of a usable model or accepted Hindi speech.

## Purpose and difference from the no-model checks

- **Guided speech readiness** checks an interpreter, disposable PCM16 WAV I/O, and optional import/API compatibility without loading or downloading a model. A passing report does **not** certify audible Hindi.
- **Real Hindi model and listening test** uses the same native `synthesize` command as Voice Studio. It explicitly submits only this fixed, original short text: **“नमस्कार। यह कथास्वर की हिंदी आवाज़ की जाँच है।”** It attempts actual Chatterbox Hindi generation with `language_id="hi"`, no synthetic fallback, and optional session-selected local reference audio.
- The user must deliberately enable the in-app consent checkbox, then press **Generate real Hindi test WAV (may download model)**. No model is invoked by opening Settings or completing the no-model diagnostic. First-time generation **may download large third-party model weights**; review compatibility, licenses, network access and hardware requirements before agreeing.

## Test procedure

1. Install an authorized Python 3.11 inference environment with compatible NumPy, SoundFile, Torch, Chatterbox, and separately approved checkpoint weights. This developer EXE does **not** bundle them.
2. In desktop Settings, use **Choose Python and inference folder** (or the explicit Windows helper), then run **Check speech readiness (no model load)**. Repair any reported setup blockers before a real-model test.
3. If selecting a reference WAV, use **only your own or a consented recording**, and confirm it passes the local reference preflight. The recording remains local.
4. In **Real Hindi model and listening test**, read the large-model download warning, intentionally tick the consent checkbox and press the explicit generation button. The button is disabled before consent, during a running test and while a previous test result is still present.
5. When a WAV result appears, use its built-in audio player (or **Export real Hindi test WAV** if the inline size limit applies). **Listen critically:** Is the short Hindi sentence understandable? Are words pronounced correctly? Is speech audible without long silence, clipping or unnatural distortion? Does any selected consented reference behave as expected?
6. Delete the local test result with **Hide and discard Hindi test**, and verify that no other story or reference file changed. If a reference is switched or the test retired while generation is in progress, the old process can still finish; its outdated result is discarded, not presented as a successful new sample. A native per-process gate also refuses concurrent real speech generation and scene renders with a fixed busy error; it does not change model-free diagnostics or guarantee coordination between multiple separately launched EXEs.
7. Record manual evidence in [issue #3](https://github.com/sanskarIN/KathaSvara/issues/3): OS/build, coarse hardware details, compatible package/model versions, whether the user actually listened, WAV duration/sample rate and any intelligibility or playback problems. **Do not post private paths, consented voice recordings, access tokens or proprietary model files.**

## Explicit non-goals and release boundary

This flow does **not** download or install dependencies automatically, circumvent model licensing, record from a microphone, upload source audio to a service, permanently store a private reference path, prove distinct character voice identities, validate long stories, or mark manual acceptance as passed. Passing automated tests with a mock audio result is **not real speech evidence**. Clean Windows setup and end-to-end scene/WAV/SRT export remain independently open under [issue #129](https://github.com/sanskarIN/KathaSvara/issues/129).

It is also **not part of the frozen unpublished v0.5.5 source release SHA** `7347dc3133434a5657d7d5f20222bbe92aa78047`. Keep this work on a next-development branch until publication or an explicit change of release plan.
