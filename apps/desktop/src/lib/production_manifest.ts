// SPDX-License-Identifier: MPL-2.0
// Opt-in, text-free audit manifest; no story ID, title or private actor data.
export type AuditReason =
  | "ready" | "no_dialogue" | "unassigned_speaker" | "over_limit" | "needs_review";

export interface SceneAudit {
  scene_id: string;
  ready: boolean;
  reason: AuditReason;
  segments: number;
  chunks: number;
}

export interface ProductionAudit {
  total_scenes: number;
  ready_scenes: number;
  full_story_ready: boolean;
  full_story_reason: AuditReason;
  full_story_chunks: number;
  scenes: SceneAudit[];
  model_loaded: false;
  audio_verified: false;
  distinct_voices_verified: false;
}

export interface ProductionManifest {
  format: "kathasvara-production-audit";
  schema_version: 1;
  assessment: "model-free-script-structure-only";
  total_scenes: number;
  ready_scenes: number;
  full_story_ready: boolean;
  full_story_reason: AuditReason;
  full_story_chunks: number;
  scenes: Array<{
    scene_number: number;
    ready: boolean;
    reason: AuditReason;
    segments: number;
    chunks: number;
  }>;
  model_loaded: false;
  audio_verified: false;
  distinct_voices_verified: false;
}

const reasons = new Set<AuditReason>([
  "ready", "no_dialogue", "unassigned_speaker", "over_limit", "needs_review",
]);

function count(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

export function buildProductionManifest(audit: ProductionAudit): ProductionManifest {
  if (!audit || audit.model_loaded !== false || audit.audio_verified !== false ||
      audit.distinct_voices_verified !== false ||
      !Array.isArray(audit.scenes) || !count(audit.total_scenes, 200) ||
      audit.scenes.length !== audit.total_scenes ||
      !count(audit.ready_scenes, audit.total_scenes) ||
      !count(audit.full_story_chunks, 500) ||
      !reasons.has(audit.full_story_reason) ||
      audit.full_story_ready !== (audit.full_story_reason === "ready")) {
    throw new Error("Invalid or unverifiable production audit report.");
  }
  const scenes = audit.scenes.map((item, index) => {
    if (!item || typeof item.ready !== "boolean" || !reasons.has(item.reason) ||
        item.ready !== (item.reason === "ready") ||
        !count(item.segments, 2000) || !count(item.chunks, 500) ||
        (!item.ready && item.chunks !== 0) ||
        (item.ready && (item.segments === 0 || item.chunks === 0))) {
      throw new Error("Invalid scene readiness data; rerun the audit.");
    }
    return {
      scene_number: index + 1,
      ready: item.ready,
      reason: item.reason,
      segments: item.segments,
      chunks: item.chunks,
    };
  });
  if (scenes.filter(scene => scene.ready).length !== audit.ready_scenes ||
      (!audit.full_story_ready && audit.full_story_chunks !== 0) ||
      (audit.full_story_ready && audit.full_story_chunks === 0)) {
    throw new Error("Inconsistent production audit counts; rerun the audit.");
  }
  // Construct from an allowlist. Never spread the report or include scene_id,
  // title, original_text, spoken_text, voice profile, or cache identifiers.
  return {
    format: "kathasvara-production-audit",
    schema_version: 1,
    assessment: "model-free-script-structure-only",
    total_scenes: audit.total_scenes,
    ready_scenes: audit.ready_scenes,
    full_story_ready: audit.full_story_ready,
    full_story_reason: audit.full_story_reason,
    full_story_chunks: audit.full_story_chunks,
    scenes,
    model_loaded: false,
    audio_verified: false,
    distinct_voices_verified: false,
  };
}

export function serializeProductionManifest(audit: ProductionAudit): string {
  const output = JSON.stringify(buildProductionManifest(audit), null, 2) + "\n";
  if (output.length > 64_000) {
    throw new Error("Production audit report exceeds the export limit.");
  }
  return output;
}
