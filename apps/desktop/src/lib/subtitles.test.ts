// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { buildDialogueSrt } from "./subtitles";

describe("Hindi per-dialogue SRT export", () => {
  it("uses measured cue offsets with readable Hindi and Unicode", () => {
    expect(buildDialogueSrt(
      [
        { segment_id: "a", start_seconds: 0, end_seconds: 1.234 },
        { segment_id: "b", start_seconds: 1.374, end_seconds: 63.5 },
      ],
      [{ segment_id: "a", text: "राजा  भोज।" }, { segment_id: "b", text: "नमस्कार!\nकैसे हैं?" }],
    )).toBe(
      "1\n00:00:00,000 --> 00:00:01,234\nराजा भोज।\n\n" +
      "2\n00:00:01,374 --> 00:01:03,500\nनमस्कार! कैसे हैं?\n",
    );
  });

  it("rejects missing or overlapping line timings instead of creating false subtitles", () => {
    expect(() => buildDialogueSrt([], [])).toThrow("requires 1");
    expect(() => buildDialogueSrt(
      [{ segment_id: "unknown", start_seconds: 0, end_seconds: 1 }],
      [],
    )).toThrow("Missing dialogue");
    expect(() => buildDialogueSrt(
      [
        { segment_id: "a", start_seconds: 0, end_seconds: 2 },
        { segment_id: "b", start_seconds: 1, end_seconds: 3 },
      ],
      [{ segment_id: "a", text: "एक" }, { segment_id: "b", text: "दो" }],
    )).toThrow("invalid");
  });

  it("rejects invalid, non-finite or overlong cue data", () => {
    expect(() => buildDialogueSrt(
      [{ segment_id: "a", start_seconds: NaN, end_seconds: 10 }],
      [{ segment_id: "a", text: "नमस्कार" }],
    )).toThrow("invalid");
    expect(() => buildDialogueSrt(
      [{ segment_id: "a", start_seconds: 0, end_seconds: 1 }],
      [{ segment_id: "a", text: "अ".repeat(3001) }],
    )).toThrow("3000");
  });
});
