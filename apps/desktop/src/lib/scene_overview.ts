// SPDX-License-Identifier: MPL-2.0
// Local, model-free navigation of user-authored scene metadata and Hindi text.
import type { StoryV2 } from "./story_v2";

export interface SceneOverview {
  id: string;
  title: string;
  spoken: number;
  directions: number;
  unresolved: number;
  hasProductionNotes: boolean;
}

/**
 * Search filters the scene navigator only: never edit, persist or synthesize
 * the document. Counts are computed from the current source of truth, so a
 * resolved speaker immediately disappears from the "needs assignment" view.
 */
export function sceneOverview(
  story: StoryV2,
  search: string = "",
  unresolvedOnly: boolean = false,
): SceneOverview[] {
  const term = search.trim().normalize("NFC").toLocaleLowerCase();
  const matches = (value: string | null | undefined): boolean =>
    typeof value === "string" &&
    value.normalize("NFC").toLocaleLowerCase().includes(term);
  const result: SceneOverview[] = [];
  for (const scene of story.scenes) {
    let spoken = 0;
    let directions = 0;
    let unresolved = 0;
    let found = !term || matches(scene.title) || matches(scene.notes);
    for (const line of scene.segments) {
      if (line.kind === "speech") {
        spoken += 1;
        if (line.speaker_id === null) unresolved += 1;
      } else if (line.kind === "direction") {
        directions += 1;
      }
      if (!found && (
        matches(line.original_text) || matches(line.spoken_text) ||
        matches(line.source_label)
      )) {
        found = true;
      }
    }
    if (!found || (unresolvedOnly && unresolved === 0)) continue;
    result.push({
      id: scene.id,
      title: scene.title,
      spoken,
      directions,
      unresolved,
      hasProductionNotes: Boolean(scene.notes.trim()),
    });
  }
  return result;
}
