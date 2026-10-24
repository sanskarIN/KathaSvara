import { describe, expect, it } from "vitest";
import {
  addCharacter, addScene, assignSegment, defaultVoice, duplicateCharacter, duplicateScene, legacyToStoryV2,
  makeCharacter, mergeSceneWithNext, moveScene, moveSegment, moveSegmentWithinScene, splitSceneAtSegment, removeScene, reviewSpokenText, setGlossary, reassignAndRemoveCharacter, renameCharacter, renameScene, unresolvedSpeech, updateSceneNotes,
  type StoryV2,
} from "./story_v2";

function fixture(): StoryV2 {
  const root = legacyToStoryV2({ id: "old-id", title: "राजा भोज", text: "नमस्कार" });
  const char = makeCharacter("राजा भोज", "raja");
  return {
    ...root,
    characters: [...root.characters, char],
    scenes: [
      {
        id: "s1", title: "दरबार", notes: "",
        segments: [{
          id: "seg1", original_text: "नमस्कार", spoken_text: "नमस्कार",
          kind: "speech", speaker_id: "raja", status: "completed",
          source_label: null, audio_ref: "cached-audio", duration_seconds: 1.2,
        }],
      },
      { id: "s2", title: "रास्ता", notes: "", segments: [] },
    ],
  };
}
describe("v2 story authoring", () => {
  it("migrates legacy fields without removing or changing text", () => {
    const input = { id: "old-id", title: "कहानी", text: "मूल कहानी" };
    const v2 = legacyToStoryV2(input);
    expect(v2.schema_version).toBe(2);
    expect(v2.text).toBe(input.text);
    expect(v2.id).toBe("old-id");
    expect(v2.characters[0].id).toBe("narrator");
    expect(input).toEqual({ id: "old-id", title: "कहानी", text: "मूल कहानी" });
  });

  it("does not fabricate conditioning or unsupported voice settings", () => {
    expect(defaultVoice().speaker_conditioning).toBeNull();
    expect(defaultVoice().language).toBe("hi");
  });

  it("rejects duplicate character names and protected narrator deletion", () => {
    const doc = fixture();
    expect(() => addCharacter(doc, "राजा भोज")).toThrow("already exists");
    expect(() => reassignAndRemoveCharacter(doc, "narrator")).toThrow("cannot be removed");
  });

  it("reassigns dialogue safely and clears stale cached audio", () => {
    const result = reassignAndRemoveCharacter(fixture(), "raja");
    const segment = result.scenes[0].segments[0];
    expect(segment.speaker_id).toBe("narrator");
    expect(segment.audio_ref).toBeNull();
    expect(segment.duration_seconds).toBeNull();
    expect(segment.status).toBe("pending");
    expect(result.characters).toHaveLength(1);
  });

  it("corrects an unresolved speaker without changing original text", () => {
    const doc = fixture();
    doc.scenes[0].segments[0].speaker_id = null;
    doc.scenes[0].segments[0].source_label = "अज्ञात";
    expect(unresolvedSpeech(doc)).toHaveLength(1);
    const fixed = assignSegment(doc, "seg1", "narrator");
    expect(fixed.scenes[0].segments[0].original_text).toBe("नमस्कार");
    expect(unresolvedSpeech(fixed)).toHaveLength(0);
  });

  it("orders scenes without modifying segment IDs and renames a scene", () => {
    const moved = moveScene(fixture(), "s2", -1);
    expect(moved.scenes.map(s => s.id)).toEqual(["s2", "s1"]);
    expect(moved.scenes[1].segments[0].id).toBe("seg1");
    expect(renameScene(moved, "s1", "नया दरबार").scenes[1].title).toBe("नया दरबार");
  });
});

