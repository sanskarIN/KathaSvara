// SPDX-License-Identifier: MPL-2.0
/**
 * The desktop must not render arbitrary native/OS/third-party exception text.
 * Such messages can contain local paths, voice filenames, tokens or dialogue.
 * Preserve only exact, reviewed KathaSvara help strings; anything else fails
 * closed to fixed generic guidance. Never use substring/prefix allowlisting.
 */
const PUBLIC_NATIVE_ERRORS = new Set([
  "Another real speech generation or story render is already running. Wait for it to finish.",
  "Local inference timed out. Check model installation or hardware.",
  "Inference sources are missing. Configure the source directory in Settings.",
  "Python 3.11 runtime not found. Configure KATHASVARA_PYTHON.",
  "Speech engine returned effectively silent audio. Check model weights, hardware and speech generation.",
  "Audio libraries could not initialize. Check Python 3.11, NumPy and SoundFile compatibility; run the local TTS import probe.",
  "Story audio libraries could not initialize. Check Python 3.11, NumPy and SoundFile compatibility; run the local TTS import probe.",
  "Speech library import failed. Check the local TTS setup and import probe.",
  "Local file or audio operation failed. Check permissions and available storage.",
  "Local speech operation failed. Run TTS diagnostics, verify the environment and retry.",
  "Invalid story, audio or output request. Check the entered settings and paths.",
  "Speech worker audio metadata does not match the saved WAV.",
  "Speech worker reported invalid synthesis chunk counts.",
  "Speech worker reported an invalid audio sample rate.",
  "Speech worker reported an invalid audio duration.",
  "Generated WAV changed during preview loading; render again.",
  "Generated WAV changed during validation; render again.",
  "Generated audio is missing.",
  "Choose a new absolute .wav output path.",
  "Refusing to overwrite existing audio.",
  "Wait for local cache cleanup to finish before rendering.",
  "Render job is already active.",
  "The render job is no longer active.",
  "A subtitle export supports at most 256 dialogue cues.",
  "No audio was generated.",
  "No speech generated.",
]);

const GENERIC_NATIVE_FAILURE =
  "Local operation failed. Check the selected inputs, runtime setup and disk permissions, then retry.";

export function publicDesktopError(error: unknown): string {
  const message = error instanceof Error ? error.message
    : typeof error === "string" ? error : "";
  return PUBLIC_NATIVE_ERRORS.has(message) ? message : GENERIC_NATIVE_FAILURE;
}
