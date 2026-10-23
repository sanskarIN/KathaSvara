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

/** When supplied by the desktop, compare cues to the exact generated WAV metadata.
 * These are consistency checks, not claims about spoken Hindi or audio quality.
 */
export interface RenderedWavBounds {
  duration_seconds: number;
  sample_rate: number;
}

/** Validate the complete generated cue set, including cues outside the preview page.
 * Captions stay attached to a known spoken segment from the active story, and
 * use that segment's exact glossary-adjusted render text where available.
 */
export function buildDialogueCues(
  timings: SegmentTiming[], lines: SubtitleLine[], wav?: RenderedWavBounds,
): DialogueCue[] {
  if (timings.length === 0 || timings.length > 256) {
    throw new Error("Subtitle export requires 1–256 generated dialogue timings.");
  }
  if (wav && (!Number.isFinite(wav.duration_seconds) ||
      wav.duration_seconds <= 0 || wav.duration_seconds > 1200 ||
      !Number.isSafeInteger(wav.sample_rate) ||
      wav.sample_rate < 8000 || wav.sample_rate > 192000)) {
    throw new Error("Invalid generated WAV duration or sample rate.");
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
    if (!timing.segment_id || !scripts.has(timing.segment_id) ||
        seen.has(timing.segment_id) ||
        !content || !Number.isFinite(start) || !Number.isFinite(end) ||
        start < 0 || startMs < 0 || endMs <= startMs ||
        startMs < previousEndMs || endMs > 1_200_000 ||
        (wav && endMs > Math.round(wav.duration_seconds * 1000) + 5) ||
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
export function buildDialogueSrt(
  timings: SegmentTiming[], lines: SubtitleLine[], wav?: RenderedWavBounds,
): string {
  return buildDialogueCues(timings, lines, wav).map(cue =>
    String(cue.number) + "\n" + srtTime(cue.start_seconds) +
    " --> " + srtTime(cue.end_seconds) + "\n" + cue.text,
  ).join("\n\n") + "\n";
}