describe("extended cast and scene editing", () => {
  it("duplicates a voice profile without reusing the character identity", () => {
    const doc = fixture();
    const result = duplicateCharacter(doc, "raja", "clone-id");
    expect(result.characters[2].id).toBe("clone-id");
    expect(result.characters[2].name).toBe("राजा भोज copy");
    expect(result.characters[2].voice).toEqual(result.characters[1].voice);
    expect(result.characters[2].voice).not.toBe(result.characters[1].voice);
  });
  it("rejects duplicate or unsafe character IDs instead of making an unsaveable project", () => {
    const doc = fixture();
    expect(() => addCharacter(doc, "नया पात्र", "raja")).toThrow("ID must be unique");
    expect(() => duplicateCharacter(doc, "raja", "narrator")).toThrow("ID must be unique");
    expect(() => duplicateCharacter(doc, "raja", "")).toThrow("ID must be unique");
    expect(() => duplicateCharacter(doc, "raja", " bad ")).toThrow("ID must be unique");
    expect(() => duplicateCharacter(doc, "raja", "x".repeat(81))).toThrow("ID must be unique");
    expect(() => duplicateCharacter(doc, "raja", "bad\u0000id")).toThrow("ID must be unique");
    const corrupt = { ...doc, characters: [...doc.characters, { ...doc.characters[1] }] };
    expect(() => duplicateCharacter(corrupt, "raja", "new-id")).toThrow("exactly once");
    expect(doc.characters).toHaveLength(2);
  });
  it("never duplicates beyond the native 100-character project limit", () => {
    const doc = fixture();
    const full = { ...doc, characters: [
      ...doc.characters,
      ...Array.from({ length: 98 }, (_, i) => ({
        ...doc.characters[1], id: `cast-${i}`, name: `पात्र ${i}`,
      })),
    ] };
    expect(full.characters).toHaveLength(100);
    expect(() => duplicateCharacter(full, "raja", "new-character")).toThrow("Maximum 100");
    expect(() => addCharacter(full, "और पात्र", "new-character")).toThrow("Maximum 100");
    expect(full.characters).toHaveLength(100);
  });
  it("does not split emoji surrogate pairs when shortening copied names", () => {
    const doc = fixture();
    doc.characters[1].name = "😀".repeat(60);
    const copied = duplicateCharacter(doc, "raja", "emoji-copy");
    const name = copied.characters[2].name;
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name).toMatch(/ copy$/);
    expect(name).not.toContain("\uFFFD");
    expect(Array.from(name).every(unit => !(unit.length === 1 &&
      unit.charCodeAt(0) >= 0xD800 && unit.charCodeAt(0) <= 0xDFFF))).toBe(true);
  });
  it("truncates long Hindi copy names safely and resolves name conflicts", () => {
    const doc = fixture();
    doc.characters[1].name = "क".repeat(120);
    const first = duplicateCharacter(doc, "raja", "copy-long-1");
    expect(first.characters[2].name.length).toBeLessThanOrEqual(120);
    expect(first.characters[2].name).toMatch(/ copy$/);
    expect(first.characters[2].voice).toEqual(doc.characters[1].voice);
    expect(first.characters[2].voice).not.toBe(doc.characters[1].voice);
    const second = duplicateCharacter(first, "raja", "copy-long-2");
    expect(second.characters[3].name).toMatch(/ copy 2$/);
    expect(second.characters[3].name.length).toBeLessThanOrEqual(120);
    expect(new Set(second.characters.map(char => char.name)).size).toBe(4);
    expect(doc.characters).toHaveLength(2);
  });
  it("adds a scene and moves a line without dropping original text", () => {
    const doc = addScene(fixture(), "नया दृश्य", "newscene");
    const moved = moveSegment(doc, "seg1", "newscene");
    expect(moved.scenes[0].segments).toHaveLength(0);
    expect(moved.scenes[2].segments[0].original_text).toBe("नमस्कार");
    expect(() => moveSegment(doc, "seg1", "not-there")).toThrow("does not exist");
  });
  it("does not move dialogue into two scenes sharing an ambiguous destination ID", () => {
    const doc = fixture();
    const corrupt = { ...doc, scenes: [
      ...doc.scenes, { ...doc.scenes[1], segments: [] },
    ] };
    expect(() => moveSegment(corrupt, "seg1", "s2")).toThrow("must be unique");
    expect(doc.scenes[0].segments.map(seg => seg.id)).toEqual(["seg1"]);
  });
  it("rejects ambiguous original scene IDs when reordering a line", () => {
    const doc = fixture();
    doc.scenes[0].segments.push({
      ...doc.scenes[0].segments[0], id: "seg2", original_text: "दूसरी पंक्ति",
    });
    const corrupt = { ...doc, scenes: [
      ...doc.scenes, { ...doc.scenes[0], segments: [] },
    ] };
    expect(() => moveSegmentWithinScene(corrupt, "seg1", 1)).toThrow("must be unique");
    expect(doc.scenes[0].segments.map(seg => seg.id)).toEqual(["seg1", "seg2"]);
  });
  it("rejects duplicate names on renaming", () => {
    const doc = fixture();
    expect(() => renameCharacter(doc, "raja", "Narrator")).toThrow("unique");
    expect(renameCharacter(doc, "raja", "राजा नया").characters[1].name).toBe("राजा नया");
  });
});

