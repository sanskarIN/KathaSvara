// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { resolveRenderSelection } from "./render_selection";
import { legacyToStoryV2, type StoryV2 } from "./story_v2";

function story(): StoryV2 {
  const doc = legacyToStoryV2({ id: "st1", title: "कथा", text: "Hindi dialogue" });
  return {
    ...doc,
    scenes: [
      { id: "s1", title: "गाँव", notes: "", segments: [
        { id: "line1", kind: "speech", speaker_id: "narrator", spoken_text: "नमस्कार।",
          original_text: "नमस्कार।", status: "pending", audio_ref: null, duration_seconds: null, source_label: null },
        { id: "stage1", kind: "direction", speaker_id: null, spoken_text: "",
          original_text: "[दरवाज़ा खुलता है]", status: "pending", audio_ref: null, duration_seconds: null, source_label: null },
      ] },
      { id: "s2", title: "महल", notes: "", segments: [
        { id: "line2", kind: "speech", speaker_id: "narrator", spoken_text: "राजा भोज।",
          original_text: "राजा भोज।", status: "pending", audio_ref: null, duration_seconds: null, source_label: null },
      ] },
    ],
  };
}

describe("scope selection is shared by model-free preview and rendering", () => {
  it("defaults to a whole-story plan without a forced regeneration", () => {
    expect(resolveRenderSelection(story())).toEqual({
      selectedSceneIds: null, selectedSegmentIds: null, forceSegmentIds: null,
    });
  });

  it("preflights the same selected scene as the render", () => {
    expect(resolveRenderSelection(story(), { sceneId: "s2" })).toEqual({
      selectedSceneIds: ["s2"], selectedSegmentIds: null, forceSegmentIds: null,
    });
  });

  it("forces only the selected spoken line and never unrelated speech", () => {
    expect(resolveRenderSelection(story(), { sceneId: "s1", segmentId: "line1" })).toEqual({
      selectedSceneIds: ["s1"], selectedSegmentIds: ["line1"], forceSegmentIds: ["line1"],
    });
    expect(resolveRenderSelection(story(), { sceneId: "s1", forceAll: true })).toEqual({
      selectedSceneIds: ["s1"], selectedSegmentIds: null, forceSegmentIds: ["line1"],
    });
    expect(resolveRenderSelection(story(), { forceAll: true }).forceSegmentIds)
      .toEqual(["line1", "line2"]);
  });

  it("rejects missing scenes, out-of-scope segments, and direction-only scopes", () => {
    expect(() => resolveRenderSelection(story(), { sceneId: "missing" })).toThrow("no longer");
    expect(() => resolveRenderSelection(story(), { sceneId: "s1", segmentId: "line2" })).toThrow("spoken dialogue");
    expect(() => resolveRenderSelection(story(), { segmentId: "stage1" })).toThrow("spoken dialogue");
    expect(() => resolveRenderSelection({ ...story(), scenes: [] })).toThrow("Parse labeled");
  });

  it("rejects unresolved speakers before running a model", () => {
    const doc = story();
    doc.scenes[0].segments[0].speaker_id = null;
    expect(() => resolveRenderSelection(doc, { sceneId: "s1" })).toThrow("Assign every");
    expect(resolveRenderSelection(doc, { sceneId: "s2" }).selectedSceneIds).toEqual(["s2"]);
  });

  it("does not edit its input or include story words in transport arguments", () => {
    const doc = story();
    const original = JSON.stringify(doc);
    const result = resolveRenderSelection(doc, { sceneId: "s2" });
    expect(JSON.stringify(doc)).toBe(original);
    expect(JSON.stringify(result)).not.toContain("राजा भोज");
  });

  it("rejects oversized selected lines without preventing smaller scene inspection", () => {
    const doc = story();
    doc.scenes[0].segments[0].spoken_text = "क".repeat(100_001);
    expect(() => resolveRenderSelection(doc)).toThrow("100,000 characters");
    expect(resolveRenderSelection(doc, { sceneId: "s2" }).selectedSceneIds).toEqual(["s2"]);
  });
});
