// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { countText, validateText } from "./story";

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
