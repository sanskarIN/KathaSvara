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
    const lines = timings.map(timing => ({ segment_id: timing.segment_id, text: "नमस्कार।" }));
    expect(buildDialogueCues(timings, lines).length).toBe(256);
    timings[255].start_seconds = 0;
    expect(() => buildDialogueCues(timings, lines)).toThrow("invalid");
  });
});


describe("render-to-story and WAV integrity checks", () => {
  const lines = [{ segment_id: "narrator-line", text: "पुराना संवाद।" }];
  const timings = [{
    segment_id: "narrator-line", start_seconds: 0,
    end_seconds: 1.2503, effective_text: "नया उच्चारण।",
  }];
  const wav = { duration_seconds: 1.25, sample_rate: 24_000 };

  it("accepts rounded frame-derived cues with render-time Hindi text", () => {
    expect(buildDialogueCues(timings, lines, wav)[0].text).toBe("नया उच्चारण।");
    expect(buildDialogueSrt(timings, lines, wav)).toContain("नया उच्चारण।");
    expect(buildDialogueSrt(timings, lines, wav)).not.toContain("पुराना संवाद");
  });

  it("refuses unknown story segments even when a forged cue supplies effective_text", () => {
    const unknown = [{ ...timings[0], segment_id: "not-from-current-story" }];
    expect(() => buildDialogueCues(unknown, lines, wav)).toThrow("invalid");
    expect(() => buildDialogueSrt(unknown, lines, wav)).toThrow("invalid");
  });

  it.each([
    [{ duration_seconds: 0, sample_rate: 24_000 }],
    [{ duration_seconds: Infinity, sample_rate: 24_000 }],
    [{ duration_seconds: 1.25, sample_rate: NaN }],
    [{ duration_seconds: 1.25, sample_rate: 7_999 }],
  ])("rejects invalid generated WAV bounds %j", bounds => {
    expect(() => buildDialogueCues(timings, lines, bounds)).toThrow("Invalid generated WAV");
  });

  it("rejects cues whose endpoint exceeds the actual WAV, including on the last preview page", () => {
    const longCue = [{ ...timings[0], end_seconds: 1.265 }];
    expect(() => buildDialogueCues(longCue, lines, wav)).toThrow("invalid");
    expect(() => buildDialogueSrt(longCue, lines, wav)).toThrow("invalid");
    // The metadata can legitimately be rounded from PCM frames by a fraction of a ms.
    expect(buildDialogueCues([{ ...timings[0], end_seconds: 1.253 }], lines, wav)).toHaveLength(1);

    const manyLines = Array.from({ length: 20 }, (_, i) => ({
      segment_id: String(i), text: "हिंदी कथा।",
    }));
    const manyCues = manyLines.map((line, i) => ({
      segment_id: line.segment_id, start_seconds: i, end_seconds: i + 0.8,
      effective_text: "हिंदी कथा।",
    }));
    manyCues[19].end_seconds = 20.2;
    expect(() => buildDialogueCues(manyCues, manyLines, {
      duration_seconds: 20, sample_rate: 24_000,
    })).toThrow("invalid");
  });
});