describe("v0.5.3 identity-safe edits of older cast and scene operations", () => {
  it("refuses missing or ambiguous scene IDs when reordering or renaming", () => {
    const doc = fixture();
    expect(moveScene(doc, "s1", -1)).toBe(doc);
    expect(moveScene(doc, "s2", 1)).toBe(doc);
    expect(() => moveScene(doc, "missing", 1)).toThrow("exactly once");
    expect(() => renameScene(doc, "missing", "शीर्षक")).toThrow("exactly once");
    expect(renameScene(doc, "s1", "दरबार")).toBe(doc);
    const corrupt: StoryV2 = { ...doc, scenes: [...doc.scenes, { ...doc.scenes[0] }] };
    expect(() => moveScene(corrupt, "s1", 1)).toThrow("exactly once");
    expect(() => renameScene(corrupt, "s1", "नया दरबार")).toThrow("exactly once");
    expect(doc.scenes[0].title).toBe("दरबार");
  });

  it("does not silently remove several characters sharing one identity", () => {
    const doc = fixture();
    expect(() => reassignAndRemoveCharacter(doc, "unknown")).toThrow("exactly once");
    const duplicate: StoryV2 = { ...doc, characters: [
      ...doc.characters, { ...doc.characters[1] },
    ] };
    expect(() => reassignAndRemoveCharacter(duplicate, "raja")).toThrow("exactly once");
    const duplicateNarrator: StoryV2 = { ...doc, characters: [
      ...doc.characters, { ...doc.characters[0] },
    ] };
    expect(() => reassignAndRemoveCharacter(duplicateNarrator, "raja")).toThrow("exactly once");
    expect(doc.characters).toHaveLength(2);
    expect(doc.scenes[0].segments[0].audio_ref).toBe("cached-audio");
  });

  it("does not reassign an unchanged speaker or overwrite two equal line IDs", () => {
    const doc = fixture();
    const first = doc.scenes[0].segments[0];
    expect(assignSegment(doc, "seg1", "raja")).toBe(doc);
    expect(first.audio_ref).toBe("cached-audio");
    expect(() => assignSegment(doc, "missing", "raja")).toThrow("exactly once");
    expect(() => assignSegment(doc, "seg1", "unknown")).toThrow("Unknown speaker");
    const duplicateLine: StoryV2 = { ...doc, scenes: [
      doc.scenes[0], { ...doc.scenes[1], segments: [{ ...first }] },
    ] };
    expect(() => assignSegment(duplicateLine, "seg1", "narrator")).toThrow("exactly once");
    const duplicateSpeaker: StoryV2 = { ...doc, characters: [
      ...doc.characters, { ...doc.characters[1] },
    ] };
    expect(() => assignSegment(duplicateSpeaker, "seg1", "raja")).toThrow("exactly once");
    const direction: StoryV2 = { ...doc, scenes: [{
      ...doc.scenes[0], segments: [{ ...first, kind: "direction", speaker_id: null }],
    }, doc.scenes[1]] };
    expect(() => assignSegment(direction, "seg1", "narrator")).toThrow("exactly once");
  });

  it("retains reviewed speech/audio metadata for no-op text edits and refuses duplicate lines", () => {
    const doc = fixture();
    const first = doc.scenes[0].segments[0];
    expect(reviewSpokenText(doc, "seg1", "नमस्कार")).toBe(doc);
    expect(first.status).toBe("completed");
    expect(first.audio_ref).toBe("cached-audio");
    const duplicate: StoryV2 = { ...doc, scenes: [
      doc.scenes[0], { ...doc.scenes[1], segments: [{ ...first }] },
    ] };
    expect(() => reviewSpokenText(duplicate, "seg1", "नया पाठ"))
      .toThrow("exactly once");
    const direction: StoryV2 = { ...doc, scenes: [{
      ...doc.scenes[0], segments: [{ ...first, kind: "direction" }],
    }, doc.scenes[1]] };
    expect(() => reviewSpokenText(direction, "seg1", "नया पाठ")).toThrow("exactly once");
    expect(doc.scenes[0].segments[0].spoken_text).toBe("नमस्कार");
  });

  it("keeps a same-scene line move inert and rejects ambiguous source scene identity", () => {
    const doc = fixture();
    expect(moveSegment(doc, "seg1", "s1")).toBe(doc);
    expect(doc.scenes[0].segments[0].id).toBe("seg1");
    const corrupt: StoryV2 = { ...doc, scenes: [
      ...doc.scenes, { ...doc.scenes[0], segments: [] },
    ] };
    expect(() => moveSegment(corrupt, "seg1", "s2")).toThrow("Source scene identifier");
    const moved = moveSegment(doc, "seg1", "s2");
    expect(moved.scenes[1].segments[0]).toBe(doc.scenes[0].segments[0]);
    expect(moved.scenes[0].segments).toHaveLength(0);
    expect(doc.scenes[0].segments).toHaveLength(1);
  });

  it("rejects missing and repeated character IDs on rename, leaving source untouched", () => {
    const doc = fixture();
    expect(() => renameCharacter(doc, "missing", "नया नाम")).toThrow("exactly once");
    expect(renameCharacter(doc, "raja", "राजा भोज")).toBe(doc);
    const corrupt: StoryV2 = { ...doc, characters: [
      ...doc.characters, { ...doc.characters[1] },
    ] };
    expect(() => renameCharacter(corrupt, "raja", "नया नाम")).toThrow("exactly once");
    expect(doc.characters[1].name).toBe("राजा भोज");
  });
});

