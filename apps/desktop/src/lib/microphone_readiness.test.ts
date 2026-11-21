// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { assessMicrophoneApiCapabilities, MICROPHONE_API_ADVICE } from "./microphone_readiness";

describe("model-free WebView2 microphone API readiness", () => {
  const available = {
    secureContext: true, mediaCapture: true, audioContext: true, pcmCapture: true,
  } as const;

  it.each([
    [{ secureContext: false }, "insecure_context"],
    [{ mediaCapture: false }, "media_capture_unavailable"],
    [{ audioContext: false }, "audio_context_unavailable"],
    [{ pcmCapture: false }, "pcm_capture_unavailable"],
  ] as const)("returns fixed, private-safe %s advice", (override, reason) => {
    const report = assessMicrophoneApiCapabilities({ ...available, ...override });
    expect(report.reason).toBe(reason);
    expect(report.api_present).toBe(false);
    expect(report.permission_requested).toBe(false);
    expect(report.recording_started).toBe(false);
    expect(report.model_loaded).toBe(false);
    expect(MICROPHONE_API_ADVICE[report.reason]).not.toMatch(/\\\\Users\\\\|token=/);
  });

  it("does not misrepresent API presence as permission, recording or recognition", () => {
    const report = assessMicrophoneApiCapabilities(available);
    expect(report.reason).toBe("apis_present");
    expect(report.api_present).toBe(true);
    expect(report.permission_requested).toBe(false);
    expect(report.recording_started).toBe(false);
    expect(report.model_loaded).toBe(false);
    expect(MICROPHONE_API_ADVICE[report.reason]).toContain("not requested Windows permission");
  });

  it("treats unknown secure-context metadata as unknown, not proven insecure", () => {
    const report = assessMicrophoneApiCapabilities({ ...available, secureContext: null });
    expect(report.reason).toBe("apis_present");
    expect(report.permission_requested).toBe(false);
  });

  it("reports the earliest blocker without collecting devices or private details", () => {
    const report = assessMicrophoneApiCapabilities({
      secureContext: false, mediaCapture: false, audioContext: false, pcmCapture: false,
    });
    expect(report.reason).toBe("insecure_context");
    expect(Object.keys(report).sort()).toEqual([
      "api_present", "model_loaded", "permission_requested", "reason", "recording_started",
    ]);
  });
});
