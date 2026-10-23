// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { buildDialogueCues, buildDialogueSrt } from "./subtitles";

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

  it("uses actual generated speech over later edits to the source story", () => {
    const result = buildDialogueSrt(
      [{ segment_id: "a", start_seconds: 0, end_seconds: 1.25,
        effective_text: "राजा भोज की जय!" }],
      [{ segment_id: "a", text: "पुराना पाठ" }],
    );
    expect(result).toContain("राजा भोज की जय!");
    expect(result).not.toContain("पुराना पाठ");
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

  it("rejects overlaps after millisecond rounding, matching the native SRT validator", () => {
    expect(() => buildDialogueSrt([
      { segment_id: "a", start_seconds: 0, end_seconds: 1.0014 },
      { segment_id: "b", start_seconds: 1.0003, end_seconds: 2 },
    ], [
      { segment_id: "a", text: "राजा भोज" },
      { segment_id: "b", text: "मंत्री जी" },
    ])).toThrow("invalid");
  });

  it("rejects sub-millisecond captions that round to zero duration", () => {
    expect(() => buildDialogueSrt(
      [{ segment_id: "a", start_seconds: 0.0001, end_seconds: 0.0003 }],
      [{ segment_id: "a", text: "नमस्कार" }],
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


describe("pre-export dialogue cue review", () => {
  it("previews the same rounded Hindi and glossary text that the SRT will export", () => {
    const timings = [
      { segment_id: "one", start_seconds: 0.0004, end_seconds: 1.2344,
        effective_text: "  राजा   भोज की जय! " },
      { segment_id: "two", start_seconds: 1.5, end_seconds: 2.25,
        effective_text: "सुनिए! नया उच्चारण।" },
    ];
    const lines = [
      { segment_id: "one", text: "old source before pronunciation rules" },
      { segment_id: "two", text: "पुराना पाठ" },
    ];
    const cues = buildDialogueCues(timings, lines);
    expect(cues).toEqual([
      { number: 1, start_seconds: 0, end_seconds: 1.234, text: "राजा भोज की जय!" },
      { number: 2, start_seconds: 1.5, end_seconds: 2.25,
        text: "सुनिए! नया उच्चारण।" },
    ]);
    const srt = buildDialogueSrt(timings, lines);
    expect(srt).toContain("00:00:00,000 --> 00:00:01,234\nराजा भोज की जय!");
    expect(srt).toContain("00:00:01,500 --> 00:00:02,250\nसुनिए! नया उच्चारण।");
    expect(srt).not.toContain("old source");
  });

  it("rejects duplicate segment IDs and non-printing controls rather than previewing misleading captions", () => {
    const timings = [
      { segment_id: "same", start_seconds: 0, end_seconds: 1 },
      { segment_id: "same", start_seconds: 1.1, end_seconds: 2 },
    ];
    expect(() => buildDialogueCues(timings, [{ segment_id: "same", text: "पहली पंक्ति" }]))
      .toThrow("invalid");
    expect(() => buildDialogueSrt(timings, [{ segment_id: "same", text: "पहली पंक्ति" }]))
      .toThrow("invalid");
    expect(() => buildDialogueCues(
      [{ segment_id: "a", start_seconds: 0, end_seconds: 1 }],
      [{ segment_id: "a", text: "नमस्कार\u0000 गलत" }],
    )).toThrow("invalid");
  });

  it("checks the entire 256-cue timeline and does not silently skip later invalid cues", () => {
    const timings = Array.from({ length: 256 }, (_, index) => ({
      segment_id: String(index), start_seconds: index, end_seconds: index + 0.5,
      effective_text: "नमस्कार।",
    }));
    expect(buildDialogueCues(timings, []).length).toBe(256);
    timings[255].start_seconds = 0;
    expect(() => buildDialogueCues(timings, [])).toThrow("invalid");
  });
});