describe("v0.2.1 non-destructive pronunciation authoring", () => {
  it("edits only reviewed speech and invalidates stale segment metadata", () => {
    const doc = fixture();
    const result = reviewSpokenText(doc, "seg1", "नमस्कार जी");
    const segment = result.scenes[0].segments[0];
    expect(segment.original_text).toBe("नमस्कार");
    expect(segment.spoken_text).toBe("नमस्कार जी");
    expect(segment.audio_ref).toBeNull();
    expect(segment.duration_seconds).toBeNull();
    expect(segment.status).toBe("stale");
    expect(doc.scenes[0].segments[0].spoken_text).toBe("नमस्कार");
    expect(() => reviewSpokenText(doc, "seg1", " ")).toThrow("1–100000");
    expect(() => reviewSpokenText(doc, "unknown", "hello")).toThrow("not found");
  });
  it("persists optional glossary and rejects duplicated original phrases", () => {
    const doc = fixture();
    const rules = [{ id: "a", original: "राजा भोज", spoken: "रजा भोज", enabled: true }];
    const changed = setGlossary(doc, rules);
    expect(changed.pronunciation_glossary).toEqual(rules);
    expect(changed.text).toBe(doc.text);
    expect(doc.pronunciation_glossary).toEqual([]);
    expect(() => setGlossary(doc, [...rules, { ...rules[0], id: "b" }])).toThrow("unique");
    expect(() => setGlossary(doc, [{ ...rules[0], spoken: "" }])).toThrow("unique");
  });
});


describe("v0.5.3 in-scene narration ordering", () => {
  function orderedFixture(): StoryV2 {
    const doc = fixture();
    const first = doc.scenes[0].segments[0];
    return {
      ...doc, scenes: [{
        ...doc.scenes[0], segments: [
          first,
          { ...first, id: "direction-1", kind: "direction", original_text: "[चुप्पी]",
            spoken_text: "", speaker_id: null, audio_ref: null, duration_seconds: null },
          { ...first, id: "line-2", original_text: "दूसरा संवाद", spoken_text: "दूसरा संवाद" },
        ],
      }, doc.scenes[1]],
    };
  }
  it("moves a spoken line across a stage direction without changing the script or speaker data", () => {
    const doc = orderedFixture();
    const result = moveSegmentWithinScene(doc, "line-2", -1);
    expect(result.scenes[0].segments.map(x => x.id)).toEqual(["seg1", "line-2", "direction-1"]);
    expect(result.scenes[0].segments[1]).toEqual(doc.scenes[0].segments[2]);
    expect(result.scenes[0].segments[1]).not.toBe(doc.scenes[0].segments[1]);
    expect(doc.scenes[0].segments.map(x => x.id)).toEqual(["seg1", "direction-1", "line-2"]);
    expect(result.text).toBe(doc.text);
    expect(result.scenes[1]).toBe(doc.scenes[1]);
  });
  it("moves stage directions while keeping saved speech identity and cache metadata", () => {
    const doc = orderedFixture();
    const reordered = moveSegmentWithinScene(doc, "direction-1", -1);
    expect(reordered.scenes[0].segments.map(x => x.id)).toEqual(["direction-1", "seg1", "line-2"]);
    expect(reordered.scenes[0].segments[1].audio_ref).toBe("cached-audio");
    expect(reordered.scenes[0].segments[1].speaker_id).toBe("raja");
    expect(reordered.scenes[0].segments[1].duration_seconds).toBe(1.2);
  });
  it("keeps identity and avoids unnecessary edits at scene boundaries", () => {
    const doc = orderedFixture();
    expect(moveSegmentWithinScene(doc, "seg1", -1)).toBe(doc);
    expect(moveSegmentWithinScene(doc, "line-2", 1)).toBe(doc);
  });
  it("fails closed on missing or duplicate segment identifiers across scenes", () => {
    const doc = orderedFixture();
    expect(() => moveSegmentWithinScene(doc, "unknown", 1)).toThrow("exactly once");
    const duplicate: StoryV2 = { ...doc, scenes: [
      doc.scenes[0], { ...doc.scenes[1], segments: [{ ...doc.scenes[0].segments[0] }] },
    ] };
    expect(() => moveSegmentWithinScene(duplicate, "seg1", 1)).toThrow("exactly once");
  });
});



