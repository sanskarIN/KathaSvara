// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { parseWavQuality, qualityReviewHints } from "./wav_quality";

function sample() {
  return {
    format: "kathasvara-wav-structural-inspection", schema_version: 1,
    structure_valid: true, codec: "pcm_s16le", channels: 1,
    sample_rate_hz: 24_000, frames: 240_000,
    duration_seconds: 10, file_bytes: 480044,
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
    raw.level_hints.rms_dbfs = -70;
    raw.level_hints.peak_dbfs = 0;
    raw.level_hints.clipped_sample_percentage = 2;
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


  it.each([
    { codec: "float32" },
    { channels: 2 },
    { sample_rate_hz: 0 },
    { sample_rate_hz: 8_001 },
    { frames: 0 },
    { frames: 1.5 },
    { frames: 24_000 },
    { frames: 24_000 * 1201 },
    { file_bytes: 479_999 },
    { file_bytes: 480_044.5 },
    { duration_seconds: 0 },
    { duration_seconds: 10.01 },
    { duration_seconds: -1 },
  ])("rejects inconsistent or impossible PCM metadata %#", change => {
    expect(() => parseWavQuality({ ...sample(), ...change })).toThrow();
  });

  it("refuses contradictory warning flags rather than showing false reassurance", () => {
    const base = sample();
    const changed = (changes: Record<string, unknown>) => ({
      ...base, level_hints: { ...base.level_hints, ...changes },
    });
    expect(() => parseWavQuality(changed({ signal_review_required: true }))).toThrow();
    expect(() => parseWavQuality(changed({
      rms_dbfs: -70, near_silence_hint: false,
    }))).toThrow();
    expect(() => parseWavQuality(changed({
      near_silence_hint: true,
    }))).toThrow();
    expect(() => parseWavQuality(changed({
      clipped_sample_percentage: 12, possible_clipping_hint: false,
    }))).toThrow();
    expect(() => parseWavQuality(changed({
      clipped_sample_percentage: 0, possible_clipping_hint: true,
    }))).toThrow();
    expect(() => parseWavQuality(changed({
      longest_internal_quiet_span_seconds: 5,
      longest_internal_quiet_span_start_seconds: 1,
      long_internal_pause_hint: false,
    }))).toThrow();
    expect(() => parseWavQuality(changed({
      longest_internal_quiet_span_seconds: 1,
      longest_internal_quiet_span_start_seconds: 1,
      long_internal_pause_hint: true,
    }))).toThrow();
    expect(() => parseWavQuality(changed({
      rms_dbfs: Number.POSITIVE_INFINITY,
    }))).toThrow();
    expect(() => parseWavQuality(changed({
      rms_dbfs: 10,
    }))).toThrow();
    expect(() => parseWavQuality(changed({
      rms_dbfs: -2, peak_dbfs: -5,
    }))).toThrow();
  });

  it("accepts valid completely silent PCM and a rounded threshold boundary", () => {
    const silent = sample();
    expect(parseWavQuality({
      ...silent, level_hints: {
        ...silent.level_hints, rms_dbfs: null, peak_dbfs: null,
        near_silence_hint: true, signal_review_required: true,
      },
    }).level_hints.near_silence_hint).toBe(true);

    // A true 0.9998% of clipped frames rounds to 1.000 in the JSON.
    // The underlying unrounded sample ratio must control the advisory flag.
    const atBoundary = sample();
    expect(parseWavQuality({
      ...atBoundary, level_hints: {
        ...atBoundary.level_hints, clipped_sample_percentage: 1,
        possible_clipping_hint: false, signal_review_required: false,
      },
    }).level_hints.possible_clipping_hint).toBe(false);
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
