// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { encodeMonoPcm16, MICROPHONE_RATE, wavToBase64 } from "./microphone_capture";

describe("private microphone WAV encoding", () => {
  it("encodes 16 kHz mono PCM16 with canonical RIFF size and samples", () => {
    const wav = encodeMonoPcm16([new Float32Array([0, 0.5, -0.5, 1, -1])], 16_000);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe("WAVE");
    expect(String.fromCharCode(...wav.subarray(12, 16))).toBe("fmt ");
    expect(String.fromCharCode(...wav.subarray(36, 40))).toBe("data");
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(MICROPHONE_RATE);
    expect(view.getUint32(28, true)).toBe(32_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(10);
    expect(Array.from({ length: 5 }, (_, i) => view.getInt16(44 + i * 2, true)))
      .toEqual([0, 16384, -16384, 32767, -32768]);
  });

  it("downsamples safely and mixes stereo into a mono PCM16 stream", () => {
    const left = new Float32Array(48_000).fill(0.5);
    const right = new Float32Array(48_000).fill(-0.5);
    const wav = encodeMonoPcm16([left, right], 48_000);
    const view = new DataView(wav.buffer);
    expect(view.getUint32(40, true)).toBe(32_000);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(wav.length - 2, true)).toBe(0);
    expect(wavToBase64(wav)).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it("rejects empty, oversized, inconsistent and invalid input", () => {
    expect(() => encodeMonoPcm16([new Float32Array(0)], 16_000)).toThrow();
    expect(() => encodeMonoPcm16([new Float32Array(40 * 16_000)], 16_000)).toThrow();
    expect(() => encodeMonoPcm16([
      new Float32Array(100), new Float32Array(99),
    ], 16_000)).toThrow();
    expect(() => encodeMonoPcm16([new Float32Array(100)], 100)).toThrow();
    expect(() => encodeMonoPcm16([new Float32Array(100)], 16_000, 44_100)).toThrow();
    expect(() => wavToBase64(new Uint8Array(44))).toThrow();
  });
});
