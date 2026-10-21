// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  buildProductionManifest, serializeProductionManifest, type ProductionAudit,
} from "./production_manifest";

function audit(): ProductionAudit {
  return {
    total_scenes: 2, ready_scenes: 1, full_story_ready: false,
    full_story_reason: "unassigned_speaker", full_story_chunks: 0,
    scenes: [
      { scene_id: "secret-scene-one", ready: true, reason: "ready", segments: 2, chunks: 3 },
      { scene_id: "secret-scene-two", ready: false,
        reason: "unassigned_speaker", segments: 1, chunks: 0 },
    ],
    model_loaded: false, audio_verified: false, distinct_voices_verified: false,
  };
}

describe("privacy-safe local production audit manifest", () => {
  it("exports only sequential scene numbers and counts, not private story data", () => {
    const report = audit();
    const before = JSON.stringify(report);
    const manifest = buildProductionManifest(report);
    const json = serializeProductionManifest(report);
    expect(manifest.format).toBe("kathasvara-production-audit");
    expect(manifest.schema_version).toBe(1);
    expect(manifest.assessment).toBe("model-free-script-structure-only");
    expect(manifest.scenes.map(scene => scene.scene_number)).toEqual([1, 2]);
    expect(json).not.toContain("secret-scene");
    expect(json).not.toContain("scene_id");
    expect(json).not.toContain("speaker_id");
    expect(json).not.toContain("original_text");
    expect(json).not.toContain("spoken_text");
    expect(JSON.stringify(report)).toBe(before);
    expect(JSON.parse(json)).toEqual(manifest);
  });

  it("never spreads unexpected source fields into the export", () => {
    const malicious = {
      ...audit(), text: "प्राइवेट स्क्रिप्ट", character_name: "गोपनीय",
      scenes: [
        { ...audit().scenes[0], spoken_text: "निजी संवाद", voice: { token: "private" } },
        audit().scenes[1],
      ],
    };
    const json = serializeProductionManifest(malicious);
    expect(json).not.toContain("प्राइवेट");
    expect(json).not.toContain("गोपनीय");
    expect(json).not.toContain("निजी");
    expect(json).not.toContain("token");
  });

  it("rejects false audio-acceptance claims and unknown codes", () => {
    const claimed = { ...audit(), audio_verified: true };
    expect(() => serializeProductionManifest(claimed as unknown as ProductionAudit))
      .toThrow("Invalid");
    const unrecognized = { ...audit(), full_story_reason: "real_audio_verified" };
    expect(() => serializeProductionManifest(unrecognized as unknown as ProductionAudit))
      .toThrow("Invalid");
  });

  it("rejects forged totals, non-finite chunk counts and contradictory statuses", () => {
    const wrongCount = { ...audit(), ready_scenes: 2 };
    expect(() => serializeProductionManifest(wrongCount)).toThrow("Inconsistent");
    const badChunk = { ...audit(), scenes: [
      { ...audit().scenes[0], chunks: Number.NaN }, audit().scenes[1],
    ] };
    expect(() => serializeProductionManifest(badChunk)).toThrow("Invalid scene");
    const forged = { ...audit(), full_story_ready: true };
    expect(() => serializeProductionManifest(forged)).toThrow("Invalid");
  });

  it("allows a blank project report but never treats it as ready", () => {
    const blank: ProductionAudit = {
      ...audit(), total_scenes: 0, ready_scenes: 0, full_story_reason: "no_dialogue",
      scenes: [], full_story_chunks: 0,
    };
    expect(buildProductionManifest(blank).scenes).toEqual([]);
    expect(buildProductionManifest(blank).full_story_ready).toBe(false);
  });
});
