// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { hasUnsafeSttTextControls } from "./stt_text";

describe("untrusted Hindi STT review and model text controls", () => {
  it.each([
    0x0000, 0x0008, 0x000b, 0x001f, 0x007f, 0x0080, 0x009f,
    0x061c, 0x200e, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069,
  ])("rejects control code point U+%s", point => {
    expect(hasUnsafeSttTextControls("नमस्ते" + String.fromCodePoint(point) + "भारत")).toBe(true);
  });

  it.each(["नमस्ते भारत", "क्\u200dष", "क्\u200cष", "हिंदी\nअगली पंक्ति", "क\tख"])(
    "retains legitimate Devanagari writing and whitespace", text => {
      expect(hasUnsafeSttTextControls(text)).toBe(false);
    },
  );

  it("does not rewrite a user edit or silently remove an unsafe character", () => {
    const input = "मेरी" + String.fromCodePoint(0x202e) + "कहानी";
    expect(hasUnsafeSttTextControls(input)).toBe(true);
    expect(input).toContain(String.fromCodePoint(0x202e));
  });
});
