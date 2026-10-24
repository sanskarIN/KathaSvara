// SPDX-License-Identifier: MPL-2.0
// Explicit schema: v0.1.x files are not overwritten by v2 story saves.
import type { StoryProject } from "./story";

export interface VoiceProfileV2 {
  engine_id: "chatterbox-multilingual";
  model_id: string;
  language: "hi";
  exaggeration: number;
  cfg_weight: number;
  pause_ms: number;
  profile_version: 1;
  speaker_conditioning: null;
}
export interface CharacterV2 {
  id: string;
  name: string;
  voice: VoiceProfileV2;
  description: string;
}
export interface SegmentV2 {
  id: string;
  original_text: string;
  spoken_text: string;
  speaker_id: string | null;
  kind: "speech" | "direction";
  status: string;
  audio_ref: string | null;
  duration_seconds: number | null;
  source_label: string | null;
}
export interface SceneV2 {
  id: string;
  title: string;
  segments: SegmentV2[];
  notes: string;
}
export interface PronunciationRuleV2 {
  id: string;
  original: string;
  spoken: string;
  enabled: boolean;
}
export interface StoryV2 {
  schema_version: 2;
  id: string;
  title: string;
  text: string;
  characters: CharacterV2[];
  scenes: SceneV2[];
  /** Missing in older v0.2.0 documents; serialized as [] on next save. */
  pronunciation_glossary?: PronunciationRuleV2[];
}
export interface DialogueParseResponse {
  ok: true;
  result: StoryV2;
  unresolved: string[];
  distinct_voices_verified: false;
}

export function defaultVoice(): VoiceProfileV2 {
  return {
    engine_id: "chatterbox-multilingual",
    model_id: "chatterbox-multilingual",
    language: "hi",
    exaggeration: 0.5,
    cfg_weight: 0.5,
    pause_ms: 140,
    profile_version: 1,
    speaker_conditioning: null,
  };
}

export function makeCharacter(name: string, id: string = crypto.randomUUID()): CharacterV2 {
  if (!name.trim() || name.trim().length > 120) {
    throw new Error("Character name must be 1–120 characters.");
  }
  return { id, name: name.trim(), voice: defaultVoice(), description: "" };
}

export function legacyToStoryV2(project: StoryProject, id: string = crypto.randomUUID()): StoryV2 {
  return {
    schema_version: 2,
    id: project.id || id,
    title: project.title,
    text: project.text,
    characters: [makeCharacter("Narrator", "narrator")],
    scenes: [],
    pronunciation_glossary: [],
  };
}

export function addCharacter(project: StoryV2, name: string, id?: string): StoryV2 {
  if (project.characters.length >= 100) throw new Error("Maximum 100 characters.");
  const character = makeCharacter(name, id);
  if (project.characters.some(item => item.id === character.id)) {
    throw new Error("Character ID must be unique.");
  }
  if (project.characters.some(item => item.name.trim().toLocaleLowerCase() === character.name.toLocaleLowerCase())) {
    throw new Error("A character with this name already exists.");
  }
  return { ...project, characters: [...project.characters, character] };
}

export function reassignAndRemoveCharacter(project: StoryV2, id: string, replacementId = "narrator"): StoryV2 {
  if (id === "narrator") throw new Error("The narrator cannot be removed.");
  if (id === replacementId) throw new Error("Cannot reassign a character to itself.");
  if (project.characters.filter(char => char.id === replacementId).length !== 1) {
    throw new Error("Replacement character must exist exactly once.");
  }
  if (project.characters.filter(char => char.id === id).length !== 1) {
    throw new Error("Character to remove must exist exactly once.");
  }
  const characters = project.characters.filter(char => char.id !== id);
  const scenes = project.scenes.map(scene => ({
    ...scene,
    segments: scene.segments.map(seg => seg.speaker_id === id
      ? { ...seg, speaker_id: replacementId, audio_ref: null, status: "pending", duration_seconds: null }
      : seg),
  }));
  return { ...project, characters, scenes };
}

