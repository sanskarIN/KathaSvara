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

describe("private native errors in Voice Studio", () => {
  it("never displays an OS path from a failed full-story generation", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("C:\\Users\\private-singer\\secret.wav"));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Generate Hindi Voice/ }));
    await waitFor(() => expect(screen.getByText(/Hindi speech was not generated/)).toBeTruthy());
    expect(document.body.textContent).not.toContain("private-singer");
    expect(document.body.textContent).not.toContain("secret.wav");
    expect(screen.getByText(/Local operation failed/)).toBeTruthy();
  });

  it("never displays a private export filename or token on WAV copy failure", async () => {
    const wav = {
      audio_id: "123e4567-e89b-42d3-a456-426614174000",
      data_url: "data:audio/wav;base64,UklGRg==", preview_available: true,
      duration_seconds: 1.25, sample_rate: 24000, chunks: 1,
    };
    mocks.save.mockResolvedValue("C:\\Users\\private-singer\\export.wav");
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "synthesize") return wav;
      if (command === "export_wav") throw new Error("C:\\Users\\private-singer\\export.wav token-secret");
      return undefined;
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Generate Hindi Voice/ }));
    await screen.findByRole("button", { name: /Export WAV/ });
    fireEvent.click(screen.getByRole("button", { name: /Export WAV/ }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("export_wav", {
      audioId: wav.audio_id, destination: "C:\\Users\\private-singer\\export.wav",
    }));
    await waitFor(() => expect(screen.getByText(/Export failed: Local operation failed/)).toBeTruthy());
    expect(document.body.textContent).not.toContain("private-singer");
    expect(document.body.textContent).not.toContain("token-secret");
    expect(JSON.stringify(window.localStorage)).not.toContain("private-singer");
  });
});

