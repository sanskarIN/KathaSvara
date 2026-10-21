// SPDX-License-Identifier: MPL-2.0
// Deterministic, privacy-preserving selection for both render and preflight IPC.
import type { StoryV2 } from "./story_v2";

export interface RenderSelection {
  selectedSceneIds: string[] | null;
  selectedSegmentIds: string[] | null;
  forceSegmentIds: string[] | null;
}

export function resolveRenderSelection(
  document: StoryV2,
  options: { sceneId?: string; segmentId?: string; forceAll?: boolean } = {},
): RenderSelection {
  const { sceneId, segmentId, forceAll = false } = options;
  if (!document.scenes.length) {
    throw new Error("Parse labeled dialogue before rendering or inspecting.");
  }
  const scenes = sceneId
    ? document.scenes.filter(scene => scene.id === sceneId)
    : document.scenes;
  if (!scenes.length) {
    throw new Error("The selected scene is no longer in this story.");
  }
  const spoken = scenes.flatMap(scene => scene.segments)
    .filter(segment => segment.kind === "speech" && (!segmentId || segment.id === segmentId));
  if (!spoken.length) {
    throw new Error("Select a scene with spoken dialogue before rendering.");
  }
  if (spoken.some(segment => !segment.speaker_id)) {
    throw new Error("Assign every selected dialogue speaker before rendering.");
  }
  if (spoken.length > 256 || spoken.reduce((n, segment) => n + segment.spoken_text.length, 0) > 100_000) {
    throw new Error("Render limit: 256 spoken segments and 100,000 characters. Choose a scene or split the story.");
  }
  return {
    selectedSceneIds: sceneId ? [sceneId] : null,
    selectedSegmentIds: segmentId ? [segmentId] : null,
    forceSegmentIds: forceAll
      ? spoken.map(segment => segment.id)
      : segmentId ? [segmentId] : null,
  };
}