describe("v0.5.3 non-destructive split-scene authoring", () => {
  function withThreeLines(): StoryV2 {
    const doc = fixture();
    const original = doc.scenes[0].segments[0];
    doc.scenes[0].notes = "निर्देशक की निजी टिप्पणी";
    doc.scenes[0].segments.push(
      { ...original, id: "stage", kind: "direction", speaker_id: null,
        original_text: "[द्वार खुलता है]", spoken_text: "",
        audio_ref: null, duration_seconds: null },
      { ...original, id: "third", original_text: "फिर मिलेंगे",
        spoken_text: "फिर मिलेंगे", audio_ref: "other-cached-audio" },
    );
    return doc;
  }
  it("splits a story at a stage direction, preserving all source and audio metadata", () => {
    const original = withThreeLines();
    const split = splitSceneAtSegment(original, "s1", "stage", "new-scene");
    expect(split.scenes.map(scene => scene.id)).toEqual(["s1", "new-scene", "s2"]);
    expect(split.scenes.map(scene => scene.title)).toEqual(["दरबार", "दरबार (part 2)", "रास्ता"]);
    expect(split.scenes[0].segments.map(segment => segment.id)).toEqual(["seg1"]);
    expect(split.scenes[1].segments.map(segment => segment.id)).toEqual(["stage", "third"]);
    expect(split.scenes[0].segments[0]).toBe(original.scenes[0].segments[0]);
    expect(split.scenes[1].segments[1]).toBe(original.scenes[0].segments[2]);
    expect(split.scenes[1].segments[1].audio_ref).toBe("other-cached-audio");
    expect(split.scenes[0].notes).toBe("निर्देशक की निजी टिप्पणी");
    expect(split.scenes[1].notes).toBe("");
    expect(split.scenes[2]).toBe(original.scenes[1]);
    expect(split.text).toBe(original.text);
    expect(split.characters).toBe(original.characters);
    expect(split.pronunciation_glossary).toBe(original.pronunciation_glossary);
    expect(original.scenes[0].segments.map(segment => segment.id)).toEqual(["seg1", "stage", "third"]);
    expect(split.scenes.flatMap(scene => scene.segments).map(segment => segment.id))
      .toEqual(original.scenes.flatMap(scene => scene.segments).map(segment => segment.id));
  });
  it("refuses first-line splits and absent, duplicated, or ambiguous source identities", () => {
    const doc = withThreeLines();
    expect(() => splitSceneAtSegment(doc, "s1", "seg1", "new-scene")).toThrow("at least one");
    expect(() => splitSceneAtSegment(doc, "s1", "missing", "new-scene")).toThrow("exactly once");
    expect(() => splitSceneAtSegment(doc, "missing", "stage", "new-scene")).toThrow("exactly once");
    const ambiguous = { ...doc, scenes: [...doc.scenes, {
      ...doc.scenes[0], segments: [],
    }] };
    expect(() => splitSceneAtSegment(ambiguous, "s1", "stage", "new-scene"))
      .toThrow("exactly once");
    const duplicatedLine = { ...doc, scenes: [...doc.scenes, {
      ...doc.scenes[1], segments: [{ ...doc.scenes[0].segments[1] }],
    }] };
    expect(() => splitSceneAtSegment(duplicatedLine, "s1", "stage", "new-scene"))
      .toThrow("exactly once");
  });
  it("rejects duplicate, malformed or overlong generated scene IDs", () => {
    const doc = withThreeLines();
    for (const id of ["s1", "seg1", doc.id, "raja", "", " bad ", "x".repeat(81), "bad\u0000id"]) {
      expect(() => splitSceneAtSegment(doc, "s1", "stage", id)).toThrow("unique and valid");
    }
    expect(doc.scenes).toHaveLength(2);
  });
  it("respects the native scene cap and creates unique bounded unicode titles", () => {
    const doc = withThreeLines();
    doc.scenes[0].title = "😀".repeat(60);
    const first = splitSceneAtSegment(doc, "s1", "stage", "new-scene");
    expect(first.scenes[1].title).toMatch(/ \(part 2\)$/);
    expect(first.scenes[1].title.length).toBeLessThanOrEqual(120);
    const existingTitle = { ...doc, scenes: [...doc.scenes, {
      id: "existing", title: first.scenes[1].title, notes: "", segments: [],
    }] };
    const next = splitSceneAtSegment(existingTitle, "s1", "stage", "unique-scene");
    expect(next.scenes[1].title).toMatch(/ \(part 3\)$/);
    expect(next.scenes[1].title.length).toBeLessThanOrEqual(120);
    const full = { ...doc, scenes: Array.from({ length: 200 }, (_, i) => ({
      id: "scene-" + i, title: "दृश्य " + i, notes: "",
      segments: i === 0 ? doc.scenes[0].segments : [],
    })) };
    expect(() => splitSceneAtSegment(full, "scene-0", "stage", "new")).toThrow("Maximum 200");
  });
});

