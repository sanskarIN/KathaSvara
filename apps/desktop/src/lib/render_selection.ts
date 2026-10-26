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
  if (sceneId && scenes.length !== 1) {
    throw new Error("The selected scene ID is ambiguous. Repair duplicate scene IDs before rendering.");
  }
  // A scoped render must never silently target multiple lines sharing an ID.
  // Stage directions remain unspoken but still occupy the same ID namespace.
  if (segmentId) {
    const matches = document.scenes.flatMap(scene => scene.segments)
      .filter(segment => segment.id === segmentId);
    if (matches.length !== 1) {
      throw new Error("The selected line ID is missing or ambiguous. Repair duplicate line IDs before rendering.");
    }
  }
  const spoken = scenes.flatMap(scene => scene.segments)
    .filter(segment => segment.kind === "speech" && (!segmentId || segment.id === segmentId));
  if (!spoken.length) {
    throw new Error("Select a scene with spoken dialogue before rendering.");
  }
  if (spoken.some(segment => !segment.speaker_id)) {
    throw new Error("Assign every selected dialogue speaker before rendering.");
  }
  const knownSpeakers = new Map<string, number>();
  for (const character of document.characters) {
    knownSpeakers.set(character.id, (knownSpeakers.get(character.id) ?? 0) + 1);
  }
  if (spoken.some(segment => knownSpeakers.get(segment.speaker_id!) !== 1)) {
    throw new Error("Selected dialogue references a missing or duplicate character ID. Repair speaker assignments before rendering.");
  }
  const spokenIds = new Set<string>();
  for (const segment of spoken) {
    if (spokenIds.has(segment.id)) {
      throw new Error("Selected spoken lines share a duplicate ID. Repair line IDs before rendering.");
    }
    spokenIds.add(segment.id);
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
