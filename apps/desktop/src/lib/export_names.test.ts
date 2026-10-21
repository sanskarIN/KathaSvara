// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { isCurrentExportSession, renderExportLabel, suggestedOutputFile } from "./export_names";
import { legacyToStoryV2, type StoryV2 } from "./story_v2";

function story(): StoryV2 {
  const doc = legacyToStoryV2({ id: "p", title: "राजा भोज: कहानी / पहला भाग", text: "" });
  return {
    ...doc,
    scenes: [
      { id: "scene1", title: "नीलकुंड / गाँव", notes: "", segments: [
        { id: "speech1", kind: "speech", speaker_id: "narrator",
          original_text: "नमस्ते", spoken_text: "नमस्ते", status: "pending",
          audio_ref: null, duration_seconds: null, source_label: null },
        { id: "direction", kind: "direction", speaker_id: null,
          original_text: "[चुप]", spoken_text: "", status: "pending",
          audio_ref: null, duration_seconds: null, source_label: null },
      ] },
      { id: "scene2", title: "राज दरबार", notes: "", segments: [
        { id: "speech2", kind: "speech", speaker_id: "narrator",
          original_text: "सभा", spoken_text: "सभा", status: "pending",
          audio_ref: null, duration_seconds: null, source_label: null },
      ] },
    ],
  };
}

describe("scope-bound narration export names", () => {
  it("suggests matching WAV and SRT files for the whole story", () => {
    const label = renderExportLabel(story(), "audio-a");
    expect(label.scope).toBe("story");
    expect(suggestedOutputFile(label, "wav")).toBe(
      "KathaSvara-राजा-भोज-कहानी-पहला-भाग-full-story.wav",
    );
    expect(suggestedOutputFile(label, "srt")).toBe(
      "KathaSvara-राजा-भोज-कहानी-पहला-भाग-full-story.srt",
    );
  });

  it("includes stable scene order from the rendered document, not active scene tab", () => {
    const label = renderExportLabel(story(), "audio-b", "scene2");
    expect(label.scope).toBe("scene");
    expect(label.baseName).toContain("scene-002-राज-दरबार");
    expect(label.baseName).not.toContain("नीलकुंड");
  });

  it("identifies one line and refuses stage directions or stale IDs", () => {
    const line = renderExportLabel(story(), "audio-c", "scene1", "speech1");
    expect(line.scope).toBe("line");
    expect(line.baseName).toContain("scene-001-नीलकुंड-गाँव-line-001");
    expect(() => renderExportLabel(story(), "x", "scene1", "direction")).toThrow("not dialogue");
    expect(() => renderExportLabel(story(), "x", "missing")).toThrow("missing");
    expect(() => renderExportLabel(story(), "x", "scene1", "speech2")).toThrow("outside");
  });

  it("never returns separators, control characters, bidi overrides or traversal names", () => {
    const doc = story();
    doc.title = "..\\\\C:\\NUL<>\\u202e";
    doc.scenes[0].title = "\u202e/../../\\\\COM1";
    const label = renderExportLabel(doc, "audio-d", "scene1");
    expect(label.baseName).toMatch(/^KathaSvara-/u);
    expect(label.baseName).not.toMatch(/[\\/<>:"|?*\u202e]/u);
    expect(label.baseName).not.toContain("..");
  });

  it("caps giant user-provided names and uses a safe fallback", () => {
    const doc = story();
    doc.title = " ".repeat(25);
    doc.scenes[0].title = "ि".repeat(1000);
    const label = renderExportLabel(doc, "audio-e", "scene1");
    expect(label.baseName.length).toBeLessThan(130);
    expect(label.baseName).toContain("KathaSvara-story-scene-001");
  });

  it("does not mutate the story and uses separate audio identity", () => {
    const doc = story();
    const snapshot = JSON.stringify(doc);
    const label = renderExportLabel(doc, "audio-f", "scene1");
    expect(label.audioId).toBe("audio-f");
    expect(JSON.stringify(doc)).toBe(snapshot);
    expect(() => renderExportLabel(doc, " ", "scene1")).toThrow("Audio ID");
  });
});

describe("stale export dialog refusal", () => {
  it("requires the same audio ID, generation and document revision", () => {
    const label = renderExportLabel(story(), "wav1");
    expect(isCurrentExportSession(label, "wav1", 3, 3, 8, 8)).toBe(true);
    expect(isCurrentExportSession(label, "wav2", 3, 3, 8, 8)).toBe(false);
    expect(isCurrentExportSession(label, "wav1", 3, 4, 8, 8)).toBe(false);
    expect(isCurrentExportSession(label, "wav1", 3, 3, 8, 9)).toBe(false);
    expect(isCurrentExportSession(null, "wav1", 3, 3, 8, 8)).toBe(false);
  });
});