describe("v0.5.3 safe adjacent-scene merging", () => {
  function mergeFixture(): StoryV2 {
    const doc = fixture();
    const dialogue = doc.scenes[0].segments[0];
    doc.scenes[0].notes = "निर्देशक: पहले दृश्य पर ध्यान दें";
    doc.scenes[1].notes = "दूसरे दृश्य में हल्का संगीत";
    doc.scenes[1].segments = [
      { ...dialogue, id: "direction2", kind: "direction",
        original_text: "[हवा चलती है]", spoken_text: "", speaker_id: null,
        status: "pending", audio_ref: null, duration_seconds: null },
      { ...dialogue, id: "spoken2", spoken_text: "दूसरे दृश्य का संवाद",
        audio_ref: "retained-cache", duration_seconds: 2.3 },
    ];
    return doc;
  }
  it("retains all dialogue line objects, cached voice metadata, title and production notes", () => {
    const doc = mergeFixture();
    const combined = mergeSceneWithNext(doc, "s1");
    expect(combined.scenes).toHaveLength(1);
    expect(combined.scenes[0].id).toBe("s1");
    expect(combined.scenes[0].title).toBe("दरबार");
    expect(combined.scenes[0].segments.map(line => line.id))
      .toEqual(["seg1", "direction2", "spoken2"]);
    expect(combined.scenes[0].segments[0]).toBe(doc.scenes[0].segments[0]);
    expect(combined.scenes[0].segments[1]).toBe(doc.scenes[1].segments[0]);
    expect(combined.scenes[0].segments[2]).toBe(doc.scenes[1].segments[1]);
    expect(combined.scenes[0].segments[2].audio_ref).toBe("retained-cache");
    expect(combined.scenes[0].segments[2].duration_seconds).toBe(2.3);
    expect(combined.scenes[0].notes).toBe(
      "निर्देशक: पहले दृश्य पर ध्यान दें\\n\\nMerged scene: रास्ता\\nदूसरे दृश्य में हल्का संगीत"
    );
    expect(combined.text).toBe(doc.text);
    expect(combined.characters).toBe(doc.characters);
    expect(combined.pronunciation_glossary).toBe(doc.pronunciation_glossary);
    expect(doc.scenes[0].segments.map(line => line.id)).toEqual(["seg1"]);
    expect(doc.scenes[1].segments.map(line => line.id)).toEqual(["direction2", "spoken2"]);
  });
  it("preserves an empty second scene title in nonspoken notes", () => {
    const doc = fixture();
    const combined = mergeSceneWithNext(doc, "s1");
    expect(combined.scenes[0].notes).toBe("Merged scene: रास्ता");
    expect(combined.scenes[0].segments).toEqual(doc.scenes[0].segments);
    expect(doc.scenes[1].title).toBe("रास्ता");
  });
  it("refuses a missing, repeated or final scene source and duplicate next scene ID", () => {
    const doc = mergeFixture();
    expect(() => mergeSceneWithNext(doc, "s2")).toThrow("No next scene");
    expect(() => mergeSceneWithNext(doc, "absent")).toThrow("exactly once");
    const repeated = { ...doc, scenes: [...doc.scenes, { ...doc.scenes[0] }] };
    expect(() => mergeSceneWithNext(repeated, "s1")).toThrow("exactly once");
    const repeatedNext = { ...doc, scenes: [...doc.scenes, { ...doc.scenes[1] }] };
    expect(() => mergeSceneWithNext(repeatedNext, "s1")).toThrow("Next scene identity");
    expect(doc.scenes).toHaveLength(2);
  });
  it("fails closed on duplicate lines anywhere in the original story", () => {
    const doc = mergeFixture();
    doc.scenes[1].segments[1].id = "seg1";
    expect(() => mergeSceneWithNext(doc, "s1")).toThrow("Line identities");
  });
  it("honors the native 2000-segment cap and rejects note overflow", () => {
    const doc = mergeFixture();
    const repeated = doc.scenes[0].segments[0];
    doc.scenes[0].segments = Array.from({ length: 2000 }, (_, i) => ({
      ...repeated, id: "first-" + i,
    }));
    expect(() => mergeSceneWithNext(doc, "s1")).toThrow("more than 2000");
    expect(doc.scenes[0].segments).toHaveLength(2000);
    const notesDoc = mergeFixture();
    notesDoc.scenes[0].notes = "अ".repeat(4000);
    expect(() => mergeSceneWithNext(notesDoc, "s1")).toThrow("4000-character");
    expect(notesDoc.scenes[0].notes.length).toBe(4000);
  });
  it("joins a split story without changing narration IDs or spoken text", () => {
    const doc = mergeFixture();
    const before = doc.scenes.flatMap(scene => scene.segments).map(line => ({
      id: line.id, original: line.original_text, reviewed: line.spoken_text, speaker: line.speaker_id,
    }));
    const joined = mergeSceneWithNext(doc, "s1");
    expect(joined.scenes.flatMap(scene => scene.segments).map(line => ({
      id: line.id, original: line.original_text, reviewed: line.spoken_text, speaker: line.speaker_id,
    }))).toEqual(before);
    expect(joined.scenes[0].segments.every((line, i) => line === doc.scenes.flatMap(s => s.segments)[i])).toBe(true);
  });
});

