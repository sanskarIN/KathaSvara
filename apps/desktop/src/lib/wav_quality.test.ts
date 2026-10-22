// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { parseWavQuality, qualityReviewHints } from "./wav_quality";

function sample() {
  return {
    format: "kathasvara-wav-structural-inspection", schema_version: 1,
    structure_valid: true, duration_seconds: 10, file_bytes: 480044,
    sha256: "a".repeat(64), model_loaded: false, hindi_listening_verified: false,
    distinct_voices_verified: false, human_review_required: true,
    level_hints: {
      rms_dbfs: -20, peak_dbfs: -6, clipped_sample_percentage: 0,
      near_silence_hint: false, possible_clipping_hint: false,
      long_internal_pause_hint: false, longest_internal_quiet_span_seconds: 0,
      longest_internal_quiet_span_start_seconds: null, signal_review_required: false,
    },
  };
}

describe("model-free WAV inspection report", () => {
  it("accepts a bounded private-text-free result without certifying real Hindi", () => {
    const report = parseWavQuality(sample());
    expect(report.model_loaded).toBe(false);
    expect(report.human_review_required).toBe(true);
    expect(qualityReviewHints(report)).toEqual([
      expect.stringContaining("Listen anyway"),
    ]);
  });

  it("reports a seek time for the longest enclosed silence but never calls it failure", () => {
    const raw = sample();
    raw.level_hints.long_internal_pause_hint = true;
    raw.level_hints.signal_review_required = true;
    raw.level_hints.longest_internal_quiet_span_seconds = 3.5;
    // nullable field inference is intentionally explicit for fixtures
    const input = { ...raw, level_hints: {
      ...raw.level_hints, longest_internal_quiet_span_start_seconds: 2.0,
    }};
    const report = parseWavQuality(input);
    expect(qualityReviewHints(report)).toEqual([
      expect.stringContaining("3.5-second quiet gap begins around 2.0 s"),
    ]);
  });

  it("renders silence and clipping warnings individually", () => {
    const raw = sample();
    raw.level_hints.near_silence_hint = true;
    raw.level_hints.possible_clipping_hint = true;
    raw.level_hints.signal_review_required = true;
    expect(qualityReviewHints(parseWavQuality(raw))).toHaveLength(2);
  });

  it.each([
    { model_loaded: true },
    { hindi_listening_verified: true },
    { distinct_voices_verified: true },
    { human_review_required: false },
    { schema_version: 2 },
    { sha256: "../secret" },
    { file_bytes: 700_000_000 },
    { duration_seconds: Number.POSITIVE_INFINITY },
  ])("rejects mismatched or inflated verification and metadata flags", change => {
    expect(() => parseWavQuality({ ...sample(), ...change })).toThrow();
  });

  it("rejects malformed quiet-span positions and percentages", () => {
    expect(() => parseWavQuality({ ...sample(), level_hints: {
      ...sample().level_hints,
      longest_internal_quiet_span_start_seconds: 9,
      longest_internal_quiet_span_seconds: 3,
    }})).toThrow();
    expect(() => parseWavQuality({ ...sample(), level_hints: {
      ...sample().level_hints, clipped_sample_percentage: Number.NaN,
    }})).toThrow();
    expect(() => parseWavQuality(null)).toThrow();
  });
});
