// SPDX-License-Identifier: MPL-2.0
// A safe, scene-aware *suggested filename*, never a trusted filesystem path.
import type { StoryV2 } from "./story_v2";

export interface AudioExportLabel {
  audioId: string;
  baseName: string;
  scope: "story" | "scene" | "line";
}

function component(value: string, fallback: string): string {
  const cleaned = value.normalize("NFC")
    // Windows path separators, punctuation and bidi controls are never filenames.
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/[^\p{L}\p{M}\p{N}\- _]+/gu, " ")
    .trim().replace(/[\s_-]+/gu, "-")
    .replace(/^[-. ]+|[-. ]+$/gu, "");
  return Array.from(cleaned).slice(0, 42).join("") || fallback;
}

/** Capture at render request time, never infer scope from the currently selected UI tab. */
export function renderExportLabel(
  project: StoryV2, audioId: string, sceneId?: string, segmentId?: string,
): AudioExportLabel {
  if (!audioId.trim()) throw new Error("Audio ID is required for export.");
  const title = component(project.title, "story");
  const prefix = `KathaSvara-${title}`;
  if (!sceneId && !segmentId) return {
    audioId, baseName: `${prefix}-full-story`, scope: "story",
  };
  const sceneIndex = project.scenes.findIndex(scene => scene.id === sceneId ||
    (!!segmentId && scene.segments.some(segment => segment.id === segmentId)));
  if (sceneIndex < 0) throw new Error("The render's scene is missing.");
  const scene = project.scenes[sceneIndex];
  if (sceneId && scene.id !== sceneId) throw new Error("The selected line is outside the scene.");
  const sceneNumber = String(sceneIndex + 1).padStart(3, "0");
  const sceneSuffix = `-scene-${sceneNumber}-${component(scene.title, "untitled")}`;
  if (!segmentId) return {
    audioId, baseName: `${prefix}${sceneSuffix}`, scope: "scene",
  };
  const lineIndex = scene.segments.findIndex(segment =>
    segment.id === segmentId && segment.kind === "speech");
  if (lineIndex < 0) throw new Error("The selected line is missing or not dialogue.");
  return {
    audioId,
    baseName: `${prefix}${sceneSuffix}-line-${String(lineIndex + 1).padStart(3, "0")}`,
    scope: "line",
  };
}

export function suggestedOutputFile(label: AudioExportLabel, kind: "wav" | "srt"): string {
  if (!label.audioId || !label.baseName || !["wav", "srt"].includes(kind)) {
    throw new Error("Invalid audio export description.");
  }
  return `${label.baseName}.${kind}`;
}
