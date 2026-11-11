// SPDX-License-Identifier: MPL-2.0
/**
 * Fixed, privacy-safe user guidance for common browser microphone failures.
 *
 * A WebView/OS DOMException can include a device ID, local path, web origin,
 * or other private diagnostic strings. Use ONLY its standardized `name`
 * category; never render `message`, `stack`, `constraint` or `cause`.
 * Do not misrepresent any category as proof that the OS permission was tested.
 */
const MIC_FAILURE_GUIDANCE: Readonly<Record<string, string>> = Object.freeze({
  NotAllowedError: "Microphone access was denied or blocked. Check Windows Settings → Privacy & security → Microphone, allow desktop app microphone access, and review the WebView2 permission prompt.",
  PermissionDeniedError: "Microphone access was denied or blocked. Check Windows Settings → Privacy & security → Microphone, allow desktop app microphone access, and review the WebView2 permission prompt.",
  SecurityError: "Microphone access is disabled in this WebView. Check Windows microphone privacy controls and the app's WebView2 security configuration.",
  NotFoundError: "No compatible microphone was found. Connect or enable an input device in Windows Settings → System → Sound → Input, then try again.",
  DevicesNotFoundError: "No compatible microphone was found. Connect or enable an input device in Windows Settings → System → Sound → Input, then try again.",
  NotReadableError: "The selected microphone cannot be read. Check Windows sound input, close other apps using the device, and retry.",
  TrackStartError: "The selected microphone cannot be read. Check Windows sound input, close other apps using the device, and retry.",
  OverconstrainedError: "This microphone does not support the requested recording constraints. Try another input device or review its Windows sound settings.",
  ConstraintNotSatisfiedError: "This microphone does not support the requested recording constraints. Try another input device or review its Windows sound settings.",
  InvalidStateError: "Microphone startup requires an active app window. Return to KathaSvara and try again.",
  AbortError: "Microphone startup was interrupted by the browser or operating system. Review the input device and retry.",
  NotSupportedError: "This WebView does not support the required audio capture API. Update the Microsoft Edge WebView2 Runtime or use an existing WAV file.",
  TypeError: "Microphone access was not available in this WebView context. Check WebView2 setup and local privacy permissions.",
});

const GENERIC_MIC_FAILURE =
  "Microphone startup failed. Check Windows microphone access, WebView2 permissions, or select an existing local WAV.";

export function publicMicrophoneStartupError(error: unknown): string {
  let name: unknown;
  try {
    if (error !== null && (typeof error === "object" || typeof error === "function")) {
      name = (error as { name?: unknown }).name;
    }
  } catch {
    // An untrusted getter is not allowed to inject diagnostics into the UI.
    return GENERIC_MIC_FAILURE;
  }
  if (typeof name === "string" &&
      Object.prototype.hasOwnProperty.call(MIC_FAILURE_GUIDANCE, name)) {
    return MIC_FAILURE_GUIDANCE[name];
  }
  return GENERIC_MIC_FAILURE;
}