describe("v0.5.3 safe scene duplication", () => {
  function makeIds(...ids: string[]) {
    let index = 0;
    return () => ids[index++] ?? "no-more-ids";
  }
  it("duplicates immediately after its source with new scene and line identities", () => {
    const doc = fixture();
    const source = doc.scenes[0].segments[0];
    const result = duplicateScene(doc, "s1", makeIds("copied-scene", "copied-seg"));
    expect(result.scenes.map(scene => scene.id)).toEqual(["s1", "copied-scene", "s2"]);
    expect(result.scenes[1].title).toBe("दरबार (copy)");
    expect(result.scenes[1].segments[0]).toEqual({
      ...source, id: "copied-seg", status: "pending",
      audio_ref: null, duration_seconds: null,
    });
    expect(result.scenes[1].segments[0].speaker_id).toBe("raja");
    expect(result.scenes[1].segments[0].original_text).toBe("नमस्कार");
    expect(result.scenes[1].segments[0].spoken_text).toBe("नमस्कार");
    expect(result.text).toBe(doc.text);
    expect(doc.scenes.map(scene => scene.id)).toEqual(["s1", "s2"]);
    expect(doc.scenes[0].segments[0].audio_ref).toBe("cached-audio");
  });
  it("preserves unspoken stage directions but removes any stale audio metadata", () => {
    const doc = fixture();
    doc.scenes[0].segments.push({
      ...doc.scenes[0].segments[0], id: "direction", kind: "direction",
      original_text: "[पर्दा गिरता है]", spoken_text: "", speaker_id: null,
    });
    const result = duplicateScene(doc, "s1", makeIds("scene-copy", "speech-copy", "direction-copy"));
    expect(result.scenes[1].segments.map(s => s.id)).toEqual(["speech-copy", "direction-copy"]);
    expect(result.scenes[1].segments[1].kind).toBe("direction");
    expect(result.scenes[1].segments[1].original_text).toBe("[पर्दा गिरता है]");
    expect(result.scenes[1].segments[1].audio_ref).toBeNull();
    expect(result.scenes[1].segments[1].status).toBe("pending");
    expect(doc.scenes[0].segments[1].audio_ref).toBe("cached-audio");
  });
  it("assigns a bounded, distinguishable copied title for existing and long names", () => {
    const doc = fixture();
    doc.scenes.push({ id: "another", title: "दरबार (copy)", notes: "", segments: [] });
    const first = duplicateScene(doc, "s1", makeIds("copied-scene", "copied-seg"));
    expect(first.scenes[1].title).toBe("दरबार (copy 2)");
    const longDoc = fixture();
    longDoc.scenes[0].title = "द".repeat(120);
    const long = duplicateScene(longDoc, "s1", makeIds("long-copy", "long-seg"));
    expect(long.scenes[1].title.length).toBeLessThanOrEqual(120);
    expect(long.scenes[1].title).toContain("(copy)");
  });
  it("keeps Unicode surrogate pairs intact when duplicating long scene titles", () => {
    const doc = fixture();
    doc.scenes[0].title = "😀".repeat(60);
    const copy = duplicateScene(doc, "s1", (() => { let i = 0; return () => "copy-" + ++i; })());
    const title = copy.scenes[1].title;
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title).toMatch(/ \(copy\)$/);
    expect(Array.from(title).every(unit => !(unit.length === 1 &&
      unit.charCodeAt(0) >= 0xD800 && unit.charCodeAt(0) <= 0xDFFF))).toBe(true);
  });
  it("fails closed on missing scene, duplicate IDs and excessive scene count", () => {
    const doc = fixture();
    expect(() => duplicateScene(doc, "unknown", makeIds("new", "line"))).toThrow("not found");
    expect(() => duplicateScene(doc, "s1", makeIds("s1", "line"))).toThrow("duplicate");
    expect(() => duplicateScene(doc, "s1", makeIds("fresh-scene", "seg1"))).toThrow("duplicate");
    expect(() => duplicateScene(doc, "s1", makeIds("same", "same"))).toThrow("duplicate");
    expect(() => duplicateScene(doc, "s1", makeIds(" bad ", "line"))).toThrow("invalid");
    expect(() => duplicateScene(doc, "s1", makeIds("x".repeat(81), "line"))).toThrow("invalid");
    expect(() => duplicateScene(doc, "s1", makeIds("good-id", "bad\u0000id"))).toThrow("invalid");
    const full: StoryV2 = { ...doc, scenes: Array.from({ length: 200 }, (_, i) => ({
      id: "scene-" + i, title: "शीर्षक", notes: "", segments: [],
    })) };
    expect(() => duplicateScene(full, "scene-0", makeIds("additional"))).toThrow("Maximum 200");
  });
  it("refuses a cloned scene that would exceed the supported 256-line render budget", () => {
    const doc = fixture();
    doc.scenes[0].segments = Array.from({ length: 130 }, (_, i) => ({
      ...doc.scenes[0].segments[0], id: "segment-" + i,
    }));
    expect(() => duplicateScene(doc, "s1")).toThrow("exceed 256");
    expect(doc.scenes).toHaveLength(2);
  });
});


