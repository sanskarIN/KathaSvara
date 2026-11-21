// SPDX-License-Identifier: MPL-2.0
/**
 * Non-invasive WebView2 microphone API readiness. This MUST NOT prompt for
 * permission, call getUserMedia, enumerate input devices, construct an
 * AudioContext, start recording, or load an STT model.
 *
 * Existence of browser APIs is not proof that a physical microphone, Windows
 * privacy settings, permission prompt, CPU or Hindi STT actually works.
 */
export type MicrophoneApiReason =
  | "insecure_context"
  | "media_capture_unavailable"
  | "audio_context_unavailable"
  | "pcm_capture_unavailable"
  | "apis_present";

export type MicrophoneApiCapabilities = {
  secureContext: boolean | null;
  mediaCapture: boolean;
  audioContext: boolean;
  pcmCapture: boolean;
};

export type MicrophoneApiReport = {
  reason: MicrophoneApiReason;
  api_present: boolean;
  permission_requested: false;
  recording_started: false;
  model_loaded: false;
};

export const MICROPHONE_API_ADVICE: Readonly<Record<MicrophoneApiReason, string>> = Object.freeze({
  insecure_context:
    "This WebView is not a secure context, so browser microphone access is unavailable. Use the desktop app with its intended secure runtime or select a local WAV.",
  media_capture_unavailable:
    "This WebView cannot expose the microphone capture API. Update the Windows WebView2 runtime and check Windows microphone privacy settings, or select an existing WAV.",
  audio_context_unavailable:
    "The browser audio engine is unavailable. Update Windows WebView2 or select an existing WAV.",
  pcm_capture_unavailable:
    "This WebView does not support the local PCM capture pipeline. Update Windows WebView2 or select an existing WAV.",
  apis_present:
    "Browser microphone APIs are present. This has not requested Windows permission, opened a device, captured audio or recognized Hindi. Use Start microphone recording with consent to test a real device.",
});

export function assessMicrophoneApiCapabilities(
  capabilities: MicrophoneApiCapabilities,
): MicrophoneApiReport {
  const reason: MicrophoneApiReason = capabilities.secureContext === false ? "insecure_context"
    : !capabilities.mediaCapture ? "media_capture_unavailable"
      : !capabilities.audioContext ? "audio_context_unavailable"
        : !capabilities.pcmCapture ? "pcm_capture_unavailable"
          : "apis_present";
  return {
    reason, api_present: reason === "apis_present",
    permission_requested: false, recording_started: false, model_loaded: false,
  };
}

/** Sample only API presence from the current runtime; never request access. */
export function probeMicrophoneApiAvailability(): MicrophoneApiReport {
  const audioContext = typeof AudioContext !== "undefined";
  return assessMicrophoneApiCapabilities({
    secureContext: typeof window.isSecureContext === "boolean" ? window.isSecureContext : null,
    mediaCapture: typeof navigator.mediaDevices?.getUserMedia === "function",
    audioContext,
    pcmCapture: audioContext && typeof AudioContext.prototype.createScriptProcessor === "function",
  });
}