describe("explicit real Hindi model smoke test", () => {
  const testId = "123e4567-e89b-42d3-a456-426614174055";
  const goodWav = {
    audio_id: testId,
    data_url: "data:audio/wav;base64,UklGRg==",
    preview_available: true,
    duration_seconds: 1.6,
    sample_rate: 24000,
    chunks: 1,
  };
  const goodInspection = {
    structure_valid: true, codec: "pcm_s16le", channels: 1,
    sample_rate_hz: 24000, frames: 38400, duration_seconds: 1.6,
    model_loaded: false, hindi_listening_verified: false,
    human_review_required: true,
    level_hints: {
      near_silence_hint: false, dc_only_hint: false,
      possible_clipping_hint: false, long_internal_pause_hint: false,
      signal_review_required: false,
    },
  };
  const consentLabel = /I understand that this will load real speech models/;
  const runLabel = "Generate real Hindi test WAV (may download model)";

  it("does not load a speech model until the user explicitly opts in", () => {
    openSettings();
    const run = screen.getByRole("button", { name: runLabel });
    expect(run).toHaveProperty("disabled", true);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(screen.getByText(/First use may download large/)).toBeTruthy();
  });

  it("generates only the short fixed Hindi sample and exposes manual listening, never automatic acceptance", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "synthesize") return goodWav;
      if (command === "inspect_generated_audio") return goodInspection;
      throw new Error("Unexpected command: " + command);
    });
    openSettings();
    fireEvent.click(screen.getByLabelText(consentLabel));
    fireEvent.click(screen.getByRole("button", { name: runLabel }));
    await waitFor(() => expect(screen.getByRole("status", {
      name: "Real Hindi audio test result",
    })).toBeTruthy());
    expect(mocks.invoke).toHaveBeenCalledWith("synthesize", {
      text: "नमस्कार। यह कथास्वर की हिंदी आवाज़ की जाँच है।",
      exaggeration: 0.5, cfgWeight: 0.5, referenceWavPath: null,
    });
    expect(mocks.invoke).toHaveBeenCalledWith("inspect_generated_audio", {
      audioId: testId,
    });
    expect(screen.getByLabelText("Real Hindi smoke-test audio preview")).toBeTruthy();
    expect(screen.getByText(/not an automatic language or quality pass/)).toBeTruthy();
    expect(screen.getByText(/Listen critically for understandable Hindi/)).toBeTruthy();
    expect(screen.getByText(/Inspected real WAV:/)).toBeTruthy();
    expect(screen.getByRole("button", { name: runLabel })).toHaveProperty("disabled", true);
  });

  it("reports built-in playback failure without claiming Hindi was heard, and keeps export available", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "synthesize") return goodWav;
      if (command === "inspect_generated_audio") return goodInspection;
      throw new Error("Unexpected command: " + command);
    });
    openSettings();
    fireEvent.click(screen.getByLabelText(consentLabel));
    fireEvent.click(screen.getByRole("button", { name: runLabel }));
    await screen.findByRole("status", { name: "Real Hindi audio test result" });
    const player = screen.getByLabelText("Real Hindi smoke-test audio preview");
    fireEvent.error(player);
    expect(screen.getByText(/built-in audio player could not play this WAV/)).toBeTruthy();
    expect(screen.getByText(/Hindi listening remains unverified/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export real Hindi test WAV" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("Hindi listening passed");
  });

  it("keeps native inference errors and private paths out of the UI", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("C:\\Users\\private-story\\secret.wav"));
    openSettings();
    fireEvent.click(screen.getByLabelText(consentLabel));
    fireEvent.click(screen.getByRole("button", { name: runLabel }));
    await waitFor(() => expect(screen.getByText(/Real Hindi generation or WAV inspection could not complete/)).toBeTruthy());
    expect(document.body.textContent).not.toContain("private-story");
    expect(screen.queryByRole("status", { name: "Real Hindi audio test result" })).toBeNull();
    expect(JSON.stringify(window.localStorage)).not.toContain("private-story");
  });

  it("exports the real model result using native validated WAV export, not synthetic audio", async () => {
    mocks.save.mockResolvedValue("C:\\Users\\private-story\\sample.wav");
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "synthesize") return { ...goodWav, preview_available: false };
      if (command === "inspect_generated_audio") return goodInspection;
      if (command === "export_wav") return undefined;
      if (command === "discard_audio") return undefined;
      throw new Error("Unexpected command: " + command);
    });
    openSettings();
    fireEvent.click(screen.getByLabelText(consentLabel));
    fireEvent.click(screen.getByRole("button", { name: runLabel }));
    await screen.findByRole("status", { name: "Real Hindi audio test result" });
    expect(screen.getByText(/exceeds inline playback limits/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Export real Hindi test WAV" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("export_wav", {
      audioId: testId, destination: "C:\\Users\\private-story\\sample.wav",
    }));
    expect(document.body.textContent).not.toContain("private-story");
    fireEvent.click(screen.getByRole("button", { name: "Delete local Hindi test WAV" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("discard_audio", { audioId: testId }));
    expect(screen.queryByRole("status", { name: "Real Hindi audio test result" })).toBeNull();
    expect(screen.getByRole("button", { name: runLabel })).toHaveProperty("disabled", true);
  });

  it("does not export a retired WAV if its save dialog resolves after deletion", async () => {
    let finishSave: (value: string | null) => void = () => {
      throw new Error("Save dialog never opened");
    };
    mocks.save.mockImplementation(() => new Promise<string | null>(resolve => {
      finishSave = resolve;
    }));
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "synthesize") return goodWav;
      if (command === "inspect_generated_audio") return goodInspection;
      if (command === "discard_audio") return undefined;
      if (command === "export_wav") throw new Error("A retired WAV must never be exported");
      throw new Error("Unexpected command: " + command);
    });
    openSettings();
    fireEvent.click(screen.getByLabelText(consentLabel));
    fireEvent.click(screen.getByRole("button", { name: runLabel }));
    await screen.findByRole("status", { name: "Real Hindi audio test result" });
    fireEvent.click(screen.getByRole("button", { name: "Export real Hindi test WAV" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Delete local Hindi test WAV" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("discard_audio", {
      audioId: testId,
    }));
    await act(async () => {
      finishSave("C:\\Users\\private-story\\outdated-export.wav");
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith("export_wav", expect.anything());
    expect(screen.getByText(/local Hindi smoke-test WAV was deleted/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("private-story");
  });

  it("does not report a stale export success after its test WAV is deleted", async () => {
    let finishExport: () => void = () => { throw new Error("Export never started"); };
    mocks.save.mockResolvedValue("C:\\Users\\private-story\\export.wav");
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "synthesize") return Promise.resolve(goodWav);
      if (command === "inspect_generated_audio") return Promise.resolve(goodInspection);
      if (command === "export_wav") return new Promise<void>(resolve => {
        finishExport = resolve;
      });
      if (command === "discard_audio") return Promise.resolve();
      throw new Error("Unexpected command: " + command);
    });
    openSettings();
    fireEvent.click(screen.getByLabelText(consentLabel));
    fireEvent.click(screen.getByRole("button", { name: runLabel }));
    await screen.findByRole("status", { name: "Real Hindi audio test result" });
    fireEvent.click(screen.getByRole("button", { name: "Export real Hindi test WAV" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("export_wav", {
      audioId: testId, destination: "C:\\Users\\private-story\\export.wav",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Delete local Hindi test WAV" }));
    await screen.findByText(/local Hindi smoke-test WAV was deleted/);
    await act(async () => { finishExport(); });
    expect(screen.getByText(/local Hindi smoke-test WAV was deleted/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("Test WAV exported");
    expect(document.body.textContent).not.toContain("private-story");
  });

  it("does not overwrite a new test status with an older WAV deletion result", async () => {
    let finishDeletion: () => void = () => { throw new Error("Deletion never started"); };
    let syntheses = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "synthesize") {
        syntheses += 1;
        return syntheses === 1 ? Promise.resolve(goodWav) : new Promise(() => {});
      }
      if (command === "inspect_generated_audio") return Promise.resolve(goodInspection);
      if (command === "discard_audio") return new Promise<void>(resolve => {
        finishDeletion = resolve;
      });
      throw new Error("Unexpected command: " + command);
    });
    openSettings();
    fireEvent.click(screen.getByLabelText(consentLabel));
    fireEvent.click(screen.getByRole("button", { name: runLabel }));
    await screen.findByRole("status", { name: "Real Hindi audio test result" });
    fireEvent.click(screen.getByRole("button", { name: "Delete local Hindi test WAV" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("discard_audio", {
      audioId: testId,
    }));
    fireEvent.click(screen.getByLabelText(consentLabel));
    fireEvent.click(screen.getByRole("button", { name: runLabel }));
    expect(screen.getByText(/Loading the real local Hindi model/)).toBeTruthy();
    await act(async () => { finishDeletion(); });
    expect(screen.getByText(/Loading the real local Hindi model/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("local Hindi smoke-test WAV was deleted");
  });

  it("retires an in-flight result when its selected local reference changes", async () => {
    let finish: (value: typeof goodWav) => void = () => { throw new Error("Not invoked"); };
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "synthesize") {
        return new Promise<typeof goodWav>(resolve => { finish = resolve; });
      }
      if (command === "discard_audio") return Promise.resolve();
      throw new Error("Unexpected command: " + command);
    });
    mocks.open.mockResolvedValue("C:\\Users\\private-story\\voice.wav");
    openSettings();
    fireEvent.click(screen.getByLabelText(consentLabel));
    fireEvent.click(screen.getByRole("button", { name: runLabel }));
    expect(screen.getByRole("button", { name: /Generating genuine Hindi test audio/ }))
      .toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Choose local reference WAV" }));
    await waitFor(() => expect(screen.getByText(/Local recording selected \(private path hidden\)/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /Generating genuine Hindi test audio/ }))
      .toHaveProperty("disabled", true);
    expect(screen.getByText(/previous model job is still finishing/)).toBeTruthy();
    await act(async () => { finish(goodWav); });
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("discard_audio", { audioId: testId }));
    expect(screen.queryByRole("status", { name: "Real Hindi audio test result" })).toBeNull();
    expect(document.body.textContent).not.toContain("private-story");
    expect(JSON.stringify(window.localStorage)).not.toContain("private-story");
  });

  it("rejects a structurally valid but effectively silent or DC-only WAV and deletes its UUID output", async () => {
    for (const failingHint of ["near_silence_hint", "dc_only_hint"] as const) {
      mocks.invoke.mockReset();
      mocks.invoke.mockImplementation(async (command: string) => {
        if (command === "synthesize") return goodWav;
        if (command === "inspect_generated_audio") return {
          ...goodInspection,
          level_hints: { ...goodInspection.level_hints, [failingHint]: true, signal_review_required: true },
        };
        if (command === "discard_audio") return undefined;
        throw new Error("Unexpected native call: " + command);
      });
      openSettings();
      fireEvent.click(screen.getByLabelText(consentLabel));
      fireEvent.click(screen.getByRole("button", { name: runLabel }));
      await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("discard_audio", { audioId: testId }));
      expect(screen.getByText(/failed structural, duration or signal checks/)).toBeTruthy();
      expect(screen.queryByRole("status", { name: "Real Hindi audio test result" })).toBeNull();
      cleanup();
    }
  });

  it("rejects mismatched or untrusted native inspection flags rather than reporting successful Hindi", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "synthesize") return goodWav;
      if (command === "inspect_generated_audio") return {
        ...goodInspection, hindi_listening_verified: true,
        sample_rate_hz: 48000, duration_seconds: 2.4,
      };
      if (command === "discard_audio") return undefined;
      throw new Error("Unexpected command");
    });
    openSettings();
    fireEvent.click(screen.getByLabelText(consentLabel));
    fireEvent.click(screen.getByRole("button", { name: runLabel }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("discard_audio", { audioId: testId }));
    expect(screen.queryByRole("status", { name: "Real Hindi audio test result" })).toBeNull();
  });

  it("shows conservative clipping and long-pause warnings but still requires listening", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "synthesize") return goodWav;
      if (command === "inspect_generated_audio") return {
        ...goodInspection, level_hints: {
          ...goodInspection.level_hints,
          signal_review_required: true,
          possible_clipping_hint: true, long_internal_pause_hint: true,
        },
      };
      throw new Error("Unexpected command");
    });
    openSettings();
    fireEvent.click(screen.getByLabelText(consentLabel));
    fireEvent.click(screen.getByRole("button", { name: runLabel }));
    await screen.findByRole("status", { name: "Real Hindi audio test result" });
    expect(screen.getByText(/Signal review needed:/)).toBeTruthy();
    expect(screen.getByText(/possible clipping/)).toBeTruthy();
    expect(screen.getByText(/long internal quiet span/)).toBeTruthy();
    expect(screen.getByText(/Hindi intelligibility is NOT automatically verified/)).toBeTruthy();
    expect(mocks.invoke).not.toHaveBeenCalledWith("discard_audio", expect.anything());
  });

  it("discards the audio if the native file inspection throws a private-path error", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "synthesize") return goodWav;
      if (command === "inspect_generated_audio") throw new Error("C:\\Users\\private-person\\secret.wav");
      if (command === "discard_audio") return undefined;
      throw new Error("Unexpected command");
    });
    openSettings();
    fireEvent.click(screen.getByLabelText(consentLabel));
    fireEvent.click(screen.getByRole("button", { name: runLabel }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("discard_audio", { audioId: testId }));
    expect(screen.getByText(/generation or WAV inspection could not complete/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("private-person");
    expect(screen.queryByRole("status", { name: "Real Hindi audio test result" })).toBeNull();
  });

  it("retires a real WAV that becomes stale while PCM inspection is pending", async () => {
    let finishInspection: (value: typeof goodInspection) => void = () => {
      throw new Error("Inspection was never requested");
    };
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "synthesize") return Promise.resolve(goodWav);
      if (command === "inspect_generated_audio") {
        return new Promise<typeof goodInspection>(resolve => { finishInspection = resolve; });
      }
      if (command === "discard_audio") return Promise.resolve();
      throw new Error("Unexpected command " + command);
    });
    mocks.open.mockResolvedValue("C:\\Users\\private-story\\replaced-reference.wav");
    openSettings();
    fireEvent.click(screen.getByLabelText(consentLabel));
    fireEvent.click(screen.getByRole("button", { name: runLabel }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("inspect_generated_audio", {
      audioId: testId,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Choose local reference WAV" }));
    await waitFor(() => expect(screen.getByText(/Local recording selected \(private path hidden\)/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /Generating genuine Hindi test audio/ }))
      .toHaveProperty("disabled", true);
    await act(async () => { finishInspection(goodInspection); });
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("discard_audio", { audioId: testId }));
    expect(screen.queryByRole("status", { name: "Real Hindi audio test result" })).toBeNull();
    expect(document.body.textContent).not.toContain("private-story");
    expect(screen.getByRole("button", { name: runLabel })).toHaveProperty("disabled", true);
  });

  it("does not start a parallel full story synthesis while the real smoke test runs", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "synthesize") return new Promise(() => {});
      throw new Error("Unexpected command");
    });
    openSettings();
    fireEvent.click(screen.getByLabelText(consentLabel));
    fireEvent.click(screen.getByRole("button", { name: runLabel }));
    fireEvent.click(screen.getByRole("button", { name: "Voice Studio" }));
    expect(screen.getByRole("button", { name: /Generate Hindi Voice/ }))
      .toHaveProperty("disabled", true);
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual(["synthesize"]);
  });
});

