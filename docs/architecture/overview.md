# Architecture — development version

KathaSvara has a deliberately small trust boundary for v0.1.0:

1. **React/TypeScript renderer:** script editor, display state, preview control, user-requested file dialogs.
2. **Rust/Tauri core:** validated IPC commands, application-owned story files, generated audio IDs, local WAV export.
3. **Python 3.11 command-line worker:** JSON request on stdin, JSON response on stdout, optional heavy Chatterbox model.
4. **External speech model:** loaded only when needed by the Python process, with upstream terms and optional model download.

No web API server is started. No cloud upload is needed. Project files live in Tauri's OS-specific app data directory and are scoped by UUID. Source code is separate from generated WAVs and model caches.

## Contract

Health request: action = health; returns engine and language identifiers without attempting model load.

Synthesis request: action = synthesize, UTF-8 Hindi text, absolute output WAV filename and optional supported exaggeration and cfg_weight. On success returns output file path, sample rate, duration and chunk count. On failure returns a structured error.

The desktop serializes a request, starts one Python process, reads JSON output and verifies the resulting WAV header and size. This implementation does not yet support cancellation, job queues or cross-process model caching; those are explicit follow-up milestones.

## Security design tradeoffs

Only allowlisted commands are exposed to the renderer. The Python interpreter may be overridden by an environment variable for development; the application does not execute arbitrary user-supplied command text. Generated audio output paths are constructed from UUIDs under app data. The WAV export destination comes from a native user save dialog and refuses to overwrite an existing file.

All handwritten application source is licensed under MPL-2.0. Third-party model/weight licenses remain independent.
