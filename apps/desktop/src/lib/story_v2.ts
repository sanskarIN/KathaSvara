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
export interface StoryV2 {
  schema_version: 2;
  id: string;
  title: string;
  text: string;
  characters: CharacterV2[];
  scenes: SceneV2[];
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

export function makeCharacter(name: string, id = crypto.randomUUID()): CharacterV2 {
  if (!name.trim() || name.trim().length > 120) {
    throw new Error("Character name must be 1–120 characters.");
  }
  return { id, name: name.trim(), voice: defaultVoice(), description: "" };
}

export function legacyToStoryV2(project: StoryProject, id = crypto.randomUUID()): StoryV2 {
  return {
    schema_version: 2,
    id: project.id || id,
    title: project.title,
    text: project.text,
    characters: [makeCharacter("Narrator", "narrator")],
    scenes: [],
  };
}

export function addCharacter(project: StoryV2, name: string, id?: string): StoryV2 {
  if (project.characters.length >= 100) throw new Error("Maximum 100 characters.");
  const character = makeCharacter(name, id);
  if (project.characters.some(item => item.name.trim().toLocaleLowerCase() === character.name.toLocaleLowerCase())) {
    throw new Error("A character with this name already exists.");
  }
  return { ...project, characters: [...project.characters, character] };
}

export function reassignAndRemoveCharacter(project: StoryV2, id: string, replacementId = "narrator"): StoryV2 {
  if (id === "narrator") throw new Error("The narrator cannot be removed.");
  if (id === replacementId) throw new Error("Cannot reassign a character to itself.");
  if (!project.characters.some(char => char.id === replacementId)) throw new Error("Replacement character is missing.");
  const characters = project.characters.filter(char => char.id !== id);
  if (characters.length === project.characters.length) throw new Error("Character not found.");
  const scenes = project.scenes.map(scene => ({
    ...scene,
    segments: scene.segments.map(seg => seg.speaker_id === id
      ? { ...seg, speaker_id: replacementId, audio_ref: null, status: "pending", duration_seconds: null }
      : seg),
  }));
  return { ...project, characters, scenes };
}

export function assignSegment(project: StoryV2, segmentId: string, speakerId: string): StoryV2 {
  if (!project.characters.some(item => item.id === speakerId)) throw new Error("Unknown speaker.");
  let updated = false;
  const scenes = project.scenes.map(scene => ({
    ...scene,
    segments: scene.segments.map(segment => {
      if (segment.id !== segmentId || segment.kind !== "speech") return segment;
      updated = true;
      return {
        ...segment, speaker_id: speakerId, source_label: null,
        status: "pending", audio_ref: null, duration_seconds: null,
      };
    }),
  }));
  if (!updated) throw new Error("Speech segment was not found.");
  return { ...project, scenes };
}

export function moveScene(project: StoryV2, sceneId: string, offset: -1 | 1): StoryV2 {
  const index = project.scenes.findIndex(scene => scene.id === sceneId);
  if (index < 0 || index + offset < 0 || index + offset >= project.scenes.length) return project;
  const scenes = [...project.scenes];
  [scenes[index], scenes[index + offset]] = [scenes[index + offset], scenes[index]];
  return { ...project, scenes };
}

export function renameScene(project: StoryV2, sceneId: string, title: string): StoryV2 {
  if (!title.trim() || title.length > 120) throw new Error("Scene title must contain 1–120 characters.");
  return { ...project, scenes: project.scenes.map(scene =>
    scene.id === sceneId ? { ...scene, title: title.trim() } : scene) };
}

export function unresolvedSpeech(project: StoryV2): SegmentV2[] {
  return project.scenes.flatMap(scene => scene.segments)
    .filter(seg => seg.kind === "speech" && seg.speaker_id === null);
}
