// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { publicMicrophoneCaptureFailure, publicMicrophoneStartupError } from "./microphone_errors";

describe("privacy-safe microphone startup guidance", () => {
  it.each([
    ["NotAllowedError", "denied or blocked"],
    ["PermissionDeniedError", "denied or blocked"],
    ["SecurityError", "disabled in this WebView"],
    ["NotFoundError", "No compatible microphone"],
    ["DevicesNotFoundError", "No compatible microphone"],
    ["NotReadableError", "cannot be read"],
    ["TrackStartError", "cannot be read"],
    ["OverconstrainedError", "recording constraints"],
    ["ConstraintNotSatisfiedError", "recording constraints"],
    ["InvalidStateError", "active app window"],
    ["AbortError", "interrupted"],
    ["NotSupportedError", "does not support"],
    ["TypeError", "not available in this WebView"],
  ])("classifies %s with fixed guidance instead of arbitrary exception text", (name, help) => {
    const privateData = "C:\\\\Users\\\\private\\\\story.wav token=secret";
    const error = Object.assign(new Error(privateData), { name, constraint: privateData });
    const result = publicMicrophoneStartupError(error);
    expect(result).toContain(help);
    expect(result).not.toContain("private");
    expect(result).not.toContain("token=");
    expect(result).not.toContain("story.wav");
  });

  it("rejects unknown names, plain strings and hostile getters", () => {
    const privateData = "C:\\\\Users\\\\private\\\\story.wav";
    const inputs: unknown[] = [
      new Error(privateData),
      privateData,
      null,
      { name: "NotAllowedError: " + privateData },
      { name: 123, message: privateData },
      { get name(): never { throw new Error(privateData); } },
    ];
    const messages = inputs.map(publicMicrophoneStartupError);
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toContain("Microphone startup failed");
    expect(messages.every(msg => !msg.includes(privateData))).toBe(true);
  });
});

describe("privacy-safe microphone signal and recording failures", () => {
  it.each([
    ["empty", "No microphone samples"],
    ["near_silence", "nearly silent"],
    ["dc_only", "no varying signal"],
    ["capture_failed", "could not be converted"],
    ["device_disconnected", "disconnected during recording"],
  ])("maps %s to fixed actionable input guidance", (code, hint) => {
    const result = publicMicrophoneCaptureFailure(code);
    expect(result).toContain(hint);
    expect(result).not.toContain("C:\\\\Users");
  });

  it("never copies unknown or malicious callback content to Settings", () => {
    const secret = "C:\\\\private\\\\mic.wav token=secret";
    for (const code of [secret, "near_silence " + secret, null, 123, { message: secret }]) {
      const result = publicMicrophoneCaptureFailure(code);
      expect(result).toContain("Microphone recording failed");
      expect(result).not.toContain(secret);
    }
  });
});
