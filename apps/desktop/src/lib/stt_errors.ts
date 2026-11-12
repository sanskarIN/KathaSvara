// SPDX-License-Identifier: MPL-2.0
// Only exact, KathaSvara-owned STT errors can select a troubleshooting hint.
// Do not display native OS, Python, filesystem or model exception strings.
export type SttInputKind = "microphone" | "wav";

const FIXED_STT_GUIDANCE: Readonly<Record<string, string>> = Object.freeze({
  "Local STT model is incomplete. Provide nonempty config.json, model.bin and tokenizer.json.":
    "The offline STT model folder is incomplete. Check that config.json, model.bin and tokenizer.json are nonempty regular files, then rerun the no-model setup check.",
  "Offline STT model files are missing or empty.":
    "The offline STT model is missing required nonempty files. Select a complete local faster-whisper CTranslate2 model folder and rerun the no-model setup check.",
  "Choose a local faster-whisper model folder before transcribing.":
    "Select an installed local faster-whisper model folder before transcribing.",
  "Select an absolute offline STT model folder.":
    "Select an existing absolute local folder containing the offline STT model.",
  "Offline transcription is unavailable. Install the optional STT Python dependencies.":
    "The optional faster-whisper STT dependencies are missing or unavailable. Use the explicit Windows STT setup helper, then run its model-free doctor.",
  "Recording has no usable speech-level signal. Check microphone input and try again.":
    "The recording is silent or has no varying speech-level signal. Check the Windows input device and try a clearer short recording.",
  "Microphone recording has no usable audio signal. Check Windows microphone input.":
    "The captured microphone signal is silent or DC-only. Check Windows sound input and record again.",
  "Local STT inference failed. Check the model files and available memory.":
    "Offline speech recognition failed. Check local model compatibility, integrity, CPU memory and selected Python environment.",
  "Local inference timed out. Check model installation or hardware.":
    "Offline speech recognition timed out. Check the local model, available memory and CPU performance; retry with a short WAV.",
  "Inference sources are missing. Configure the source directory in Settings.":
    "The matching local KathaSvara Python inference sources are missing. Configure the inference source directory in Settings.",
  "Python 3.11 runtime not found. Configure KATHASVARA_PYTHON.":
    "Python 3.11 could not be launched. Configure the local Python interpreter in Settings or use the Windows setup helper.",
});

const DEFAULT_WAV_GUIDANCE =
  "Offline transcription failed. Check Python 3.11, the optional STT package, a complete local model and the WAV. Use the model-free WAV signal check to diagnose silence.";
const DEFAULT_MIC_GUIDANCE =
  "Local microphone transcription failed. Check the STT setup, model files and recording.";

/**
 * Tauri may reject with a string or Error. Never render raw rejections:
 * unknown values, prefixes, suffixes and objects remain generic.
 */
export function publicSttTranscriptionError(error: unknown, kind: SttInputKind): string {
  const message = typeof error === "string" ? error
    : error instanceof Error ? error.message : null;
  if (message !== null && Object.prototype.hasOwnProperty.call(FIXED_STT_GUIDANCE, message)) {
    return FIXED_STT_GUIDANCE[message];
  }
  return kind === "microphone" ? DEFAULT_MIC_GUIDANCE : DEFAULT_WAV_GUIDANCE;
}