describe("guided model-free speech readiness", () => {
  const python = {
    python_311: true, python_version: "3.11.11", platform: "Windows",
    dependencies: { numpy: true, soundfile: true, torch: true, chatterbox: true },
    dependencies_present: true, model_weights_verified: false,
    audio_synthesis_verified: false, help: "No model loaded",
  };
  const wav = {
    status: "passed", failed_stage: null, temporary_wav_roundtrip_ok: true,
    model_loaded: false, hindi_listening_verified: false,
    audio_playback_verified: false, help: "Model-free test",
  };

  it("runs Python, disposable WAV and import checks in order without synthesis", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "diagnose_engine") return python;
      if (command === "probe_audio_io") return wav;
      if (command === "probe_tts_runtime") return GOOD_IMPORTS;
      throw new Error("Unexpected native call");
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Check speech readiness (no model load)" }));
    await waitFor(() => expect(screen.getByText("Setup checks passed")).toBeTruthy());
    const commands = mocks.invoke.mock.calls.map(([name]) => name);
    expect(commands).toEqual(["diagnose_engine", "probe_audio_io", "probe_tts_runtime"]);
    expect(mocks.invoke).toHaveBeenCalledWith("probe_tts_runtime", { referenceWavPath: null });
    expect(screen.getByText(/Real Hindi narration, model weights and speaker playback verified:/)).toBeTruthy();
    expect(screen.getByText(/next step is explicit real Hindi generation and listening/)).toBeTruthy();
    expect(mocks.invoke).not.toHaveBeenCalledWith("synthesize", expect.anything());
  });

  it("stops before WAV access when the interpreter is not Python 3.11", async () => {
    mocks.invoke.mockResolvedValue({ ...python, python_311: false, python_version: "3.12.3" });
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Check speech readiness (no model load)" }));
    await waitFor(() => expect(screen.getByText("Setup needs attention")).toBeTruthy());
    expect(screen.getByText(/select Python 3.11/)).toBeTruthy();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalledWith("probe_audio_io");
  });

  it("stops before speech imports when disposable WAV I/O fails", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "diagnose_engine") return python;
      if (command === "probe_audio_io") return {
        ...wav, status: "failed", temporary_wav_roundtrip_ok: false, failed_stage: "write_pcm16",
      };
      throw new Error("Unexpected import or synthesis");
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Check speech readiness (no model load)" }));
    await waitFor(() => expect(screen.getByText("Setup needs attention")).toBeTruthy());
    expect(screen.getByText(/Temporary WAV I\/O is blocked/)).toBeTruthy();
    expect(mocks.invoke.mock.calls.map(([name]) => name)).toEqual(["diagnose_engine", "probe_audio_io"]);
    expect(screen.getByText(/write_pcm16/)).toBeTruthy();
  });

  it("does not leak native error paths when a diagnostic crashes", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("C:\\Users\\private-account\\voice.wav"));
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Check speech readiness (no model load)" }));
    await waitFor(() => expect(screen.getByText("Setup needs attention")).toBeTruthy());
    expect(document.body.textContent).not.toContain("private-account");
    expect(screen.getByText(/A local diagnostic could not run/)).toBeTruthy();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("disables duplicate one-click requests and retires a superseded voice selection", async () => {
    let finish: (value: typeof python) => void = () => { throw new Error("not started"); };
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "diagnose_engine") {
        return new Promise<typeof python>(resolve => { finish = resolve; });
      }
      throw new Error("No later check should run");
    });
    mocks.open.mockResolvedValue("C:\\Users\\private-account\\voice.wav");
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Check speech readiness (no model load)" }));
    const checking = screen.getByRole("button", { name: /Step 1\/3: Checking Python/ });
    expect(checking).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Choose local reference WAV" }));
    await waitFor(() => expect(screen.getByText(/Local recording selected \(private path hidden\)/)).toBeTruthy());
    await act(async () => { finish(python); });
    expect(screen.queryByRole("status", { name: "Speech readiness summary" })).toBeNull();
    expect(mocks.invoke.mock.calls.map(([name]) => name)).toEqual(["diagnose_engine"]);
    expect(document.body.textContent).not.toContain("private-account");
  });
});

