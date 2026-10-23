import { describe, expect, it } from "vitest";
import {
  addCharacter, addScene, assignSegment, defaultVoice, duplicateCharacter, legacyToStoryV2,
  makeCharacter, moveScene, moveSegment, moveSegmentWithinScene, reviewSpokenText, setGlossary, reassignAndRemoveCharacter, renameCharacter, renameScene, unresolvedSpeech,
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
  it("adds a scene and moves a line without dropping original text", () => {
    const doc = addScene(fixture(), "नया दृश्य", "newscene");
    const moved = moveSegment(doc, "seg1", "newscene");
    expect(moved.scenes[0].segments).toHaveLength(0);
    expect(moved.scenes[2].segments[0].original_text).toBe("नमस्कार");
    expect(() => moveSegment(doc, "seg1", "not-there")).toThrow("does not exist");
  });
  it("rejects duplicate names on renaming", () => {
    const doc = fixture();
    expect(() => renameCharacter(doc, "raja", "Narrator")).toThrow("unique");
    expect(renameCharacter(doc, "raja", "राजा नया").characters[1].name).toBe("राजा नया");
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
