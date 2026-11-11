// SPDX-License-Identifier: MPL-2.0
// User-initiated, memory-only microphone capture. No network or STT model access.
export const MICROPHONE_MAX_SECONDS = 30;
export const MICROPHONE_RATE = 16_000;
const MAX_COMPRESSED_BYTES = 4 * 1024 * 1024;

export function encodeMonoPcm16(
  channels: readonly Float32Array[], sourceRate: number, targetRate = MICROPHONE_RATE,
): Uint8Array {
  if (channels.length < 1 || channels.length > 2 ||
      !Number.isFinite(sourceRate) || sourceRate < 8_000 || sourceRate > 192_000 ||
      !Number.isInteger(targetRate) || targetRate !== MICROPHONE_RATE) {
    throw new Error("Unsupported microphone audio format.");
  }
  const length = channels[0].length;
  if (!length || channels.some(ch => ch.length !== length) ||
      length / sourceRate > MICROPHONE_MAX_SECONDS + 0.5) {
    throw new Error("Recording is empty or exceeds the 30-second limit.");
  }
  const samples = Math.floor(length * targetRate / sourceRate);
  if (samples < 1 || samples > targetRate * (MICROPHONE_MAX_SECONDS + 1)) {
    throw new Error("Recording length is invalid.");
  }
  const wav = new Uint8Array(44 + samples * 2);
  const view = new DataView(wav.buffer);
  const ascii = (at: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) wav[at + i] = value.charCodeAt(i);
  };
  ascii(0, "RIFF"); view.setUint32(4, wav.length - 8, true); ascii(8, "WAVE");
  ascii(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true); view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, samples * 2, true);
  // Linear interpolation (and stereo downmix when needed). No audio data
  // is retained beyond this Uint8Array, which the caller explicitly handles.
  for (let i = 0; i < samples; i += 1) {
    const position = i * sourceRate / targetRate;
    const left = Math.min(length - 1, Math.floor(position));
    const right = Math.min(length - 1, left + 1);
    const fraction = position - left;
    let sample = 0;
    for (const channel of channels) {
      sample += channel[left] * (1 - fraction) + channel[right] * fraction;
    }
    sample = Math.max(-1, Math.min(1, sample / channels.length));
    view.setInt16(44 + i * 2, sample < 0 ?
      Math.round(sample * 32768) : Math.round(sample * 32767), true);
  }
  return wav;
}

export function wavToBase64(wav: Uint8Array): string {
  if (wav.length < 46 || wav.length > 2 * 1024 * 1024) {
    throw new Error("Recording exceeds the local transfer limit.");
  }
  const pieces: string[] = [];
  for (let i = 0; i < wav.length; i += 8192) {
    pieces.push(String.fromCharCode(...wav.subarray(i, i + 8192)));
  }
  return btoa(pieces.join(""));
}

export type MicrophoneCapture = { stop: () => void; discard: () => void };

export async function beginMicrophoneCapture(
  completed: (wavBase64: string) => void,
  failed: (message: string) => void,
): Promise<MicrophoneCapture> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new Error("Microphone recording is unavailable. Check Windows and WebView2 permissions.");
  }
  // The caller invokes this only in a direct user action after explicit consent.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  const closeTracks = () => stream.getTracks().forEach(track => track.stop());
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream);
  } catch {
    closeTracks();
    throw new Error("This WebView cannot record microphone audio.");
  }
  let canceled = false;
  let done = false;
  let total = 0;
  const chunks: Blob[] = [];
  let limitTimer: ReturnType<typeof setTimeout> | undefined;
  const release = () => {
    if (limitTimer) clearTimeout(limitTimer);
    closeTracks();
  };
  const handle: MicrophoneCapture = {
    stop: () => {
      if (!done && recorder.state !== "inactive") {
        done = true;
        if (limitTimer) clearTimeout(limitTimer);
        recorder.stop();
        closeTracks();
      }
    },
    discard: () => {
      canceled = true;
      done = true;
      if (recorder.state !== "inactive") recorder.stop();
      release();
      chunks.length = 0;
    },
  };
  recorder.ondataavailable = (event) => {
    if (canceled || !event.data.size) return;
    total += event.data.size;
    if (total > MAX_COMPRESSED_BYTES) {
      canceled = true;
      handle.discard();
      failed("Microphone recording exceeded its local size limit.");
    } else {
      chunks.push(event.data);
    }
  };
  recorder.addEventListener("error", () => {
    if (canceled) return;
    handle.discard();
    failed("Microphone recording failed. Verify Windows microphone permissions.");
  });
  recorder.onstop = async () => {
    release();
    if (canceled) return;
    try {
      if (!chunks.length || !total || total > MAX_COMPRESSED_BYTES) {
        throw new Error("No microphone audio was captured.");
      }
      if (typeof AudioContext === "undefined") {
        throw new Error("Audio decoding is not supported by this WebView.");
      }
      const context = new AudioContext();
      let wav: Uint8Array;
      try {
        const data = await new Blob(chunks).arrayBuffer();
        const audio = await context.decodeAudioData(data);
        const channels = Array.from({ length: audio.numberOfChannels },
          (_, n) => audio.getChannelData(n));
        wav = encodeMonoPcm16(channels, audio.sampleRate);
      } finally {
        await context.close();
        chunks.length = 0;
      }
      if (!canceled) completed(wavToBase64(wav));
    } catch {
      if (!canceled) failed("Could not decode this short recording. Try again or select a PCM16 WAV.");
    }
  };
  try {
    recorder.start(250);
    limitTimer = setTimeout(() => handle.stop(), MICROPHONE_MAX_SECONDS * 1000);
  } catch {
    handle.discard();
    throw new Error("Microphone capture could not start.");
  }
  return handle;
}
