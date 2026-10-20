import { describe, expect, it } from "vitest";
import {
  addCharacter, assignSegment, defaultVoice, legacyToStoryV2,
  makeCharacter, moveScene, reassignAndRemoveCharacter, renameScene, unresolvedSpeech,
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
