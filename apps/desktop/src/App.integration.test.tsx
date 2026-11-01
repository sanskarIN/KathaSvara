// @vitest-environment jsdom
// SPDX-License-Identifier: MPL-2.0
// The Settings TTS doctor must never silently trigger speech generation.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
vi.mock("./CastStudio", () => ({ default: () => null }));

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.save.mockReset();
  window.localStorage.clear();
});
afterEach(() => cleanup());

const GOOD_IMPORTS = {
  python_311: true,
  checks: {
    numpy: "ok", soundfile: "ok", torch: "ok",
    chatterbox_multilingual: "ok",
  },
  failed_components: [],
  imports_ok: true,
  tts_device_mode: "auto",
  device_configuration_valid: true,
  tts_model_variant: "v2",
  model_configuration_valid: true,
  reference_voice_status: "not_set",
  upstream_api_status: "not_requested",
  upstream_api_compatible: true,
  preflight_ok: true,
  model_weights_verified: false,
  audio_synthesis_verified: false,
  help: "Run real Hindi acceptance separately.",
};

function openSettings() {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
}

describe("local TTS import doctor (no model)", () => {
  it("shows a successful import separately from unverified real speech", async () => {
    mocks.invoke.mockResolvedValue(GOOD_IMPORTS);
    openSettings();
    fireEvent.click(screen.getByRole("button", {
      name: "Verify speech library imports (no model load)",
    }));
    const report = await screen.findByRole("status", { name: "TTS import probe result" });
    expect(within(report).getByText(/TTS preflight: Setup passed/)).toBeTruthy();
    expect(within(report).getByText(/Model weights \/ real Hindi audio verified:/)).toBeTruthy();
    expect(within(report).getByText(/Model weights \/ real Hindi audio verified:/).parentElement?.textContent).toContain("No");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("probe_tts_runtime");
    expect(mocks.invoke).not.toHaveBeenCalledWith("synthesize", expect.anything());
  });

  it("labels binary import failure without attempting speech generation", async () => {
    mocks.invoke.mockResolvedValue({
      ...GOOD_IMPORTS,
      checks: { ...GOOD_IMPORTS.checks, torch: "import_failed" },
      failed_components: ["torch"],
      imports_ok: false,
      preflight_ok: false,
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", {
      name: "Verify speech library imports (no model load)",
    }));
    const report = await screen.findByRole("status", { name: "TTS import probe result" });
    expect(within(report).getByText(/Setup needs attention/)).toBeTruthy();
    expect(within(report).getByText("torch").parentElement?.textContent).toContain("Import failed");
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    expect(mocks.invoke).not.toHaveBeenCalledWith("synthesize", expect.anything());
  });

  it("reports an opted-in V3 checkpoint without claiming tested Hindi", async () => {
    mocks.invoke.mockResolvedValue({
      ...GOOD_IMPORTS,
      tts_model_variant: "v3",
      upstream_api_status: "compatible",
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", {
      name: "Verify speech library imports (no model load)",
    }));
    const report = await screen.findByRole("status", { name: "TTS import probe result" });
    expect(within(report).getByText(/Multilingual checkpoint:/).parentElement?.textContent).toContain("v3");
    expect(within(report).getByText(/Model weights \/ real Hindi audio verified:/).parentElement?.textContent).toContain("No");
    expect(mocks.invoke).not.toHaveBeenCalledWith("synthesize", expect.anything());
  });

  it("detects a legacy Chatterbox version missing V3 selection", async () => {
    mocks.invoke.mockResolvedValue({
      ...GOOD_IMPORTS,
      tts_model_variant: "v3",
      upstream_api_status: "v3_unsupported",
      upstream_api_compatible: false,
      preflight_ok: false,
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", {
      name: "Verify speech library imports (no model load)",
    }));
    const report = await screen.findByRole("status", { name: "TTS import probe result" });
    expect(within(report).getByText(/Setup needs attention/)).toBeTruthy();
    expect(within(report).getByText(/does not support V3 checkpoint selection/)).toBeTruthy();
    expect(mocks.invoke).not.toHaveBeenCalledWith("synthesize", expect.anything());
  });

  it("does not certify an opaque Chatterbox wrapper as V3-compatible", async () => {
    mocks.invoke.mockResolvedValue({
      ...GOOD_IMPORTS,
      tts_model_variant: "v3",
      upstream_api_status: "unverifiable",
      upstream_api_compatible: false,
      preflight_ok: false,
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", {
      name: "Verify speech library imports (no model load)",
    }));
    const report = await screen.findByRole("status", { name: "TTS import probe result" });
    expect(within(report).getByText(/Setup needs attention/)).toBeTruthy();
    expect(within(report).getByText(/Cannot verify the installed API signatures/)).toBeTruthy();
    expect(mocks.invoke).not.toHaveBeenCalledWith("synthesize", expect.anything());
  });

  it("detects an installed Chatterbox version missing reference prompts", async () => {
    mocks.invoke.mockResolvedValue({
      ...GOOD_IMPORTS,
      reference_voice_status: "valid",
      upstream_api_status: "reference_unsupported",
      upstream_api_compatible: false,
      preflight_ok: false,
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", {
      name: "Verify speech library imports (no model load)",
    }));
    const report = await screen.findByRole("status", { name: "TTS import probe result" });
    expect(within(report).getByText(/does not support reference audio prompts/)).toBeTruthy();
    expect(mocks.invoke).not.toHaveBeenCalledWith("synthesize", expect.anything());
  });

  it("rejects an invalid checkpoint setting without loading a model", async () => {
    mocks.invoke.mockResolvedValue({
      ...GOOD_IMPORTS,
      tts_model_variant: "invalid",
      model_configuration_valid: false,
      preflight_ok: false,
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", {
      name: "Verify speech library imports (no model load)",
    }));
    const report = await screen.findByRole("status", { name: "TTS import probe result" });
    expect(within(report).getByText(/Setup needs attention/)).toBeTruthy();
    expect(within(report).getByText(/Invalid override — use v2 or v3/)).toBeTruthy();
    expect(mocks.invoke).not.toHaveBeenCalledWith("synthesize", expect.anything());
  });

  it("reports invalid reference WAV without exposing its filename", async () => {
    mocks.invoke.mockResolvedValue({
      ...GOOD_IMPORTS,
      reference_voice_status: "invalid",
      preflight_ok: false,
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", {
      name: "Verify speech library imports (no model load)",
    }));
    const report = await screen.findByRole("status", { name: "TTS import probe result" });
    expect(within(report).getByText(/Invalid reference — check selected WAV/)).toBeTruthy();
    expect(within(report).getByText(/Setup needs attention/)).toBeTruthy();
    expect(mocks.invoke).not.toHaveBeenCalledWith("synthesize", expect.anything());
  });

  it("reports an invalid TTS device even when imports succeed", async () => {
    mocks.invoke.mockResolvedValue({
      ...GOOD_IMPORTS,
      tts_device_mode: "invalid",
      device_configuration_valid: false,
      preflight_ok: false,
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", {
      name: "Verify speech library imports (no model load)",
    }));
    const report = await screen.findByRole("status", { name: "TTS import probe result" });
    expect(within(report).getByText(/Setup needs attention/)).toBeTruthy();
    expect(within(report).getByText(/Invalid override — use auto or cpu/)).toBeTruthy();
    expect(mocks.invoke).not.toHaveBeenCalledWith("synthesize", expect.anything());
  });
});
