// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { hasUnsafeSttTextControls, removeUnsafeSttTextControls } from "./stt_text";

describe("untrusted Hindi STT review and model text controls", () => {
  it.each([
    0x0000, 0x0008, 0x000b, 0x001f, 0x007f, 0x0080, 0x009f,
    0x00ad, 0x034f, 0x061c, 0x200b, 0x200e, 0x200f, 0x202a, 0x202e,
    0x2060, 0x2066, 0x2069, 0x206a, 0x206f, 0xfeff,
    0xd800, 0xdfff,  // lone UTF-16 surrogates are invalid model output
  ])("rejects control code point U+%s", point => {
    expect(hasUnsafeSttTextControls("नमस्ते" + String.fromCodePoint(point) + "भारत")).toBe(true);
  });

  it.each(["नमस्ते भारत", "क्\u200dष", "क्\u200cष", "हिंदी\nअगली पंक्ति", "क\tख"])(
    "retains legitimate Devanagari writing and whitespace", text => {
      expect(hasUnsafeSttTextControls(text)).toBe(false);
    },
  );

  it("keeps well-formed astral Unicode but removes lone surrogates on explicit repair", () => {
    const clean = "हिंदी 🎙️🚀";
    expect(hasUnsafeSttTextControls(clean)).toBe(false);
    expect(removeUnsafeSttTextControls(clean)).toBe(clean);
    const malformed = "हिंदी" + String.fromCharCode(0xd800) + " " +
      String.fromCharCode(0xdfff) + "🎙️";
    expect(hasUnsafeSttTextControls(malformed)).toBe(true);
    expect(removeUnsafeSttTextControls(malformed)).toBe("हिंदी 🎙️");
  });

  it("repairs only forbidden formatting on an explicit call, preserving Hindi glyphs", () => {
    const original = "क्" + String.fromCodePoint(0x200d) + "ष" +
      String.fromCodePoint(0x202e) + " हिंदी" +
      String.fromCodePoint(0x200b) + String.fromCodePoint(0x80);
    expect(removeUnsafeSttTextControls(original)).toBe("क्" + String.fromCodePoint(0x200d) + "ष हिंदी");
    expect(hasUnsafeSttTextControls(removeUnsafeSttTextControls(original))).toBe(false);
    expect(original).toContain(String.fromCodePoint(0x202e));
    expect(original).toContain(String.fromCodePoint(0x200b));
  });

  it("leaves valid Hindi, newline and tab text byte-for-byte unchanged", () => {
    const clean = "क्" + String.fromCodePoint(0x200c) + "ष हिंदी\nनई पंक्ति\tशब्द";
    expect(removeUnsafeSttTextControls(clean)).toBe(clean);
  });
  it("does not rewrite a user edit or silently remove an unsafe character", () => {
    const input = "मेरी" + String.fromCodePoint(0x202e) + "कहानी";
    expect(hasUnsafeSttTextControls(input)).toBe(true);
    expect(input).toContain(String.fromCodePoint(0x202e));
  });
});
