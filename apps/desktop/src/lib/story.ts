// SPDX-License-Identifier: MPL-2.0

export interface StoryProject {
  id: string;
  title: string;
  text: string;
}

export interface AudioResult {
  audio_id: string;
  data_url: string;
  preview_available?: boolean;
  file_bytes?: number;
  duration_seconds: number;
  sample_rate: number;
  chunks: number;
  segment_timings?: Array<{
    segment_id: string;
    start_seconds: number;
    end_seconds: number;
    effective_text?: string;
  }>;
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

export interface EngineDiagnostics {
  python_311?: boolean;
  runtime_python_configured?: boolean;
  runtime_python_path_exists?: boolean;
  inference_dir_configured?: boolean;
  inference_dir_looks_valid?: boolean;
  temporary_write_test_passed?: boolean;
  tested_on_this_machine?: false;
  real_speech_verified?: false;
  python_version: string;
  platform: string;
  dependencies: {
    numpy: boolean;
    soundfile: boolean;
    torch: boolean;
    chatterbox: boolean;
  };
  dependencies_present: boolean;
  model_weights_verified: boolean;
  audio_synthesis_verified: boolean;
  help: string;
}

export type GenerationStatus = "waiting" | "loading" | "completed" | "failed";

export const STARTER_STORY =
  "नमस्कार मित्रों! कहानी वाली शाम में आपका स्वागत है।\n\n" +
  "आज की कहानी शुरू होती है एक ऐसे गाँव से, जहाँ हर शाम एक पुरानी घंटी अपने आप बज उठती थी।\n\n" +
  "लोग हैरान थे। कोई नहीं जानता था कि उस घंटी के पीछे कौन-सा रहस्य छिपा था।";

export function importedStoryTitle(name: string): string | null {
  if (!/\.(txt|md)$/i.test(name)) return null;
  const base = name.replace(/\.(txt|md)$/i, "").trim();
  return base.slice(0, 120) || "Imported story";
}

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
