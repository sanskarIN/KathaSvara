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
 * An optional cast filter matches assigned spoken lines by stable character ID;
 * it does not treat unspoken directions as actor appearances.
 */
export function sceneOverview(
  story: StoryV2,
  search: string = "",
  unresolvedOnly: boolean = false,
  characterId: string | null = null,
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
    // The character filter only considers actual spoken dialogue, never stage directions.
    let hasCharacterSpeech = characterId === null;
    let found = !term || matches(scene.title) || matches(scene.notes);
    for (const line of scene.segments) {
      if (line.kind === "speech") {
        spoken += 1;
        if (line.speaker_id === characterId) hasCharacterSpeech = true;
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
    if (!found || !hasCharacterSpeech || (unresolvedOnly && unresolved === 0)) continue;
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

/** A local, source-only breakdown; never infer or certify distinct voice identities. */
export interface CastCoverage {
  characterId: string;
  characterName: string;
  spokenLines: number;
  sceneCount: number;
}
export interface CastCoverageSummary {
  characters: CastCoverage[];
  spokenLines: number;
  directions: number;
  unassignedSpeech: number;
  invalidSpeakerAssignments: number;
}

/**
 * Count actual spoken turns per actor, even if no audio has been generated.
 * Track invalid non-null speaker references separately from explicitly
 * unassigned speech so malformed documents are not reported as fully cast.
 * This function must not mutate project data or write any personal dialogue.
 */
export function castCoverage(story: StoryV2): CastCoverageSummary {
  const coverage = new Map(story.characters.map(character => [
    character.id, {
      characterId: character.id,
      characterName: character.name,
      spokenLines: 0,
      sceneCount: 0,
    } satisfies CastCoverage,
  ]));
  let spokenLines = 0;
  let directions = 0;
  let unassignedSpeech = 0;
  let invalidSpeakerAssignments = 0;
  for (const scene of story.scenes) {
    const appearing = new Set<string>();
    for (const segment of scene.segments) {
      if (segment.kind === "direction") {
        directions += 1;
        continue;
      }
      if (segment.kind !== "speech") continue;
      spokenLines += 1;
      if (segment.speaker_id === null) {
        unassignedSpeech += 1;
        continue;
      }
      const actor = coverage.get(segment.speaker_id);
      if (!actor) {
        invalidSpeakerAssignments += 1;
        continue;
      }
      actor.spokenLines += 1;
      appearing.add(segment.speaker_id);
    }
    for (const id of appearing) coverage.get(id)!.sceneCount += 1;
  }
  return {
    characters: [...coverage.values()],
    spokenLines,
    directions,
    unassignedSpeech,
    invalidSpeakerAssignments,
  };
}
