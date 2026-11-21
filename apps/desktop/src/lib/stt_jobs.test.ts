// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { createSttJobId } from "./stt_jobs";

describe("job-scoped offline Hindi transcription cancellation IDs", () => {
  it("generates distinct canonical version-4 UUIDs using Web Crypto", () => {
    const ids = Array.from({ length: 16 }, () => createSttJobId());
    const canonicalV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(ids.every(id => canonicalV4.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not reuse one cancellation token for two distinct recognition runs", () => {
    const previous = createSttJobId();
    const next = createSttJobId();
    expect(next).not.toBe(previous);
  });
});
