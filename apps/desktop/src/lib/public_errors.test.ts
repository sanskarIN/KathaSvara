// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { publicDesktopError } from "./public_errors";

describe("privacy-safe desktop errors", () => {
  it("keeps only exact vetted KathaSvara-owned messages", () => {
    const safe = "Another real speech generation or story render is already running. Wait for it to finish.";
    expect(publicDesktopError(new Error(safe))).toBe(safe);
    expect(publicDesktopError("Local inference timed out. Check model installation or hardware."))
      .toBe("Local inference timed out. Check model installation or hardware.");
  });

  it("redacts native paths, tokens, local voices and story text", () => {
    for (const error of [
      new Error("C:\\Users\\private-singer\\voice.wav"),
      "/home/private-singer/.cache/model/token.txt",
      new Error("HTTP request failed; Authorization: Bearer secret-access"),
      "Hindi dialogue: यह मेरी निजी कहानी है।",
      new Error("Speech worker audio metadata does not match the saved WAV. /home/private"),
      new Error("Local inference timed out. Check model installation or hardware.\nC:\\Private"),
      { message: "C:\\Private\\secret.wav", toString: () => "secret-password" },
      null, undefined, 42,
    ]) {
      const output = publicDesktopError(error);
      expect(output).toContain("Local operation failed");
      expect(output).not.toMatch(/private-singer|secret|Authorization|निजी|C:\\|\/home\//);
    }
  });

  it("rejects prefix, suffix, whitespace, and control-character message forgery", () => {
    const known = "Generated audio is missing.";
    for (const text of [known + " /private/voice.wav", "\n" + known, known + "\n", known + "\0"]) {
      expect(publicDesktopError(text)).not.toBe(known);
    }
  });
});
