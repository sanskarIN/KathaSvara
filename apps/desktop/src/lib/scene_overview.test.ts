import { describe, expect, it } from "vitest";
import { legacyToStoryV2, type SegmentV2, type StoryV2 } from "./story_v2";
import { castCoverage, sceneOverview } from "./scene_overview";

function line(id: string, kind: "speech" | "direction", text: string): SegmentV2 {
  return {
    id, kind, original_text: text, spoken_text: kind === "speech" ? text : "",
    speaker_id: kind === "speech" ? "narrator" : null,
    source_label: null, audio_ref: null, duration_seconds: null, status: "pending",
  };
}

function fixture(): StoryV2 {
  const project = legacyToStoryV2({
    id: "story-outline", title: "हिंदी कहानी", text: "अपरिवर्तित मूल पाठ",
  });
  return {
    ...project,
    scenes: [
      {
        id: "forest", title: "जंगल का दृश्य", notes: "रात का समय", segments: [
          line("hello", "speech", "Narrator: नमस्कार"),
          line("door", "direction", "[दरवाज़ा खुलता है]"),
          { ...line("unknown", "speech", "कौन आया?"), speaker_id: null, source_label: "अजनबी" },
        ],
      },
      {
        id: "palace", title: "Royal Palace", notes: "", segments: [
          { ...line("king", "speech", "राजा भोज ने कहा।"), spoken_text: "राजा ने कहा।" },
        ],
      },
      { id: "empty", title: "खाली दृश्य", notes: "", segments: [] },
    ],
  };
}

