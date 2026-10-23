// SPDX-License-Identifier: MPL-2.0
// Read-only, model-free audio inspection from the existing local Python checker.
// Validation is intentionally strict: malformed IPC data must not imply acceptance.

export interface WavQualityReport {
  format: "kathasvara-wav-structural-inspection";
  schema_version: 1;
  structure_valid: true;
  codec: "pcm_s16le";
  channels: 1;
  sample_rate_hz: number;
  frames: number;
  duration_seconds: number;
  file_bytes: number;
  sha256: string;
  model_loaded: false;
  hindi_listening_verified: false;
  distinct_voices_verified: false;
  human_review_required: true;
  level_hints: {
    rms_dbfs: number | null;
    peak_dbfs: number | null;
    clipped_sample_percentage: number;
    near_silence_hint: boolean;
    possible_clipping_hint: boolean;
    long_internal_pause_hint: boolean;
    longest_internal_quiet_span_seconds: number;
    longest_internal_quiet_span_start_seconds: number | null;
    signal_review_required: boolean;
  };
}

function record(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("The WAV inspection report is malformed.");
  }
  return input as Record<string, unknown>;
}

function bounded(value: unknown, upper: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= upper;
}

function dbfs(value: unknown): value is number | null {
  return value === null || (typeof value === "number" &&
    Number.isFinite(value) && value <= 0);
}

/**
 * Python's level metrics are rounded (2 or 3 decimals) after thresholds
 * are evaluated. Be tolerant only at the respective rounding boundaries.
 */
function quietFlagConsistent(rms: number | null, flag: boolean): boolean {
  if (rms === null) return flag;
  if (rms < -60.01) return flag;
  if (rms > -59.99) return !flag;
  return true;
}

function clippingFlagConsistent(percentage: number, flag: boolean): boolean {
  if (percentage > 1.001) return flag;
  if (percentage < 0.999) return !flag;
  return true;
}

function pauseFlagConsistent(seconds: number, flag: boolean): boolean {
  if (seconds > 3.001) return flag;
  if (seconds < 2.999) return !flag;
  return true;
}

/** Never treat an unrecognized/malformed report as successful audio inspection. */
export function parseWavQuality(input: unknown): WavQualityReport {
  const root = record(input);
  const hints = record(root.level_hints);
  const seconds = root.duration_seconds;
  const start = hints.longest_internal_quiet_span_start_seconds;
  const pause = hints.longest_internal_quiet_span_seconds;
  const rate = root.sample_rate_hz;
  const frames = root.frames;
  const rms = hints.rms_dbfs;
  const peak = hints.peak_dbfs;
  const quiet = hints.near_silence_hint;
  const clipping = hints.possible_clipping_hint;
  const longPause = hints.long_internal_pause_hint;
  if (
    root.format !== "kathasvara-wav-structural-inspection" ||
    root.schema_version !== 1 || root.structure_valid !== true ||
    root.codec !== "pcm_s16le" || root.channels !== 1 ||
    root.model_loaded !== false || root.hindi_listening_verified !== false ||
    root.distinct_voices_verified !== false || root.human_review_required !== true ||
    !Number.isSafeInteger(rate) || !bounded(rate, 192_000) || rate < 8_000 ||
    !Number.isSafeInteger(frames) || !bounded(frames, rate * 1200) || frames < 1 ||
    !bounded(seconds, 1200) || Math.abs(seconds - frames / rate) > 0.000501 ||
    !Number.isSafeInteger(root.file_bytes) ||
    !bounded(root.file_bytes, 512 * 1024 * 1024) ||
    root.file_bytes < 44 + frames * 2 ||
    typeof root.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(root.sha256) ||
    !dbfs(rms) || !dbfs(peak) ||
    (rms === null) !== (peak === null) ||
    (rms !== null && peak !== null && rms > peak + 0.02) ||
    !bounded(hints.clipped_sample_percentage, 100) ||
    typeof quiet !== "boolean" ||
    typeof clipping !== "boolean" ||
    typeof longPause !== "boolean" ||
    typeof hints.signal_review_required !== "boolean" ||
    !bounded(pause, 1200) ||
    (start !== null && !bounded(start, 1200)) ||
    (start === null && pause !== 0) ||
    (start !== null && start + pause > frames / rate + 0.001) ||
    !quietFlagConsistent(rms, quiet) ||
    !clippingFlagConsistent(hints.clipped_sample_percentage, clipping) ||
    !pauseFlagConsistent(pause, longPause) ||
    hints.signal_review_required !== (quiet || clipping || longPause)
  ) {
    throw new Error("The WAV inspection report failed safety validation.");
  }
  return root as unknown as WavQualityReport;
}

/** Copy-ready, conservative prompts; these numbers cannot verify Hindi speech. */
export function qualityReviewHints(report: WavQualityReport): string[] {
  const result: string[] = [];
  const hint = report.level_hints;
  if (hint.near_silence_hint) result.push("Overall level is unusually quiet. Listen for missing or very soft dialogue.");
  if (hint.possible_clipping_hint) result.push("Some audio samples reach full scale. Listen for distortion.");
  if (hint.long_internal_pause_hint) {
    result.push(`A ${hint.longest_internal_quiet_span_seconds.toFixed(1)}-second quiet gap begins around ${hint.longest_internal_quiet_span_start_seconds?.toFixed(1) ?? "?"} s. Check whether the pause is intentional.`);
  }
  if (result.length === 0) result.push("No basic level or long-gap warning found. Listen anyway: this cannot verify speech quality.");
  return result;
}