describe("local session inference configuration", () => {
  const python = "C:\\Users\\private-account\\speech-env\\Scripts\\python.exe";
  const source = "C:\\Users\\private-account\\KathaSvara\\services\\inference";

  it("lets users select a trusted Python interpreter and inference source without saving paths", async () => {
    mocks.open.mockResolvedValueOnce(python).mockResolvedValueOnce(source);
    mocks.invoke.mockResolvedValue(undefined);
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Choose Python and inference folder" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      "configure_local_inference", { pythonPath: python, inferenceDir: source },
    ));
    expect(screen.getByText(/Local Python and sources selected for this app session/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("private-account");
    expect(JSON.stringify(window.localStorage)).not.toContain("private-account");
    expect(mocks.invoke).not.toHaveBeenCalledWith("synthesize", expect.anything());
    expect(mocks.invoke).not.toHaveBeenCalledWith("probe_tts_runtime", expect.anything());
  });

  it("does not change runtime configuration when the folder dialog is cancelled", async () => {
    mocks.open.mockResolvedValueOnce(python).mockResolvedValueOnce(null);
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Choose Python and inference folder" }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(2));
    expect(mocks.invoke).not.toHaveBeenCalledWith("configure_local_inference", expect.anything());
    expect(screen.getByText(/Launcher-provided Python and source discovery/)).toBeTruthy();
  });

  it("keeps private native errors out of Settings on invalid selection", async () => {
    mocks.open.mockResolvedValueOnce(python).mockResolvedValueOnce(source);
    mocks.invoke.mockRejectedValueOnce(new Error("C:\\Users\\private-account\\missing.exe"));
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Choose Python and inference folder" }));
    await waitFor(() => expect(screen.getByText(/Could not configure the local Python runtime/)).toBeTruthy());
    expect(document.body.textContent).not.toContain("private-account");
    expect(screen.getByText(/Launcher-provided Python and source discovery/)).toBeTruthy();
  });

  it("clears the selected interpreter without changing system environment variables", async () => {
    mocks.open.mockResolvedValueOnce(python).mockResolvedValueOnce(source);
    mocks.invoke.mockResolvedValue(undefined);
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Choose Python and inference folder" }));
    const clear = await screen.findByRole("button", { name: "Clear session runtime selection" });
    fireEvent.click(clear);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("clear_local_inference"));
    expect(screen.getByText(/Launcher-provided Python and source discovery/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("private-account");
    expect(JSON.stringify(window.localStorage)).not.toContain("private-account");
  });
});

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


describe("contradictory imported-runtime readiness results", () => {
  it("never marks setup ready when the worker claims success but an import failed", async () => {
    mocks.invoke.mockResolvedValue({
      ...GOOD_IMPORTS,
      preflight_ok: true,
      imports_ok: false,
      checks: { ...GOOD_IMPORTS.checks, torch: "import_failed" },
      next_action_code: "run_real_hindi_smoke",
      next_action: "Pretend everything works",
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", {
      name: "Verify speech library imports (no model load)",
    }));
    const report = await screen.findByRole("status", { name: "TTS import probe result" });
    expect(within(report).getByText(/TTS preflight: Setup needs attention/)).toBeTruthy();
    expect(within(report).getByText(/Recommended next step:/).parentElement?.textContent)
      .toContain("Update the local KathaSvara inference sources");
    expect(report.textContent).not.toContain("Pretend everything works");
    expect(mocks.invoke).not.toHaveBeenCalledWith("synthesize", expect.anything());
  });

  it("guidance remains blocked if a final probe contradicts its own success flag", async () => {
    const python = {
      python_311: true, python_version: "3.11.11", platform: "Windows",
      dependencies: { numpy: true, soundfile: true, torch: true, chatterbox: true },
      dependencies_present: true, model_weights_verified: false,
      audio_synthesis_verified: false, help: "No model loaded",
    };
    const wav = {
      status: "passed", failed_stage: null, temporary_wav_roundtrip_ok: true,
      model_loaded: false, hindi_listening_verified: false,
      audio_playback_verified: false, help: "Synthetic WAV test passed",
    };
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "diagnose_engine") return python;
      if (command === "probe_audio_io") return wav;
      if (command === "probe_tts_runtime") return {
        ...GOOD_IMPORTS, preflight_ok: true, imports_ok: false,
        checks: { ...GOOD_IMPORTS.checks, torch: "import_failed" },
      };
      throw new Error("Unexpected command");
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Check speech readiness (no model load)" }));
    const summary = await screen.findByRole("status", { name: "Speech readiness summary" });
    expect(within(summary).getByText("Setup needs attention")).toBeTruthy();
    expect(within(summary).getByText(/Real Hindi narration, model weights and speaker playback verified:/)).toBeTruthy();
    expect(mocks.invoke.mock.calls.map(([name]) => name))
      .toEqual(["diagnose_engine", "probe_audio_io", "probe_tts_runtime"]);
    expect(mocks.invoke).not.toHaveBeenCalledWith("synthesize", expect.anything());
  });
});

