// SPDX-License-Identifier: MPL-2.0
// Local, model-free navigation of user-authored scene metadata and Hindi text.
import type { StoryV2 } from "./story_v2";

export interface SceneOverview {
  id: string;
  title: string;
  spoken: number;
  directions: number;
  unresolved: number;
  /** Spoken lines assigned to a character ID that is absent from the cast. */
  invalidSpeakers: number;
  hasProductionNotes: boolean;
}

/**
 * Search filters the scene navigator only: never edit, persist or synthesize
 * the document. Counts are computed from the current source of truth, so a
 * resolved speaker immediately disappears from the "needs review" view.
 * Invalid non-null speaker IDs also require review, rather than hiding scenes.
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
  const knownSpeakerIds = new Set(story.characters.map(character => character.id));
  const matches = (value: string | null | undefined): boolean =>
    typeof value === "string" &&
    value.normalize("NFC").toLocaleLowerCase().includes(term);
  const result: SceneOverview[] = [];
  for (const scene of story.scenes) {
    let spoken = 0;
    let directions = 0;
    let unresolved = 0;
    let invalidSpeakers = 0;
    // The character filter only considers actual spoken dialogue, never stage directions.
    let hasCharacterSpeech = characterId === null;
    let found = !term || matches(scene.title) || matches(scene.notes);
    for (const line of scene.segments) {
      if (line.kind === "speech") {
        spoken += 1;
        if (line.speaker_id === characterId) hasCharacterSpeech = true;
        if (line.speaker_id === null) unresolved += 1;
        else if (!knownSpeakerIds.has(line.speaker_id)) invalidSpeakers += 1;
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
    if (!found || !hasCharacterSpeech || (unresolvedOnly && unresolved + invalidSpeakers === 0)) continue;
    result.push({
      id: scene.id,
      title: scene.title,
      spoken,
      directions,
      unresolved,
      invalidSpeakers,
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
  const coverage = new Map<string, CastCoverage>(story.characters.map(character => [
    character.id, {
      characterId: character.id,
      characterName: character.name,
      spokenLines: 0,
      sceneCount: 0,
    } satisfies CastCoverage,
  ] as const));
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

/** A single spoken line requiring manual speaker review, in source order. */
export interface SpeakerReviewTarget {
  sceneId: string;
  segmentId: string;
  reason: "unassigned" | "invalid";
}

/** Model-free diagnostics: never mutate the story or guess a character. */
export function speakerReviewTargets(story: StoryV2): SpeakerReviewTarget[] {
  const known = new Set(story.characters.map(character => character.id));
  const targets: SpeakerReviewTarget[] = [];
  for (const scene of story.scenes) {
    for (const segment of scene.segments) {
      if (segment.kind !== "speech") continue;
      const reason = segment.speaker_id === null ? "unassigned" :
        !known.has(segment.speaker_id) ? "invalid" : null;
      if (reason) targets.push({ sceneId: scene.id, segmentId: segment.id, reason });
    }
  }
  return targets;
}

/**
 * Walk both directions through issues in source order. Keep the cursor on
 * a just-repaired line by locating that line in the complete document first.
 * Missing or ambiguous identities reset to a deterministic boundary.
 * This is navigation only: no project data, audio, or speaker is changed.
 */
function navigateSpeakerReviewTarget(
  story: StoryV2,
  cursor: Pick<SpeakerReviewTarget, "sceneId" | "segmentId"> | null,
  direction: -1 | 1,
): SpeakerReviewTarget | null {
  const issues = speakerReviewTargets(story);
  if (issues.length === 0) return null;
  const fallback = direction === 1 ? issues[0] : issues[issues.length - 1];
  if (cursor === null) return fallback;

  let position = 0;
  let cursorPosition = -1;
  let cursorMatches = 0;
  const issuePositions: number[] = [];
  let issueIndex = 0;
  for (const scene of story.scenes) {
    for (const segment of scene.segments) {
      if (scene.id === cursor.sceneId && segment.id === cursor.segmentId) {
        cursorPosition = position;
        cursorMatches += 1;
      }
      if (issueIndex < issues.length &&
        issues[issueIndex].sceneId === scene.id &&
        issues[issueIndex].segmentId === segment.id) {
        issuePositions.push(position);
        issueIndex += 1;
      }
      position += 1;
    }
  }
  if (cursorMatches !== 1 || issuePositions.length !== issues.length) return fallback;
  if (direction === 1) {
    const nextIndex = issuePositions.findIndex(item => item > cursorPosition);
    return issues[nextIndex === -1 ? 0 : nextIndex];
  }
  for (let i = issuePositions.length - 1; i >= 0; i -= 1) {
    if (issuePositions[i] < cursorPosition) return issues[i];
  }
  return issues[issues.length - 1];
}

/** Move forward through all speaker issues, wrapping to the first. */
export function nextSpeakerReviewTarget(
  story: StoryV2,
  after: Pick<SpeakerReviewTarget, "sceneId" | "segmentId"> | null = null,
): SpeakerReviewTarget | null {
  return navigateSpeakerReviewTarget(story, after, 1);
}

/** Move backwards through all speaker issues, wrapping to the last. */
export function previousSpeakerReviewTarget(
  story: StoryV2,
  before: Pick<SpeakerReviewTarget, "sceneId" | "segmentId"> | null = null,
): SpeakerReviewTarget | null {
  return navigateSpeakerReviewTarget(story, before, -1);
}