describe("v0.5.3 local scene outline and Hindi navigation", () => {
  it("counts spoken lines, unspoken directions, unresolved assignments and production notes", () => {
    const doc = fixture();
    expect(sceneOverview(doc)).toEqual([
      { id: "forest", title: "जंगल का दृश्य", spoken: 2,
        directions: 1, unresolved: 1, hasProductionNotes: true },
      { id: "palace", title: "Royal Palace", spoken: 1,
        directions: 0, unresolved: 0, hasProductionNotes: false },
      { id: "empty", title: "खाली दृश्य", spoken: 0,
        directions: 0, unresolved: 0, hasProductionNotes: false },
    ]);
    expect(doc.text).toBe("अपरिवर्तित मूल पाठ");
    expect(doc.scenes[0].segments[2].speaker_id).toBeNull();
  });

  it("searches Hindi scene titles, original lines, reviewed speech and production notes", () => {
    const doc = fixture();
    expect(sceneOverview(doc, "जंगल").map(s => s.id)).toEqual(["forest"]);
    expect(sceneOverview(doc, "दरवाज़ा").map(s => s.id)).toEqual(["forest"]);
    expect(sceneOverview(doc, "राजा भोज").map(s => s.id)).toEqual(["palace"]);
    expect(sceneOverview(doc, "राजा ने").map(s => s.id)).toEqual(["palace"]);
    expect(sceneOverview(doc, "रात का").map(s => s.id)).toEqual(["forest"]);
    expect(sceneOverview(doc, "अजनबी").map(s => s.id)).toEqual(["forest"]);
    expect(sceneOverview(doc, "not-in-this-story")).toEqual([]);
  });

  it("uses case-insensitive Unicode-normalized text while preserving source order", () => {
    const doc = fixture();
    expect(sceneOverview(doc, " royal   ".trim()).map(s => s.id)).toEqual(["palace"]);
    expect(sceneOverview(doc, "ROYAL").map(s => s.id)).toEqual(["palace"]);
    doc.scenes[1].notes = "cafe\u0301";
    expect(sceneOverview(doc, "CAFÉ").map(s => s.id)).toEqual(["palace"]);
    expect(sceneOverview(doc, "  ").map(s => s.id)).toEqual(["forest", "palace", "empty"]);
    expect(doc.scenes[1].notes).toBe("cafe\u0301");
  });

  it("filters unknown-speaker scenes without counting directions as speech", () => {
    const doc = fixture();
    expect(sceneOverview(doc, "", true).map(s => s.id)).toEqual(["forest"]);
    expect(sceneOverview(doc, "जंगल", true).map(s => s.id)).toEqual(["forest"]);
    expect(sceneOverview(doc, "Royal", true)).toEqual([]);
    doc.scenes[0].segments[2].speaker_id = "narrator";
    doc.scenes[0].segments[2].source_label = null;
    expect(sceneOverview(doc, "", true)).toEqual([]);
    expect(sceneOverview(doc)[0].unresolved).toBe(0);
  });

  it("stays local and reflects a new split, merge or selected scene document on next call", () => {
    const doc = fixture();
    const separate: StoryV2 = {
      ...doc,
      scenes: [
        { ...doc.scenes[0], segments: doc.scenes[0].segments.slice(0, 1) },
        { id: "forest-part-two", title: "जंगल - भाग 2", notes: "",
          segments: doc.scenes[0].segments.slice(1) },
        ...doc.scenes.slice(1),
      ],
    };
    expect(sceneOverview(separate, "कौन आया").map(scene => scene.id)).toEqual(["forest-part-two"]);
    expect(sceneOverview(separate, "", true).map(scene => scene.id)).toEqual(["forest-part-two"]);
    expect(sceneOverview(doc, "", true).map(scene => scene.id)).toEqual(["forest"]);
    expect(doc.scenes).toHaveLength(3);
    expect(separate.text).toBe(doc.text);
  });
  it("filters scenes for a specific cast member using only spoken assignments", () => {
    const doc = fixture();
    doc.characters.push({
      id: "king", name: "राजा", description: "", voice: doc.characters[0].voice,
    });
    doc.scenes[0].segments[0].speaker_id = "king";
    doc.scenes[0].segments[1].speaker_id = "king"; // Direction must never match.
    expect(sceneOverview(doc, "", false, "king").map(scene => scene.id)).toEqual(["forest"]);
    expect(sceneOverview(doc, "", false, "narrator").map(scene => scene.id)).toEqual(["palace"]);
    expect(sceneOverview(doc, "जंगल", false, "narrator")).toEqual([]);
    expect(sceneOverview(doc, "नमस्कार", false, "king").map(scene => scene.id)).toEqual(["forest"]);
    expect(sceneOverview(doc, "", false, "unknown-id")).toEqual([]);
    expect(sceneOverview(doc).map(scene => scene.id)).toEqual(["forest", "palace", "empty"]);
    expect(doc.scenes[0].segments[1].speaker_id).toBe("king");
  });

  it("combines cast and unresolved filters without matching unspoken stage directions", () => {
    const doc = fixture();
    doc.characters.push({
      id: "king", name: "राजा", description: "", voice: doc.characters[0].voice,
    });
    doc.scenes[0].segments[0].speaker_id = "king";
    expect(sceneOverview(doc, "", true, "king").map(scene => scene.id)).toEqual(["forest"]);
    expect(sceneOverview(doc, "", true, "narrator")).toEqual([]);
    doc.scenes[0].segments[2].speaker_id = "narrator";
    expect(sceneOverview(doc, "", true, "king")).toEqual([]);
    expect(sceneOverview(doc, "", false, "king").map(scene => scene.id)).toEqual(["forest"]);
    expect(doc.text).toBe("अपरिवर्तित मूल पाठ");
  });

  it("computes a local cast coverage report without guessing unassigned speech", () => {
    const doc = fixture();
    const report = castCoverage(doc);
    expect(report).toEqual({
      characters: [{
        characterId: "narrator", characterName: "Narrator", spokenLines: 2, sceneCount: 2,
      }],
      spokenLines: 3,
      directions: 1,
      unassignedSpeech: 1,
      invalidSpeakerAssignments: 0,
    });
    expect(doc.scenes[0].segments[2].speaker_id).toBeNull();
    expect(doc.text).toBe("अपरिवर्तित मूल पाठ");
  });

  it("counts distinct actor scenes and separates unknown IDs from unassigned lines", () => {
    const doc = fixture();
    doc.characters.push({
      id: "king", name: "राजा", description: "", voice: doc.characters[0].voice,
    });
    doc.scenes[0].segments[0].speaker_id = "king";
    doc.scenes[0].segments[1].speaker_id = "king"; // Direction is unspoken.
    doc.scenes[1].segments.push({
      ...line("another-turn", "speech", "राजा लौट आया।"), speaker_id: "king",
    });
    expect(castCoverage(doc).characters).toEqual([
      { characterId: "narrator", characterName: "Narrator", spokenLines: 1, sceneCount: 1 },
      { characterId: "king", characterName: "राजा", spokenLines: 2, sceneCount: 2 },
    ]);
    doc.scenes[1].segments[0].speaker_id = "missing-actor";
    const report = castCoverage(doc);
    expect(report.spokenLines).toBe(4);
    expect(report.directions).toBe(1);
    expect(report.unassignedSpeech).toBe(1);
    expect(report.invalidSpeakerAssignments).toBe(1);
    expect(report.characters[0].spokenLines).toBe(0);
    expect(report.characters[1].spokenLines).toBe(2);
    expect(doc.scenes[0].segments[1].kind).toBe("direction");
  });

});
