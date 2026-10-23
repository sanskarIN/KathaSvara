// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { recoveryHint } from "./recovery_hints";

describe("privacy-safe render recovery hints", () => {
  it("maps each recognized failure code to a fixed actionable message", () => {
    for (const failure_code of [
      "incomplete", "validation", "storage", "resources", "runtime",
    ]) {
      const hint = recoveryHint({ state: "failed", failure_code });
      expect(hint.length).toBeGreaterThan(40);
      expect(hint).not.toContain("undefined");
    }
    expect(recoveryHint({ state: "failed", failure_code: "storage" }))
      .toContain("free space");
    expect(recoveryHint({ state: "failed", failure_code: "validation" }))
      .toContain("readiness audit");
  });

  it("never echoes unexpected exception names, paths or private Hindi story text", () => {
    const secret = "private /Users/story/निजी-कहानी Chatterbox secret";
    const hint = recoveryHint({ state: "failed", failure_code: secret });
    expect(hint).toContain("exact reason is not stored");
    expect(hint).not.toContain(secret);
    expect(hint).not.toContain("निजी");
    expect(hint).not.toContain("Chatterbox secret");
  });

  it("reports distinct interrupted, cancelled, active and completed states", () => {
    expect(recoveryHint({ state: "interrupted", failure_code: "runtime" }))
      .toContain("cannot resume in place");
    expect(recoveryHint({ state: "cancelled" }))
      .toContain("confirmation");
    expect(recoveryHint({ state: "running" })).toContain("still active");
    expect(recoveryHint({ state: "completed" })).toContain("does not certify");
    expect(recoveryHint({ state: "unexpected", failure_code: "storage" }))
      .toContain("no automatic action");
  });

  it("keeps incomplete legacy failures generic", () => {
    expect(recoveryHint({ state: "failed" })).toContain("exact reason is not stored");
    expect(recoveryHint({ state: "failed", failure_code: "" }))
      .toContain("exact reason is not stored");
  });
});
