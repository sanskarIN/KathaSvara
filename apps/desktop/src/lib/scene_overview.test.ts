import { describe, expect, it } from "vitest";
import { legacyToStoryV2, type SegmentV2, type StoryV2 } from "./story_v2";
import { sceneOverview } from "./scene_overview";

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
});