export function assignSegment(project: StoryV2, segmentId: string, speakerId: string): StoryV2 {
  const speakers = project.characters.filter(item => item.id === speakerId);
  if (speakers.length === 0) throw new Error("Unknown speaker.");
  if (speakers.length !== 1) throw new Error("Speaker must exist exactly once.");
  const matches = project.scenes.flatMap(scene => scene.segments)
    .filter(segment => segment.id === segmentId);
  if (matches.length !== 1 || matches[0].kind !== "speech") {
    throw new Error("Speech segment must exist exactly once.");
  }
  if (matches[0].speaker_id === speakerId && matches[0].source_label === null) return project;
  const scenes = project.scenes.map(scene => ({
    ...scene,
    segments: scene.segments.map(segment => segment.id !== segmentId ? segment : {
      ...segment, speaker_id: speakerId, source_label: null,
      status: "pending", audio_ref: null, duration_seconds: null,
    }),
  }));
  return { ...project, scenes };
}

export function moveScene(project: StoryV2, sceneId: string, offset: -1 | 1): StoryV2 {
  const matching = project.scenes.filter(scene => scene.id === sceneId);
  if (matching.length !== 1) throw new Error("Scene to reorder must exist exactly once.");
  const index = project.scenes.findIndex(scene => scene.id === sceneId);
  if (index + offset < 0 || index + offset >= project.scenes.length) return project;
  const scenes = [...project.scenes];
  [scenes[index], scenes[index + offset]] = [scenes[index + offset], scenes[index]];
  return { ...project, scenes };
}

export function renameScene(project: StoryV2, sceneId: string, title: string): StoryV2 {
  if (!title.trim() || title.length > 120) throw new Error("Scene title must contain 1–120 characters.");
  const matches = project.scenes.filter(scene => scene.id === sceneId);
  if (matches.length !== 1) throw new Error("Scene to rename must exist exactly once.");
  const clean = title.trim();
  if (matches[0].title === clean) return project;
  return { ...project, scenes: project.scenes.map(scene =>
    scene.id === sceneId ? { ...scene, title: clean } : scene) };
}

export function addScene(project: StoryV2, title: string, id: string = crypto.randomUUID()): StoryV2 {
  if (!title.trim() || title.length > 120) throw new Error("Scene title must contain 1–120 characters.");
  if (project.scenes.length >= 200) throw new Error("Maximum 200 scenes.");
  if (project.scenes.some(scene => scene.id === id)) throw new Error("Duplicate scene identifier.");
  return { ...project, scenes: [...project.scenes, {
    id, title: title.trim(), notes: "", segments: [],
  }] };
}

/** Scene production notes are editorial context and never alter spoken dialogue. */
export function updateSceneNotes(project: StoryV2, sceneId: string, notes: string): StoryV2 {
  if (notes.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(notes)) {
    throw new Error("Scene production notes must be 4000 characters or fewer, without control characters.");
  }
  const matches = project.scenes.filter(scene => scene.id === sceneId);
  if (matches.length !== 1) throw new Error("Scene to edit must exist exactly once.");
  if (matches[0].notes === notes) return project;
  return {
    ...project,
    scenes: project.scenes.map(scene => scene.id === sceneId ? { ...scene, notes } : scene),
  };
}

/** Remove a reviewed scene only after the caller confirms. Never delete the source script. */
export function removeScene(project: StoryV2, sceneId: string): StoryV2 {
  if (project.scenes.filter(scene => scene.id === sceneId).length !== 1) {
    throw new Error("Scene to remove must exist exactly once.");
  }
  return { ...project, scenes: project.scenes.filter(scene => scene.id !== sceneId) };
}

/** Duplicate a scene as a fresh, unsynthesized narrative branch.
 * The original Hindi source/review and speaker mapping are preserved, while
 * every copied segment gets a new identity and loses stale audio metadata.
 * The optional ID factory allows deterministic no-model regression tests.
 */
