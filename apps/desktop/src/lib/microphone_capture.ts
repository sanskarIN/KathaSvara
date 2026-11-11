// SPDX-License-Identifier: MPL-2.0
// User-initiated, memory-only microphone capture. No network or STT model access.
export const MICROPHONE_MAX_SECONDS = 30;
export const MICROPHONE_RATE = 16_000;

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

const microphoneCancelled = () => new Error("Microphone request cancelled.");

/** Cancel awaits immediately, even when a native permission/resume promise hangs. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const onAbort = () => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", onAbort);
      reject(microphoneCancelled());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    // Always attach handlers: a late native rejection must not escape into
    // an unhandled promise after the caller already cancelled the request.
    promise.then(value => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    }, error => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}

/**
 * Record raw Web Audio samples rather than MediaRecorder's compressed
 * WebM/Opus/MP4 blobs. WebView decoding support for MediaRecorder output is
 * inconsistent; a bounded PCM pipeline avoids a decodeAudioData round-trip.
 *
 * ScriptProcessorNode is a compatibility path for WebView2. A future
 * AudioWorklet may replace it after real-device acceptance. Never connect
 * actual microphone samples to speakers: the processor output is zeroed.
 */
export async function beginMicrophoneCapture(
  completed: (wavBase64: string) => void,
  failed: (message: string) => void,
  signal?: AbortSignal,
): Promise<MicrophoneCapture> {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
    throw new Error("Microphone recording is unavailable. Check Windows and WebView2 permissions.");
  }
  // Cancellation does not dismiss every OS permission dialog. Resolve the
  // UI immediately, but stop any stream the OS grants after user withdrawal.
  if (signal?.aborted) throw microphoneCancelled();
  const permission = navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    video: false,
  }).then(granted => {
    if (signal?.aborted) {
      granted.getTracks().forEach(track => { try { track.stop(); } catch { /* No stream kept. */ } });
      throw microphoneCancelled();
    }
    return granted;
  });
  const stream = await abortable(permission, signal);
  const closeTracks = () => stream.getTracks().forEach(track => {
    try { track.stop(); } catch { /* Keep stopping remaining microphone tracks. */ }
  });
  if (signal?.aborted) {
    closeTracks();
    throw microphoneCancelled();
  }
  let context: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  let stopped = false;
  let received = 0;
  let samples: Float32Array | null = null;
  let onAbort: (() => void) | null = null;

  const release = () => {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    onAbort = null;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (processor) {
      processor.onaudioprocess = null;
      try { processor.disconnect(); } catch { /* Always release tracks. */ }
    }
    if (source) {
      try { source.disconnect(); } catch { /* Always release tracks. */ }
    }
    closeTracks();
    if (context) {
      try { void context.close().catch(() => {}); } catch { /* Tracks are already stopped. */ }
    }
  };

  const handle: MicrophoneCapture = {
    stop: () => {
      if (stopped) return;
      stopped = true;
      release();
      try {
        if (!samples || !context || received === 0) {
          throw new Error("Empty microphone recording.");
        }
        const wav = encodeMonoPcm16([samples.subarray(0, received)], context.sampleRate);
        const encoded = wavToBase64(wav);
        // The UI marks stop as "processing" immediately after this call.
        // Deliver results in the next microtask so "ready" wins, and allow
        // a synchronous discard/navigation to cancel even a queued result.
        queueMicrotask(() => { if (!cancelled) completed(encoded); });
      } catch {
        queueMicrotask(() => {
          if (!cancelled) failed("No usable microphone samples were captured. Check Windows microphone access.");
        });
      } finally {
        samples?.fill(0);
        samples = null;
      }
    },
    discard: () => {
      cancelled = true;
      if (!stopped) {
        stopped = true;
        release();
      }
      samples?.fill(0);
      samples = null;
    },
  };

  if (signal) {
    onAbort = () => handle.discard();
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      handle.discard();
      throw microphoneCancelled();
    }
  }
  try {
    context = new AudioContext();
    const rate = context.sampleRate;
    if (!Number.isFinite(rate) || rate < 8_000 || rate > 192_000 ||
        typeof context.createScriptProcessor !== "function") {
      throw new Error("Unsupported microphone audio graph.");
    }
    const maxFrames = Math.floor(rate * MICROPHONE_MAX_SECONDS);
    samples = new Float32Array(maxFrames);
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => {
      if (stopped || !samples) return;
      try {
        // ScriptProcessor must have an output connection to receive events,
        // but no recorded sound is ever fed into the speakers.
        event.outputBuffer.getChannelData(0).fill(0);
        const input = event.inputBuffer.getChannelData(0);
        const take = Math.min(input.length, samples.length - received);
        if (take > 0) samples.set(input.subarray(0, take), received);
        received += take;
        if (received >= maxFrames) handle.stop();
      } catch {
        handle.discard();
        failed("Microphone audio capture failed. Check Windows input permissions.");
      }
    };
    source.connect(processor);
    processor.connect(context.destination);
    await abortable(context.resume(), signal);
    if (signal?.aborted || stopped) throw microphoneCancelled();
    timer = setTimeout(() => handle.stop(), MICROPHONE_MAX_SECONDS * 1000);
    return handle;
  } catch {
    handle.discard();
    if (signal?.aborted) throw microphoneCancelled();
    throw new Error("Microphone audio capture could not start. Check Windows and WebView2.");
  }
}
