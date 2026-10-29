# Chatterbox Multilingual Hindi adapter

## Status

The Python adapter calls Resemble AI's Chatterbox Multilingual generate method with Hindi language ID (hi), expressiveness and guidance controls. This code is **not proof of an audible model run**. The weights are not bundled; the first actual inference can download model files.

Official repository: https://github.com/resemble-ai/chatterbox

Hindi checkpoint listing: https://huggingface.co/ResembleAI/Chatterbox-Multilingual-hi

## Compatibility

Use Python 3.11 and the upstream-documented installation stack. The current adapter uses the default multilingual checkpoint and labels every generation as Hindi. It does not specifically select the optional dedicated Hindi language-pack fine-tune. Such support must be separately verified before its controls are exposed.

- Voice settings: exaggeration (0.25 to 2.0), cfg_weight (0.0 to 1.0).
- No voice cloning, optional reference audio, model fine-tuning or emotion labels are exposed yet.
- Engine-specific CUDA, MPS and CPU support depends on the installed PyTorch/model versions, GPU and available memory; no performance numbers are claimed.
- Automatic multi-gigabyte model downloads, weight redistribution and non-consensual voice impersonation are not part of a verified release.

## Real listening gate

Use scripts/smoke_hindi.py with an absolute output location and explicit --allow-model-downloads. Record hardware, torch version, Chatterbox version, model revision, generation duration, WAV metadata, perceived intelligibility, pronunciation and clipping. A native Hindi listener must review the generated Hindi audio and log problems before v0.1.0 can ship.


## Opt-in TTS import probe (v0.5.3 development only)

Use **Settings → Verify speech library imports (no model load)** in a development
build to distinguish *discoverable* dependencies from modules that actually
import successfully. It tests NumPy, SoundFile, PyTorch and the
`ChatterboxMultilingualTTS` entrypoint. The same action can be used in the
inference directory with the already configured Python interpreter:

```powershell
'{"action":"probe_runtime"}' | python -m kathasvara.cli
```

The structured result uses fixed statuses: `ok`, `import_failed` or
`entrypoint_missing`. It does not expose third-party exception text or local
filesystem paths, make network requests, call `from_pretrained`, load weights,
generate speech, or validate hardware capacity. Imports may still take time on
Windows. An `imports_ok: true` result only clears this **one** setup check;
it is **not** confirmation that narration works.

If a component fails, use a Python 3.11 virtual environment and reinstall the
inference dependencies there. Set `KATHASVARA_PYTHON` to that interpreter for
the desktop app, and `KATHASVARA_INFERENCE_DIR` to the absolute inference
source directory for the unbundled Windows developer EXE. Do not change the
system Python or disable OS protections to troubleshoot. Real model inference,
WAV listening and clean-machine Windows acceptance remain separate work.