describe("privacy boundary for individual Settings diagnostics", () => {
  const privateFragment = "private-folder-DO-NOT-DISPLAY";

  it("renders only allowlisted import components and fixed action guidance", async () => {
    mocks.invoke.mockResolvedValue({
      ...GOOD_IMPORTS,
      preflight_ok: false,
      next_action_code: "repair_tts_imports",
      next_action: "C:\\Users\\private-folder-DO-NOT-DISPLAY\\voice.wav",
      help: "Sensitive runtime detail private-folder-DO-NOT-DISPLAY",
      checks: {
        ...GOOD_IMPORTS.checks,
        "C:\\Users\\private-folder-DO-NOT-DISPLAY\\module.py": "import_failed",
      },
      tts_device_mode: "C:\\Users\\private-folder-DO-NOT-DISPLAY",
      device_configuration_valid: false,
      tts_model_variant: "private-folder-DO-NOT-DISPLAY",
      model_configuration_valid: false,
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", {
      name: "Verify speech library imports (no model load)",
    }));
    const report = await screen.findByRole("status", { name: "TTS import probe result" });
    const recommendation = within(report).getByText(/Recommended next step:/);
    expect(recommendation.parentElement?.textContent).toContain("Repair the failed speech packages");
    expect(within(report).getByText(/Invalid override — use auto or cpu/)).toBeTruthy();
    expect(within(report).getByText(/Invalid override — use v2 or v3/)).toBeTruthy();
    expect(within(report).getByText(/Model weights \/ real Hindi audio verified:/)).toBeTruthy();
    expect(report.textContent).not.toContain(privateFragment);
    expect(mocks.invoke).not.toHaveBeenCalledWith("synthesize", expect.anything());
  });

  it("uses fallback text for a worker returning an unknown action code", async () => {
    mocks.invoke.mockResolvedValue({
      ...GOOD_IMPORTS,
      preflight_ok: false,
      next_action_code: "C:\\Users\\private-folder-DO-NOT-DISPLAY",
      next_action: "Leak: private-folder-DO-NOT-DISPLAY",
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", {
      name: "Verify speech library imports (no model load)",
    }));
    const report = await screen.findByRole("status", { name: "TTS import probe result" });
    expect(within(report).getByText(/Recommended next step:/).parentElement?.textContent)
      .toContain("Update the local KathaSvara inference sources");
    expect(report.textContent).not.toContain(privateFragment);
  });

  it("redacts Python and import-probe exceptions instead of echoing local paths", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("C:\\Users\\private-folder-DO-NOT-DISPLAY\\python.exe"));
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Inspect local TTS setup" }));
    await waitFor(() => expect(screen.getByText(/Local diagnostic unavailable/)).toBeTruthy());
    expect(document.body.textContent).not.toContain(privateFragment);

    mocks.invoke.mockRejectedValueOnce(new Error("C:\\Users\\private-folder-DO-NOT-DISPLAY\\voice.wav"));
    fireEvent.click(screen.getByRole("button", {
      name: "Verify speech library imports (no model load)",
    }));
    await waitFor(() => expect(screen.getByText(/TTS import probe could not run/)).toBeTruthy());
    expect(document.body.textContent).not.toContain(privateFragment);
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