export function duplicateScene(
  project: StoryV2, sceneId: string,
  makeId: () => string = () => crypto.randomUUID(),
): StoryV2 {
  const index = project.scenes.findIndex(scene => scene.id === sceneId);
  if (index < 0) throw new Error("Scene to duplicate was not found.");
  if (project.scenes.filter(scene => scene.id === sceneId).length !== 1) {
    throw new Error("Scene identifiers must be unique.");
  }
  if (project.scenes.length >= 200) throw new Error("Maximum 200 scenes.");
  const source = project.scenes[index];
  // The current renderer and SRT pipeline support a maximum of 256 dialogue cues.
  const spoken = project.scenes.reduce((total, scene) =>
    total + scene.segments.filter(segment => segment.kind === "speech").length, 0);
  const additional = source.segments.filter(segment => segment.kind === "speech").length;
  if (spoken + additional > 256) {
    throw new Error("Duplicating this scene would exceed 256 spoken lines.");
  }
  const usedIds = new Set([
    project.id,
    ...project.scenes.map(scene => scene.id),
    ...project.scenes.flatMap(scene => scene.segments.map(segment => segment.id)),
  ]);
  const uniqueId = (): string => {
    const id = makeId();
    if (!id || id.length > 80 || id.trim() !== id ||
        /[\u0000-\u001f\u007f]/u.test(id) || usedIds.has(id)) {
      throw new Error("Generated duplicate scene/line identity or invalid identifier.");
    }
    usedIds.add(id);
    return id;
  };
  const copiedSceneId = uniqueId();
  let number = 1;
  const labels = new Set(project.scenes.map(scene => scene.title.toLocaleLowerCase()));
  let title = "";
  do {
    const suffix = number === 1 ? " (copy)" : ` (copy ${number})`;
    const stemLimit = 120 - suffix.length;
    let stem = "";
    for (const char of source.title) {
      if (stem.length + char.length > stemLimit) break;
      stem += char;
    }
    title = stem.trimEnd() + suffix;
    number += 1;
  } while (labels.has(title.toLocaleLowerCase()));
  const duplicated: SceneV2 = {
    ...source, id: copiedSceneId, title,
    segments: source.segments.map(segment => ({
      ...segment, id: uniqueId(), status: "pending",
      audio_ref: null, duration_seconds: null,
    })),
  };
  const scenes = [...project.scenes];
  scenes.splice(index + 1, 0, duplicated);
  return { ...project, scenes };
}

/**
 * Split an edited scene immediately before one of its later lines.
 *
 * The two scenes retain their exact segment objects in original order. In
 * particular, their reviewed Hindi, actor mapping and audio references do
 * not change; only the scene boundary changes. The original source script,
 * glossary and characters remain untouched. Save remains explicit.
 */
export function splitSceneAtSegment(
  project: StoryV2, sceneId: string, segmentId: string,
  newSceneId: string = crypto.randomUUID(),
): StoryV2 {
  const matching = project.scenes.filter(scene => scene.id === sceneId);
  if (matching.length !== 1) throw new Error("Scene to split must exist exactly once.");
  if (project.scenes.length >= 200) throw new Error("Maximum 200 scenes.");
  const source = matching[0];
  const targetLines = source.segments.filter(segment => segment.id === segmentId);
  const allMatchingLines = project.scenes.reduce((count, scene) =>
    count + scene.segments.filter(segment => segment.id === segmentId).length, 0);
  if (targetLines.length !== 1 || allMatchingLines !== 1) {
    throw new Error("Split line must exist exactly once in the selected scene.");
  }
  const splitAt = source.segments.findIndex(segment => segment.id === segmentId);
  if (splitAt <= 0) throw new Error("Split must leave at least one line in each scene.");
  const usedIds = new Set([
    project.id,
    ...project.characters.map(character => character.id),
    ...project.scenes.map(scene => scene.id),
    ...project.scenes.flatMap(scene => scene.segments.map(segment => segment.id)),
  ]);
  if (!newSceneId || newSceneId.length > 80 || newSceneId.trim() !== newSceneId ||
      /[\u0000-\u001f\u007f]/u.test(newSceneId) || usedIds.has(newSceneId)) {
    throw new Error("New scene identity must be unique and valid.");
  }
  const usedTitles = new Set(project.scenes.map(scene => scene.title.toLocaleLowerCase()));
  let nextTitle = "";
  for (let number = 2; number <= 202; number++) {
    const suffix = ` (part ${number})`;
    const maxStemLength = 120 - suffix.length;
    let stem = "";
    for (const char of source.title) {
      if (stem.length + char.length > maxStemLength) break;
      stem += char;
    }
    const candidate = stem.trimEnd() + suffix;
    if (!usedTitles.has(candidate.toLocaleLowerCase())) {
      nextTitle = candidate;
      break;
    }
  }
  if (!nextTitle) throw new Error("No available split-scene title.");
  const newScene: SceneV2 = {
    id: newSceneId,
    title: nextTitle,
    notes: "",
    segments: source.segments.slice(splitAt),
  };
  const scenes = [...project.scenes];
  const position = project.scenes.indexOf(source);
  scenes.splice(position, 1, {
    ...source, segments: source.segments.slice(0, splitAt),
  }, newScene);
  return { ...project, scenes };
}

