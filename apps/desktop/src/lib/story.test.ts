// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { countText, readSavedNumber, validateText } from "./story";

describe("Hindi editor", () => {
  it("counts Unicode text without stripping Devanagari marks", () => {
    expect(countText("राजा भोज").words).toBe(2);
    expect(countText("राजा भोज").characters).toBe([...("राजा भोज")].length);
  });

  it("rejects empty scripts", () => {
    expect(validateText(" \n\t")).not.toBeNull();
  });

  it("enforces the generation text ceiling", () => {
    expect(validateText("अ".repeat(3001))).not.toBeNull();
    expect(validateText("नमस्कार मित्रों!")).toBeNull();
  });
});

describe("safe saved voice settings", () => {
  it("uses a default for absent or malformed preferences", () => {
    expect(readSavedNumber(null, 0.25, 2, 0.5)).toBe(0.5);
    expect(readSavedNumber("Infinity", 0.25, 2, 0.5)).toBe(0.5);
    expect(readSavedNumber("NaN", 0.25, 2, 0.5)).toBe(0.5);
    expect(readSavedNumber("3.2", 0.25, 2, 0.5)).toBe(0.5);
    expect(readSavedNumber(" ", 0, 1, 0.5)).toBe(0.5);
  });

  it("accepts permitted persisted values, including zero guidance", () => {
    expect(readSavedNumber("0.7", 0.25, 2, 0.5)).toBe(0.7);
    expect(readSavedNumber("0", 0, 1, 0.5)).toBe(0);
  });
});