describe("v0.5.3 nonspoken scene production notes and confirmed deletion", () => {
  it("updates scene notes without changing spoken dialogue, actor IDs, or original Hindi text", () => {
    const doc = fixture();
    const changed = updateSceneNotes(doc, "s1", "धीरे बोलें।\nअभी संगीत नहीं।");
    expect(changed.scenes[0].notes).toBe("धीरे बोलें।\nअभी संगीत नहीं।");
    expect(changed.scenes[0].segments).toBe(doc.scenes[0].segments);
    expect(changed.scenes[0].segments[0].spoken_text).toBe("नमस्कार");
    expect(changed.scenes[1]).toBe(doc.scenes[1]);
    expect(changed.text).toBe(doc.text);
    expect(doc.scenes[0].notes).toBe("");
    expect(updateSceneNotes(changed, "s1", changed.scenes[0].notes)).toBe(changed);
  });
  it("rejects invalid notes or nonexistent/duplicated scene identifiers", () => {
    const doc = fixture();
    expect(() => updateSceneNotes(doc, "s1", "अ".repeat(4001))).toThrow("4000");
    expect(() => updateSceneNotes(doc, "s1", "private\u0000 note")).toThrow("control");
    expect(() => updateSceneNotes(doc, "missing", "note")).toThrow("exactly once");
    const duplicated = { ...doc, scenes: [...doc.scenes, { ...doc.scenes[0] }] };
    expect(() => updateSceneNotes(duplicated, "s1", "note")).toThrow("exactly once");
  });
  it("removes only the requested scene and retains unparsed original script and other scenes", () => {
    const doc = fixture();
    const changed = removeScene(doc, "s1");
    expect(changed.scenes.map(scene => scene.id)).toEqual(["s2"]);
    expect(changed.scenes[0]).toBe(doc.scenes[1]);
    expect(changed.text).toBe(doc.text);
    expect(changed.characters).toBe(doc.characters);
    expect(changed.pronunciation_glossary).toBe(doc.pronunciation_glossary);
    expect(doc.scenes.map(scene => scene.id)).toEqual(["s1", "s2"]);
    expect(removeScene(changed, "s2").scenes).toHaveLength(0);
  });
  it("refuses deleting a nonexistent or ambiguously duplicated scene", () => {
    const doc = fixture();
    expect(() => removeScene(doc, "missing")).toThrow("exactly once");
    const duplicate = { ...doc, scenes: [...doc.scenes, { ...doc.scenes[0] }] };
    expect(() => removeScene(duplicate, "s1")).toThrow("exactly once");
  });
});
