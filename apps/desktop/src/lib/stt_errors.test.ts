// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { publicSttTranscriptionError } from "./stt_errors";

describe("fixed privacy-safe offline STT error guidance", () => {
  it.each([
    ["Local STT model is incomplete. Provide nonempty config.json, model.bin and tokenizer.json.", "nonempty"],
    ["Offline STT model files are missing or empty.", "model is missing"],
    ["Offline transcription is unavailable. Install the optional STT Python dependencies.", "optional faster-whisper"],
    ["Recording has no usable speech-level signal. Check microphone input and try again.", "silent"],
    ["Microphone recording has no usable audio signal. Check Windows microphone input.", "DC-only"],
    ["Local STT inference failed. Check the model files and available memory.", "model compatibility"],
    ["Local inference timed out. Check model installation or hardware.", "timed out"],
    ["Python 3.11 runtime not found. Configure KATHASVARA_PYTHON.", "Python 3.11"],
  ])("explains only the exact known native message", (error, expected) => {
    expect(publicSttTranscriptionError(error, "wav")).toContain(expected);
    expect(publicSttTranscriptionError(new Error(error), "microphone")).toContain(expected);
  });

  it("never prints private filenames, native exceptions, or unknown error prefixes", () => {
    const known = "Local STT model is incomplete. Provide nonempty config.json, model.bin and tokenizer.json.";
    const secret = "C:\\\\Users\\\\private\\\\my-voice.wav?token=secret";
    for (const value of [
      secret, new Error(secret),
      known + " " + secret, new Error(known + " " + secret),
      new Error(secret + " " + known), {}, null, 123, false,
    ]) {
      for (const kind of ["wav", "microphone"] as const) {
        const visible = publicSttTranscriptionError(value, kind);
        expect(visible).not.toContain(secret);
        expect(visible).not.toContain("token=");
        expect(visible).not.toContain("private");
        expect(visible).toContain("transcription failed");
      }
    }
  });

  it("retains the existing generic message for unknown WAV and microphone failures", () => {
    expect(publicSttTranscriptionError(new Error("unrecognized"), "wav"))
      .toContain("Use the model-free WAV signal check");
    expect(publicSttTranscriptionError("unrecognized", "microphone"))
      .toContain("Local microphone transcription failed");
  });
});
