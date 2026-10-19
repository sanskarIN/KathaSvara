// SPDX-License-Identifier: MPL-2.0

export interface StoryProject {
  id: string;
  title: string;
  text: string;
}

export interface AudioResult {
  audio_id: string;
  data_url: string;
  duration_seconds: number;
  sample_rate: number;
  chunks: number;
}

export interface TextInspection {
  normalized: string;
  characters: number;
  chunks: string[];
  chunk_count: number;
  changed: boolean;
}

export function readSavedNumber(
  raw: string | null,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (raw === null || !raw.trim()) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

export type GenerationStatus = "waiting" | "loading" | "completed" | "failed";

export const STARTER_STORY =
  "नमस्कार मित्रों! कहानी वाली शाम में आपका स्वागत है।\n\n" +
  "आज की कहानी शुरू होती है एक ऐसे गाँव से, जहाँ हर शाम एक पुरानी घंटी अपने आप बज उठती थी।\n\n" +
  "लोग हैरान थे। कोई नहीं जानता था कि उस घंटी के पीछे कौन-सा रहस्य छिपा था।";

export function validateText(text: string): string | null {
  if (!text.trim()) return "कहानी लिखें या पेस्ट करें।";
  if ([...text].length > 3000) return "Please split stories longer than 3000 characters.";
  return null;
}

export function countText(text: string): { characters: number; words: number } {
  const trimmed = text.trim();
  return {
    characters: [...text].length,
    words: trimmed ? trimmed.split(/\s+/u).length : 0,
  };
}

export const SUPPORT_LINKS = [
  { label: "Buy Me a Coffee", href: "https://buymeacoffee.com/SanskarCodes" },
  { label: "Razorpay", href: "https://razorpay.me/@SanskarCodes" },
  { label: "PayPal.me", href: "https://paypal.me/SanskarCodes" },
] as const;