export function moveSegment(project: StoryV2, segmentId: string, destinationSceneId: string): StoryV2 {
  const destinations = project.scenes.filter(scene => scene.id === destinationSceneId);
  if (destinations.length === 0) throw new Error("Destination scene does not exist.");
  if (destinations.length !== 1) throw new Error("Destination scene identifier must be unique.");
  const matching = project.scenes.flatMap(scene => scene.segments)
    .filter(segment => segment.id === segmentId);
  if (matching.length !== 1) throw new Error("Dialogue segment must be unique.");
  const originalScenes = project.scenes.filter(scene =>
    scene.segments.some(segment => segment.id === segmentId));
  if (originalScenes.length !== 1 ||
      project.scenes.filter(scene => scene.id === originalScenes[0].id).length !== 1) {
    throw new Error("Source scene identifier must be unique.");
  }
  if (originalScenes[0].id === destinationSceneId) return project;
  const segment = matching[0];
  const scenes = project.scenes.map(scene =>
    scene.id === originalScenes[0].id
      ? { ...scene, segments: scene.segments.filter(entry => entry.id !== segmentId) }
      : scene.id === destinationSceneId
        ? { ...scene, segments: [...scene.segments, segment] }
        : scene,
  );
  return { ...project, scenes };
}

export function moveSegmentWithinScene(
  project: StoryV2, segmentId: string, offset: -1 | 1,
): StoryV2 {
  const matchingScenes = project.scenes.filter(scene =>
    scene.segments.some(segment => segment.id === segmentId));
  const matchCount = project.scenes.reduce((count, scene) =>
    count + scene.segments.filter(segment => segment.id === segmentId).length, 0);
  if (matchCount !== 1 || matchingScenes.length !== 1) {
    throw new Error("Dialogue segment must exist exactly once.");
  }
  const scene = matchingScenes[0];
  if (project.scenes.filter(item => item.id === scene.id).length !== 1) {
    throw new Error("Scene identifiers must be unique.");
  }
  const index = scene.segments.findIndex(segment => segment.id === segmentId);
  const next = index + offset;
  if (next < 0 || next >= scene.segments.length) return project;
  const reordered = [...scene.segments];
  [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
  return {
    ...project,
    scenes: project.scenes.map(item => item.id === scene.id
      ? { ...item, segments: reordered } : item),
  };
}

/** Copy editable voice settings, not a verified voice identity or conditioning. */
export function duplicateCharacter(project: StoryV2, id: string, newId: string = crypto.randomUUID()): StoryV2 {
  if (project.characters.length >= 100) throw new Error("Maximum 100 characters.");
  const sources = project.characters.filter(item => item.id === id);
  if (sources.length !== 1) throw new Error("Original character must exist exactly once.");
  if (!newId || newId.length > 80 || newId.trim() !== newId ||
      /[\u0000-\u001f\u007f]/u.test(newId) ||
      project.characters.some(item => item.id === newId)) {
    throw new Error("New character ID must be unique and valid.");
  }
  const source = sources[0];
  const usedNames = new Set(project.characters.map(item => item.name.toLocaleLowerCase()));
  for (let suffix = 1; suffix <= 100; suffix++) {
    const tail = suffix === 1 ? " copy" : ` copy ${suffix}`;
    // Avoid splitting surrogate pairs when truncating a long Unicode name.
    const stemLimit = 120 - tail.length;
    let stem = "";
    for (const unit of source.name) {
      if (stem.length + unit.length > stemLimit) break;
      stem += unit;
    }
    const name = stem.trimEnd() + tail;
    if (usedNames.has(name.toLocaleLowerCase())) continue;
    const clone: CharacterV2 = {
      ...source, id: newId, name, voice: { ...source.voice },
    };
    return { ...project, characters: [...project.characters, clone] };
  }
  throw new Error("No available unique copy name.");
}

export function renameCharacter(project: StoryV2, id: string, name: string): StoryV2 {
  if (id === "narrator") throw new Error("The narrator's identity is fixed.");
  if (!name.trim() || name.length > 120) throw new Error("Character name must contain 1–120 characters.");
  const matches = project.characters.filter(item => item.id === id);
  if (matches.length !== 1) throw new Error("Character to rename must exist exactly once.");
  const clean = name.trim();
  if (project.characters.some(item => item.id !== id &&
      item.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) {
    throw new Error("Character names must be unique.");
  }
  if (matches[0].name === clean) return project;
  return { ...project, characters: project.characters.map(item =>
    item.id === id ? { ...item, name: clean } : item) };
}

export function unresolvedSpeech(project: StoryV2): SegmentV2[] {
  return project.scenes.flatMap(scene => scene.segments)
    .filter(seg => seg.kind === "speech" && seg.speaker_id === null);
}

/** Changes only the reviewed speech, never the untouched source script. */
/** Changes only the reviewed speech, never the untouched source script. */
export function reviewSpokenText(project: StoryV2, segmentId: string, spokenText: string): StoryV2 {
  if (!spokenText.trim() || spokenText.length > 100_000 || spokenText.includes("\u0000")) {
    throw new Error("Reviewed speech must contain 1–100000 valid characters.");
  }
  const matches = project.scenes.flatMap(scene => scene.segments)
    .filter(segment => segment.id === segmentId);
  if (matches.length === 0) throw new Error("Spoken segment was not found.");
  if (matches.length !== 1 || matches[0].kind !== "speech") {
    throw new Error("Spoken segment must exist exactly once.");
  }
  if (matches[0].spoken_text === spokenText) return project;
  const scenes = project.scenes.map(scene => ({
    ...scene,
    segments: scene.segments.map(seg => seg.id !== segmentId ? seg : {
      ...seg, spoken_text: spokenText, status: "stale", audio_ref: null, duration_seconds: null,
    }),
  }));
  return { ...project, scenes };
}

export function setGlossary(project: StoryV2, rules: PronunciationRuleV2[]): StoryV2 {
  if (rules.length > 100) throw new Error("Maximum 100 pronunciation rules.");
  const ids = new Set<string>();
  const sources = new Set<string>();
  for (const rule of rules) {
    const original = rule.original.trim().normalize("NFC");
    const spoken = rule.spoken.trim().normalize("NFC");
    if (!rule.id || rule.id.length > 80 || !original || original.length > 80 ||
        !spoken || spoken.length > 160 || original === spoken ||
        /[\u0000-\u001f\u007f]/.test(rule.id + original + spoken) ||
        ids.has(rule.id) || sources.has(original.toLocaleLowerCase())) {
      throw new Error("Pronunciation rules need unique, nonempty terms and valid lengths.");
    }
    ids.add(rule.id);
    sources.add(original.toLocaleLowerCase());
  }
  // The combined preview is stale, but the Python content-addressed audio cache
  // will still reuse segments whose *effective* speech has not changed.
  return { ...project, pronunciation_glossary: rules };
}
