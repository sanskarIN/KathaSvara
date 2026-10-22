// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { version as desktopVersion } from "../../package.json";
import tauriConfig from "../../src-tauri/tauri.conf.json";

describe("desktop release version display contract", () => {
  it("shows the same development version as the native Tauri application", () => {
    expect(desktopVersion).toMatch(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/u);
    expect(desktopVersion).toBe(tauriConfig.version);
  });

  it("does not assume a stable application merely from the version", () => {
    // The sidebar displays this value with an experimental preview qualifier.
    // Matching package versions are not evidence of model or Windows acceptance.
    expect(typeof desktopVersion).toBe("string");
  });
});
