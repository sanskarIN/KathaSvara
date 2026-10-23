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

/** A caption shown locally before exporting exactly the same validated SubRip cue. */
export interface DialogueCue {
  number: number;
  start_seconds: number;
  end_seconds: number;
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

/** Validate the complete generated cue set, including cues outside the preview page.
 * Captions remain tied to the exact reviewed, glossary-adjusted render text.
 */
export function buildDialogueCues(timings: SegmentTiming[], lines: SubtitleLine[]): DialogueCue[] {
  if (timings.length === 0 || timings.length > 256) {
    throw new Error("Subtitle export requires 1–256 generated dialogue timings.");
  }
  const scripts = new Map(lines.map(line => [line.segment_id, line.text]));
  const seen = new Set<string>();
  const cues: DialogueCue[] = [];
  let previousEndMs = 0;
  for (const timing of timings) {
    const { start_seconds: start, end_seconds: end } = timing;
    const content = (timing.effective_text ?? scripts.get(timing.segment_id))
      ?.replace(/\s+/gu, " ").trim();
    const startMs = Math.round(start * 1000);
    const endMs = Math.round(end * 1000);
    if (!timing.segment_id || seen.has(timing.segment_id) ||
        !content || !Number.isFinite(start) || !Number.isFinite(end) ||
        start < 0 || startMs < 0 || endMs <= startMs ||
        startMs < previousEndMs || endMs > 1_200_000 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(content)) {
      throw new Error("Missing dialogue or invalid generated subtitle timings.");
    }
    if (content.length > 3000) {
      throw new Error("A subtitle line exceeds the 3000-character limit.");
    }
    seen.add(timing.segment_id);
    cues.push({
      number: cues.length + 1,
      start_seconds: startMs / 1000,
      end_seconds: endMs / 1000,
      text: content,
    });
    previousEndMs = endMs;
  }
  return cues;
}

/** Export Hindi-readable story text at actual generated segment boundaries.
 * The in-app cue preview and SRT export share this one validation path.
 */
export function buildDialogueSrt(timings: SegmentTiming[], lines: SubtitleLine[]): string {
  return buildDialogueCues(timings, lines).map(cue =>
    String(cue.number) + "\n" + srtTime(cue.start_seconds) +
    " --> " + srtTime(cue.end_seconds) + "\n" + cue.text,
  ).join("\n\n") + "\n";
}
