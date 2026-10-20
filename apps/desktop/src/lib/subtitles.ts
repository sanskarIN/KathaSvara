// SPDX-License-Identifier: MPL-2.0

/** A measured per-dialogue-line cue, not word-level voice alignment. */
export interface SegmentTiming {
  segment_id: string;
  start_seconds: number;
  end_seconds: number;
  /** Exact glossary-adjusted content captured at render time, when available. */
  effective_text?: string;
}

export interface SubtitleLine {
  segment_id: string;
  text: string;
}

function srtTime(seconds: number): string {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds / 60_000) % 60;
  const secs = Math.floor(milliseconds / 1000) % 60;
  const millis = milliseconds % 1000;
  return [hours, minutes, secs].map(value => String(value).padStart(2, "0")).join(":")
    + "," + String(millis).padStart(3, "0");
}

/** Export Hindi-readable story text at actual generated segment boundaries. */
export function buildDialogueSrt(timings: SegmentTiming[], lines: SubtitleLine[]): string {
  if (timings.length === 0 || timings.length > 256) {
    throw new Error("Subtitle export requires 1–256 generated dialogue timings.");
  }
  const scripts = new Map(lines.map(line => [line.segment_id, line.text]));
  const cues: string[] = [];
  let previousEndMs = 0;
  for (const timing of timings) {
    const { start_seconds: start, end_seconds: end } = timing;
    const content = (timing.effective_text ?? scripts.get(timing.segment_id))
      ?.replace(/\s+/gu, " ").trim();
    // SubRip timestamps use integer milliseconds. Validate the same rounded
    // positions that the native exporter will parse, not a different tolerance.
    const startMs = Math.round(start * 1000);
    const endMs = Math.round(end * 1000);
    if (!content || !Number.isFinite(start) || !Number.isFinite(end) ||
        startMs < 0 || endMs <= startMs || startMs < previousEndMs || endMs > 1_200_000) {
      throw new Error("Missing dialogue or invalid generated subtitle timings.");
    }
    if (content.length > 3000) {
      throw new Error("A subtitle line exceeds the 3000-character limit.");
    }
    cues.push(`${cues.length + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${content}`);
    previousEndMs = endMs;
  }
  return cues.join("\n\n") + "\n";
}
