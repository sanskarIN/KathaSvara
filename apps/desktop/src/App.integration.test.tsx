// @vitest-environment jsdom
// SPDX-License-Identifier: MPL-2.0
// The Settings TTS doctor must never silently trigger speech generation.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  save: vi.fn(),
  open: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save, open: mocks.open }));
vi.mock("./CastStudio", () => ({ default: () => null }));

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.save.mockReset();
  mocks.open.mockReset();
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
  next_action_code: "run_real_hindi_smoke",
  next_action: "Run the explicit Hindi WAV smoke test and listen to the output.",
  model_weights_verified: false,
  audio_synthesis_verified: false,
  help: "Run real Hindi acceptance separately.",
};

function openSettings() {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
}

describe("offline WAV I/O diagnostic in Settings", () => {
  it("shows a passing synthetic round-trip without generating audio or persisting paths", async () => {
    mocks.invoke.mockResolvedValue({
      status: "passed", failed_stage: null, temporary_wav_roundtrip_ok: true,
      model_loaded: false, hindi_listening_verified: false,
      audio_playback_verified: false, help: "Synthetic WAV I/O passed.",
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", {
      name: "Test temporary WAV I/O (no model or playback)",
    }));
    const report = await screen.findByRole("status", { name: "Offline WAV I/O result" });
    expect(within(report).getByText(/Temporary round-trip passed/)).toBeTruthy();
    expect(within(report).getByText(/Model \/ Hindi speech \/ playback verified:/).parentElement?.textContent).toContain("No");
    expect(mocks.invoke).toHaveBeenCalledWith("probe_audio_io");
    expect(mocks.invoke).not.toHaveBeenCalledWith("synthesize", expect.anything());
    expect(mocks.invoke).not.toHaveBeenCalledWith("probe_tts_runtime", expect.anything());
    expect(JSON.stringify(window.localStorage)).not.toContain("wav");
  });

  it("shows fixed failed stage, not claims about real model or Hindi sound", async () => {
    mocks.invoke.mockResolvedValue({
      status: "failed", failed_stage: "inspect_pcm16",
      temporary_wav_roundtrip_ok: false,
      model_loaded: false, hindi_listening_verified: false,
      audio_playback_verified: false, help: "Check temporary WAV I/O.",
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", {
      name: "Test temporary WAV I/O (no model or playback)",
    }));
    const report = await screen.findByRole("status", { name: "Offline WAV I/O result" });
    expect(within(report).getByText(/Temporary round-trip failed/)).toBeTruthy();
    expect(within(report).getByText(/inspect_pcm16/)).toBeTruthy();
    expect(within(report).getByText(/Recommended next step:/).parentElement?.textContent)
      .toContain("Update KathaSvara inference sources");
    expect(within(report).getByText(/Model \/ Hindi speech \/ playback verified:/).parentElement?.textContent).toContain("No");
  });

  it("never exposes local paths when the native WAV check rejects its call", async () => {
    const privatePath = "C:\\Users\\private-person\\secret-voice.wav";
    mocks.invoke.mockRejectedValue(new Error(privatePath));
    openSettings();
    fireEvent.click(screen.getByRole("button", {
      name: "Test temporary WAV I/O (no model or playback)",
    }));
    await waitFor(() => {
      expect(screen.getByText(/Cannot run the WAV I\/O check/)).toBeTruthy();
    });
    expect(document.body.textContent).not.toContain("private-person");
    expect(document.body.textContent).not.toContain(privatePath);
    expect(mocks.invoke).not.toHaveBeenCalledWith("synthesize", expect.anything());
  });

  it("disables repeated clicks while an offline WAV check is running", async () => {
    let finish: (value: unknown) => void = () => {
      throw new Error("WAV diagnostic not invoked");
    };
    mocks.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    openSettings();
    fireEvent.click(screen.getByRole("button", {
      name: "Test temporary WAV I/O (no model or playback)",
    }));
    expect(screen.getByRole("button", { name: /Checking temporary WAV I\/O/ })).toHaveProperty("disabled", true);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({
        status: "passed", failed_stage: null, temporary_wav_roundtrip_ok: true,
        model_loaded: false, hindi_listening_verified: false,
        audio_playback_verified: false, help: "Checked.",
      });
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
});

