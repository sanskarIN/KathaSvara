// SPDX-License-Identifier: MPL-2.0
/** A fresh, unpredictable UUID-v4 routes a Cancel request to exactly one
 * native STT job. Never use predictable counters or a shared cancel flag:
 * old UI requests must not interrupt unrelated or later recognition jobs.
 */
export function createSttJobId(): string {
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("Secure local transcription identifiers are unavailable.");
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
