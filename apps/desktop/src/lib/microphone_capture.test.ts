// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { beginMicrophoneCapture, encodeMonoPcm16, MICROPHONE_RATE, wavToBase64 } from "./microphone_capture";

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

  it("filters above-Nyquist microphone noise instead of aliasing it into Hindi speech", () => {
    function rmsOfResampledTone(sourceRate: number, frequency: number): number {
      const input = Float32Array.from({ length: sourceRate / 10 }, (_, frame) =>
        0.75 * Math.sin(2 * Math.PI * frequency * frame / sourceRate));
      const wav = encodeMonoPcm16([input], sourceRate);
      const pcm = new DataView(wav.buffer);
      let sum = 0;
      let count = 0;
      // Ignore filter transients at the start and end of the short tone.
      for (let frame = 80; frame < (wav.length - 44) / 2 - 80; frame += 1) {
        const value = pcm.getInt16(44 + frame * 2, true) / 32768;
        sum += value * value;
        count += 1;
      }
      return Math.sqrt(sum / count);
    }
    expect(rmsOfResampledTone(48_000, 1_000)).toBeGreaterThan(0.45);
    expect(rmsOfResampledTone(48_000, 12_000)).toBeLessThan(0.02);
    expect(rmsOfResampledTone(44_100, 11_025)).toBeLessThan(0.02);
  });

  it("keeps cached filter output close to independently computed windowed-sinc reference", () => {
    for (const sourceRate of [44_100, 48_000, 96_000]) {
      const input = Float32Array.from({ length: Math.round(sourceRate / 10) },
        (_, i) => 0.45 * Math.sin(2 * Math.PI * 1100 * i / sourceRate) +
          0.1 * Math.sin(2 * Math.PI * 12000 * i / sourceRate));
      const wav = encodeMonoPcm16([input], sourceRate);
      const result = new DataView(wav.buffer);
      const ratio = sourceRate / MICROPHONE_RATE;
      const radius = Math.min(64, Math.ceil(12 * ratio));
      const cutoff = 0.90 / ratio;
      for (const sampleIndex of [0, 1, 7, 31, 80, 250, 600, 1499]) {
        const position = sampleIndex * ratio;
        let weighted = 0, sum = 0;
        const first = Math.max(0, Math.ceil(position - radius));
        const last = Math.min(input.length - 1, Math.floor(position + radius));
        for (let frame = first; frame <= last; frame += 1) {
          const distance = position - frame;
          const window = 0.5 * (1 + Math.cos(Math.PI * distance / radius));
          const sinc = Math.abs(distance) < 1e-12 ? cutoff :
            Math.sin(Math.PI * distance * cutoff) / (Math.PI * distance);
          const weight = sinc * window;
          weighted += input[frame] * weight;
          sum += weight;
        }
        const expected = Math.max(-1, Math.min(1, weighted / sum));
        const actual = result.getInt16(44 + sampleIndex * 2, true) / 32768;
        expect(Math.abs(actual - expected)).toBeLessThan(0.001);
      }
    }
  });

  it("reuses filter kernels instead of recalculating trigonometry for every PCM frame", () => {
    for (const sourceRate of [44_100, 48_000]) {
      const input = new Float32Array(sourceRate * 2).fill(0.25);
      const sine = vi.spyOn(Math, "sin");
      const cosine = vi.spyOn(Math, "cos");
      try {
        const wav = encodeMonoPcm16([input], sourceRate);
        expect(new DataView(wav.buffer).getUint32(40, true)).toBe(MICROPHONE_RATE * 4);
        // Original per-output-frame kernel cost was millions of calls here.
        // The cached implementation should require at most ~1025 kernels.
        expect(sine.mock.calls.length).toBeLessThan(70_000);
        expect(cosine.mock.calls.length).toBeLessThan(70_000);
      } finally {
        sine.mockRestore();
        cosine.mockRestore();
      }
    }
  });

  it("rejects empty, oversized, inconsistent and invalid input", () => {
    expect(() => encodeMonoPcm16([new Float32Array(0)], 16_000)).toThrow();
    expect(() => encodeMonoPcm16([new Float32Array(40 * 16_000)], 16_000)).toThrow();
    expect(() => encodeMonoPcm16([
      new Float32Array(100), new Float32Array(99),
    ], 16_000)).toThrow();
    expect(() => encodeMonoPcm16([new Float32Array(100)], 100)).toThrow();
    expect(() => encodeMonoPcm16([new Float32Array(100)], 16_000, 44_100)).toThrow();
    expect(() => encodeMonoPcm16([new Float32Array([0, Number.NaN])], 16_000))
      .toThrow("invalid values");
    expect(() => encodeMonoPcm16([new Float32Array([0, Number.POSITIVE_INFINITY])], 16_000))
      .toThrow("invalid values");
    expect(() => wavToBase64(new Uint8Array(44))).toThrow();
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mockWebAudioCapture() {
  const endedListeners = new Set<() => void>();
  const track = {
    stop: vi.fn(),
    readyState: "live" as "live" | "ended",
    addEventListener: vi.fn((event: string, listener: () => void) => {
      if (event === "ended") endedListeners.add(listener);
    }),
    removeEventListener: vi.fn((event: string, listener: () => void) => {
      if (event === "ended") endedListeners.delete(listener);
    }),
  };
  const disconnect = () => {
    track.readyState = "ended";
    for (const listener of [...endedListeners]) listener();
  };
  const getUserMedia = vi.fn().mockResolvedValue({
    getTracks: () => [track],
  });
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const processor = {
    onaudioprocess: null as ((event: AudioProcessingEvent) => void) | null,
    connect: vi.fn(), disconnect: vi.fn(),
  };
  const resume = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  class FakeAudioContext {
    sampleRate = 48_000;
    destination = {};
    resume = resume;
    close = close;
    createMediaStreamSource = vi.fn(() => source);
    createScriptProcessor = vi.fn(() => processor);
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("MediaRecorder", undefined);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  function sendSamples(input: Float32Array): Float32Array {
    const output = new Float32Array(input.length).fill(0.75);
    const onAudio = processor.onaudioprocess as (event: AudioProcessingEvent) => void;
    expect(typeof onAudio).toBe("function");
    onAudio({
      inputBuffer: { getChannelData: () => input },
      outputBuffer: { getChannelData: () => output },
    } as unknown as AudioProcessingEvent);
    return output;
  }
  return { track, disconnect, getUserMedia, source, processor, resume, close, sendSamples };
}

describe("microphone Web Audio recording lifecycle", () => {
  it("captures in-memory PCM without MediaRecorder, decoder or speaker monitoring", async () => {
    const audio = mockWebAudioCapture();
    const completed = vi.fn();
    const failed = vi.fn();
    const session = await beginMicrophoneCapture(completed, failed);
    expect(audio.getUserMedia).toHaveBeenCalledWith({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    const chunk = Float32Array.from({ length: 480 },
      (_, i) => i % 2 ? -0.5 : 0.5);
    const mutedOutput = audio.sendSamples(chunk);
    expect(Array.from(mutedOutput).every(sample => sample === 0)).toBe(true);
    session.stop();
    await Promise.resolve();
    expect(failed).not.toHaveBeenCalled();
    expect(completed).toHaveBeenCalledTimes(1);
    const binary = atob(completed.mock.calls[0][0] as string);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(160 * 2);
    expect(audio.track.stop).toHaveBeenCalledTimes(1);
    expect(audio.source.disconnect).toHaveBeenCalledOnce();
    expect(audio.processor.disconnect).toHaveBeenCalledOnce();
    expect(audio.close).toHaveBeenCalledOnce();
    session.stop();
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it("discards sampled data and refuses late callbacks after consent withdrawal", async () => {
    const audio = mockWebAudioCapture();
    const completed = vi.fn(), failed = vi.fn();
    const session = await beginMicrophoneCapture(completed, failed);
    audio.sendSamples(new Float32Array(240).fill(0.25));
    const oldHandler = audio.processor.onaudioprocess as (event: AudioProcessingEvent) => void;
    session.discard();
    oldHandler({
      inputBuffer: { getChannelData: () => new Float32Array(480).fill(0.5) },
      outputBuffer: { getChannelData: () => new Float32Array(480) },
    } as unknown as AudioProcessingEvent);
    session.stop();
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    expect(audio.track.stop).toHaveBeenCalledTimes(1);
    expect(audio.close).toHaveBeenCalledOnce();
  });

  it("rejects a recording with no PCM frames instead of manufacturing speech", async () => {
    const audio = mockWebAudioCapture();
    const completed = vi.fn(), failed = vi.fn();
    const session = await beginMicrophoneCapture(completed, failed);
    session.stop();
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith(expect.stringContaining("No usable microphone samples"));
    expect(audio.track.stop).toHaveBeenCalledOnce();
  });

  it("automatically ends capture after 30 seconds and releases microphone tracks", async () => {
    vi.useFakeTimers();
    const audio = mockWebAudioCapture();
    const completed = vi.fn(), failed = vi.fn();
    await beginMicrophoneCapture(completed, failed);
    audio.sendSamples(Float32Array.from({ length: 480 }, (_, i) => i % 2 ? -0.3 : 0.3));
    vi.advanceTimersByTime(30_000);
    await Promise.resolve();
    expect(audio.track.stop).toHaveBeenCalledOnce();
    expect(completed).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
  });

  it("abandons a pending permission prompt and releases any late-granted tracks", async () => {
    const audio = mockWebAudioCapture();
    let grant!: (stream: { getTracks: () => typeof audio.track[] }) => void;
    audio.getUserMedia.mockImplementationOnce(() =>
      new Promise(resolve => { grant = resolve; }));
    const controller = new AbortController();
    const completed = vi.fn(), failed = vi.fn();
    const starting = beginMicrophoneCapture(completed, failed, controller.signal);
    expect(audio.getUserMedia).toHaveBeenCalledOnce();
    controller.abort();
    await expect(starting).rejects.toThrow("Microphone request cancelled");
    // The OS may grant permission AFTER the UI has already dismissed startup.
    grant({ getTracks: () => [audio.track] });
    await Promise.resolve();
    await Promise.resolve();
    expect(audio.track.stop).toHaveBeenCalledOnce();
    expect(audio.resume).not.toHaveBeenCalled();
    expect(completed).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  it("stops granted tracks immediately if startup AudioContext.resume hangs", async () => {
    const audio = mockWebAudioCapture();
    let finishResume!: () => void;
    audio.resume.mockImplementationOnce(() =>
      new Promise<void>(resolve => { finishResume = resolve; }));
    const controller = new AbortController();
    const completed = vi.fn(), failed = vi.fn();
    const starting = beginMicrophoneCapture(completed, failed, controller.signal);
    await vi.waitFor(() => expect(audio.resume).toHaveBeenCalledOnce());
    controller.abort();
    await expect(starting).rejects.toThrow("Microphone request cancelled");
    expect(audio.track.stop).toHaveBeenCalledOnce();
    expect(audio.source.disconnect).toHaveBeenCalledOnce();
    expect(audio.processor.disconnect).toHaveBeenCalledOnce();
    expect(audio.close).toHaveBeenCalledOnce();
    // Even a delayed native resolution must never restart recording.
    finishResume();
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  it("aborts an active recording and leaves neither audio nor live tracks", async () => {
    const audio = mockWebAudioCapture();
    const controller = new AbortController();
    const completed = vi.fn(), failed = vi.fn();
    const session = await beginMicrophoneCapture(completed, failed, controller.signal);
    audio.sendSamples(new Float32Array(480).fill(0.25));
    controller.abort();
    session.stop();
    await Promise.resolve();
    expect(audio.track.stop).toHaveBeenCalledOnce();
    expect(completed).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  it("discards recorded samples and reports a disconnected microphone without sending partial speech", async () => {
    const audio = mockWebAudioCapture();
    const completed = vi.fn(), failed = vi.fn();
    const session = await beginMicrophoneCapture(completed, failed);
    audio.sendSamples(new Float32Array(480).fill(0.3));
    audio.disconnect();
    session.stop();
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledOnce();
    expect(failed.mock.calls[0][0]).toContain("Microphone input disconnected");
    expect(audio.track.stop).toHaveBeenCalledOnce();
    expect(audio.track.removeEventListener).toHaveBeenCalledWith("ended", expect.any(Function));
    expect(audio.source.disconnect).toHaveBeenCalledOnce();
    expect(audio.processor.disconnect).toHaveBeenCalledOnce();
    expect(audio.close).toHaveBeenCalledOnce();
    audio.disconnect();
    expect(failed).toHaveBeenCalledOnce();
  });

  it("refuses to record from a track that ended while the audio graph was starting", async () => {
    const audio = mockWebAudioCapture();
    audio.track.readyState = "ended";
    const completed = vi.fn(), failed = vi.fn();
    await expect(beginMicrophoneCapture(completed, failed))
      .rejects.toThrow("Microphone audio capture could not start");
    expect(audio.track.stop).toHaveBeenCalledOnce();
    expect(audio.close).toHaveBeenCalledOnce();
    expect(completed).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  it("releases granted microphone tracks when the audio graph cannot start", async () => {
    const audio = mockWebAudioCapture();
    audio.resume.mockRejectedValueOnce(new Error("Private OS audio failure"));
    const completed = vi.fn(), failed = vi.fn();
    await expect(beginMicrophoneCapture(completed, failed))
      .rejects.toThrow("Microphone audio capture could not start");
    expect(audio.track.stop).toHaveBeenCalledOnce();
    expect(audio.close).toHaveBeenCalledOnce();
    expect(completed).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });
});