describe("session-only consented reference selection (no model)", () => {
  it("passes a chosen local WAV to the probe without showing or persisting its path", async () => {
    const privatePath = "C:\\Users\\private\\my-voice.wav";
    mocks.open.mockResolvedValue(privatePath);
    mocks.invoke.mockResolvedValue(GOOD_IMPORTS);
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Choose local reference WAV" }));
    await waitFor(() => expect(screen.getByRole("button", {
      name: "Clear session voice selection",
    })).toBeTruthy());
    expect(screen.getByText(/Local recording selected \(private path hidden\)/)).toBeTruthy();
    expect(document.body.textContent).not.toContain(privatePath);
    expect(JSON.stringify(window.localStorage)).not.toContain(privatePath);
    fireEvent.click(screen.getByRole("button", {
      name: "Verify speech library imports (no model load)",
    }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("probe_tts_runtime", {
      referenceWavPath: privatePath,
    }));
    expect(mocks.invoke).not.toHaveBeenCalledWith("synthesize", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Clear session voice selection" }));
    fireEvent.click(screen.getByRole("button", {
      name: "Verify speech library imports (no model load)",
    }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("probe_tts_runtime", {
      referenceWavPath: null,
    }));
    expect(document.body.textContent).not.toContain(privatePath);
  });

  it("discloses active session voice before narration without revealing the path", async () => {
    const privatePath = "C:\\Users\\private\\consented.wav";
    mocks.open.mockResolvedValue(privatePath);
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Choose local reference WAV" }));
    await waitFor(() => expect(screen.getByRole("button", {
      name: "Clear session voice selection",
    })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Voice Studio" }));
    expect(screen.getByLabelText("Active narration reference mode").textContent)
      .toContain("Session-selected local WAV (private path hidden)");
    expect(document.body.textContent).not.toContain(privatePath);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear session voice selection" }));
    fireEvent.click(screen.getByRole("button", { name: "Voice Studio" }));
    expect(screen.getByLabelText("Active narration reference mode").textContent)
      .toContain("Launcher/default model conditioning");
    expect(document.body.textContent).not.toContain(privatePath);
  });

  it("sends the selected voice only to a local narration command", async () => {
    const privatePath = "C:\\Users\\private\\consented.wav";
    mocks.open.mockResolvedValue(privatePath);
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "synthesize") {
        return {
          audio_id: "123e4567-e89b-42d3-a456-426614174000",
          data_url: "data:audio/wav;base64,UklGRg==",
          preview_available: true, duration_seconds: 1,
          sample_rate: 24000, chunks: 1,
        };
      }
      if (command === "discard_audio") return undefined;
      throw new Error("Unexpected command: " + command);
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Choose local reference WAV" }));
    await waitFor(() => expect(screen.getByRole("button", {
      name: "Clear session voice selection",
    })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Voice Studio" }));
    fireEvent.click(screen.getByRole("button", { name: /Generate Hindi Voice/ }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      "synthesize", expect.objectContaining({ referenceWavPath: privatePath }),
    ));
    expect(document.body.textContent).not.toContain(privatePath);
  });

  it("does not restore a cleared session reference from a late dialog", async () => {
    const original = "C:\\Users\\private\\original.wav";
    const obsolete = "C:\\Users\\private\\obsolete.wav";
    let completePicker: (value: string) => void = () => {
      throw new Error("Picker was not started");
    };
    mocks.open.mockResolvedValueOnce(original).mockImplementationOnce(() =>
      new Promise<string>(resolve => { completePicker = resolve; }));
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Choose local reference WAV" }));
    await waitFor(() => expect(screen.getByRole("button", {
      name: "Clear session voice selection",
    })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Choose local reference WAV" }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Clear session voice selection" }));
    await act(async () => { completePicker(obsolete); });
    expect(screen.queryByRole("button", { name: "Clear session voice selection" })).toBeNull();
    expect(screen.getByText(/Launcher default \(if available\)/)).toBeTruthy();
    expect(document.body.textContent).not.toContain(original);
    expect(document.body.textContent).not.toContain(obsolete);
  });

  it("ignores a completed probe for a superseded local voice reference", async () => {
    let completeProbe: (value: typeof GOOD_IMPORTS) => void = () => {
      throw new Error("Probe was not started");
    };
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "probe_tts_runtime") {
        return new Promise<typeof GOOD_IMPORTS>(resolve => { completeProbe = resolve; });
      }
      throw new Error("Unexpected command: " + command);
    });
    mocks.open.mockResolvedValue("C:\\Users\\private\\latest.wav");
    openSettings();
    fireEvent.click(screen.getByRole("button", {
      name: "Verify speech library imports (no model load)",
    }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("probe_tts_runtime", {
      referenceWavPath: null,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Choose local reference WAV" }));
    await waitFor(() => expect(screen.getByRole("button", {
      name: "Clear session voice selection",
    })).toBeTruthy());
    await act(async () => { completeProbe(GOOD_IMPORTS); });
    expect(screen.queryByRole("status", { name: "TTS import probe result" })).toBeNull();
    expect(screen.getByText(/Run the no-model TTS preflight before generating/)).toBeTruthy();
    expect(screen.getByRole("button", {
      name: "Verify speech library imports (no model load)",
    })).not.toHaveProperty("disabled", true);
  });

  it("does not publish stale audio from a voice selection cleared mid-render", async () => {
    const firstVoice = "C:\\Users\\private\\selected.wav";
    const audioId = "123e4567-e89b-42d3-a456-426614174000";
    let finishGeneration: (result: unknown) => void = () => {
      throw new Error("Speech generation was not started");
    };
    mocks.open.mockResolvedValue(firstVoice);
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "synthesize") {
        return new Promise(resolve => { finishGeneration = resolve; });
      }
      if (command === "discard_audio") return Promise.resolve();
      throw new Error("Unexpected command: " + command);
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Choose local reference WAV" }));
    await waitFor(() => expect(screen.getByRole("button", {
      name: "Clear session voice selection",
    })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Voice Studio" }));
    fireEvent.click(screen.getByRole("button", { name: /Generate Hindi Voice/ }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      "synthesize", expect.objectContaining({ referenceWavPath: firstVoice }),
    ));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear session voice selection" }));
    await act(async () => {
      finishGeneration({
        audio_id: audioId, data_url: "data:audio/wav;base64,UklGRg==",
        preview_available: true, duration_seconds: 1,
        sample_rate: 24000, chunks: 1,
      });
    });
    expect(mocks.invoke).toHaveBeenCalledWith("discard_audio", { audioId });
    expect(screen.getByText(/Session voice selection cleared/)).toBeTruthy();
    expect(screen.getByText(/Launcher default \(if available\)/)).toBeTruthy();
    expect(document.body.textContent).not.toContain(firstVoice);
  });

  it("keeps prior selection when the reference picker is cancelled", async () => {
    mocks.open.mockResolvedValue(null);
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Choose local reference WAV" }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Clear session voice selection" })).toBeNull();
    expect(screen.getByText(/Launcher default \(if available\)/)).toBeTruthy();
  });
});

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
    expect(mocks.invoke).toHaveBeenCalledWith("probe_tts_runtime", {
      referenceWavPath: null,
    });
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


describe("actionable model-free speech setup guidance", () => {
  it("shows compatibility guidance rather than undefined for an older Python bridge", async () => {
    mocks.invoke.mockResolvedValue({
      ...GOOD_IMPORTS,
      preflight_ok: false,
      next_action: undefined,
      next_action_code: undefined,
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", {
      name: "Verify speech library imports (no model load)",
    }));
    const report = await screen.findByRole("status", { name: "TTS import probe result" });
    const nextStep = within(report).getByText(/Recommended next step:/);
    expect(nextStep.parentElement?.textContent).toContain("Update the local KathaSvara inference sources");
    expect(nextStep.parentElement?.textContent).not.toContain("undefined");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalledWith("synthesize", expect.anything());
  });


  it("shows one actionable repair without triggering model inference", async () => {
    mocks.invoke.mockResolvedValue({
      ...GOOD_IMPORTS,
      checks: { ...GOOD_IMPORTS.checks, torch: "import_failed" },
      failed_components: ["torch"],
      imports_ok: false,
      preflight_ok: false,
      next_action_code: "repair_tts_imports",
      next_action: "Repair the failed speech packages in the selected Python environment.",
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", {
      name: "Verify speech library imports (no model load)",
    }));
    const report = await screen.findByRole("status", { name: "TTS import probe result" });
    const recommendation = within(report).getByText(/Recommended next step:/);
    expect(recommendation.parentElement?.textContent).toContain("Repair the failed speech packages");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalledWith("synthesize", expect.anything());
    expect(mocks.invoke).not.toHaveBeenCalledWith("render_story_v2", expect.anything());
  });

  it("keeps preflight success explicitly distinct from real audio verification", async () => {
    mocks.invoke.mockResolvedValue(GOOD_IMPORTS);
    openSettings();
    fireEvent.click(screen.getByRole("button", {
      name: "Verify speech library imports (no model load)",
    }));
    const report = await screen.findByRole("status", { name: "TTS import probe result" });
    expect(within(report).getByText(/Run the explicit Hindi WAV smoke test/)).toBeTruthy();
    expect(within(report).getByText(/Model weights \/ real Hindi audio verified:/).parentElement?.textContent).toContain("No");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
});
