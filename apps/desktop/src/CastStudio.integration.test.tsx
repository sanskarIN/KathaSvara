// @vitest-environment jsdom
// SPDX-License-Identifier: MPL-2.0
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CastStudio from "./CastStudio";
import { defaultVoice, type StoryV2 } from "./lib/story_v2";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
// The pronunciation editor has its own unit tests. Exercise the containing
// scene/render UX without loading another set of asynchronous preview controls.
vi.mock("./PronunciationStudio", () => ({ default: () => null }));

const ID = "123e4567-e89b-42d3-a456-426614174000";

function story(): StoryV2 {
  return {
    schema_version: 2,
    id: ID,
    title: "नीलकुंड की कहानी",
    text: "Narrator: नमस्कार।",
    pronunciation_glossary: [],
    characters: [{
      id: "narrator", name: "Narrator", description: "", voice: defaultVoice(),
    }],
    scenes: [{
      id: "scene-one", title: "प्रथम दृश्य", notes: "",
      segments: [{
        id: "line-one", kind: "speech", speaker_id: "narrator",
        original_text: "नमस्कार।", spoken_text: "नमस्कार।",
        status: "pending", audio_ref: null, duration_seconds: null, source_label: null,
      }],
    }],
  };
}

function generatedAudio() {
  return {
    audio_id: ID, data_url: "data:audio/wav;base64,UklGRg==",
    preview_available: true, duration_seconds: 1.25, sample_rate: 24_000,
    chunks: 1, file_bytes: 60200,
    segment_timings: [{
      segment_id: "line-one", start_seconds: 0, end_seconds: 1.25,
      effective_text: "नमस्कार।",
    }],
  };
}

function inspectedAudio() {
  return {
    format: "kathasvara-wav-structural-inspection", schema_version: 1,
    structure_valid: true, duration_seconds: 1.25, file_bytes: 60200,
    sha256: "a".repeat(64), model_loaded: false, hindi_listening_verified: false,
    distinct_voices_verified: false, human_review_required: true,
    level_hints: {
      rms_dbfs: -21.5, peak_dbfs: -3.0, clipped_sample_percentage: 0,
      near_silence_hint: false, possible_clipping_hint: false,
      long_internal_pause_hint: false, longest_internal_quiet_span_seconds: 0,
      longest_internal_quiet_span_start_seconds: null, signal_review_required: false,
    },
  };
}

function mount(doc = story()) {
  const onMessage = vi.fn();
  const onChange = vi.fn();
  const view = render(<CastStudio document={doc} onChange={onChange} onMessage={onMessage} />);
  return { doc, onMessage, onChange, ...view };
}

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.save.mockReset();
  vi.stubGlobal("crypto", { randomUUID: () => ID });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("real React/Tauri desktop controls with mocked IPC (no voice model)", () => {
  it("audits scenes without rendering or voice loading, then exports count-only JSON", async () => {
    const doc = story();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "audit_production") {
        return {
          total_scenes: 1, ready_scenes: 1, full_story_ready: true,
          full_story_reason: "ready", full_story_chunks: 1,
          scenes: [{ scene_id: "scene-one", ready: true, reason: "ready",
            segments: 1, chunks: 1 }],
          model_loaded: false, audio_verified: false, distinct_voices_verified: false,
        };
      }
      if (command === "export_production_manifest") return undefined;
      throw new Error("Unexpected Tauri command: " + command);
    });
    mocks.save.mockResolvedValue("/test/new-audit.json");
    mount(doc);
    fireEvent.click(screen.getByRole("button", { name: /Audit scene readiness/ }));
    expect(await screen.findByRole("region", { name: "Production readiness audit" }))
      .toBeTruthy();
    expect(mocks.invoke).toHaveBeenCalledWith("audit_production", { project: doc });
    expect(mocks.invoke.mock.calls.some(([command]) => command === "render_story_v2")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Export privacy-safe audit JSON" }));
    await waitFor(() => expect(mocks.invoke)
      .toHaveBeenCalledWith("export_production_manifest", expect.objectContaining({
        destination: "/test/new-audit.json",
      })));
    const report = mocks.invoke.mock.calls.find(([name]) => name === "export_production_manifest")?.[1];
    expect(report.content).toContain('"model_loaded": false');
    expect(report.content).not.toContain("नीलकुंड");
    expect(report.content).not.toContain("नमस्कार");
    expect(report.content).not.toContain("scene-one");
  });

  it("shows model-free generated WAV hints without completing any human checklist step", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "render_story_v2") return generatedAudio();
      if (command === "inspect_generated_audio") return inspectedAudio();
      throw new Error("Unexpected Tauri command: " + command);
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Generate story dialogue WAV" }));
    await screen.findByRole("button", { name: "Inspect generated WAV (no model)" });
    fireEvent.click(screen.getByRole("button", { name: "Inspect generated WAV (no model)" }));
    const report = await screen.findByRole("region", {
      name: "Generated WAV level and pause inspection",
    });
    expect(report.textContent).toContain("No basic level or long-gap warning found");
    expect(report.textContent).toContain("human listening still required");
    expect(mocks.invoke).toHaveBeenCalledWith("inspect_generated_audio", { audioId: ID });
    expect(screen.getByText(/Human review incomplete/)).toBeTruthy();
    expect(screen.getAllByRole("checkbox").every(element =>
      !(element as HTMLInputElement).checked)).toBe(true);
    expect(mocks.invoke.mock.calls.filter(([name]) => name === "inspect_generated_audio"))
      .toHaveLength(1);
  });

  it("ignores delayed WAV QA inspection after the preview was discarded", async () => {
    let finish: (result: unknown) => void = () => { throw new Error("No WAV inspect started"); };
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "render_story_v2") return Promise.resolve(generatedAudio());
      if (command === "inspect_generated_audio") {
        return new Promise(resolve => { finish = resolve; });
      }
      if (command === "discard_audio") return Promise.resolve(undefined);
      return Promise.reject(new Error("Unexpected Tauri command: " + command));
    });
    const { onMessage } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Generate story dialogue WAV" }));
    await screen.findByRole("button", { name: "Inspect generated WAV (no model)" });
    fireEvent.click(screen.getByRole("button", { name: "Inspect generated WAV (no model)" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      "inspect_generated_audio", { audioId: ID }));
    fireEvent.click(screen.getByRole("button", { name: "Clear preview" }));
    const countBeforeLateResponse = onMessage.mock.calls.length;
    await act(async () => { finish(inspectedAudio()); });
    expect(screen.queryByRole("region", {
      name: "Generated WAV level and pause inspection",
    })).toBeNull();
    expect(onMessage).toHaveBeenCalledTimes(countBeforeLateResponse);
  });

  it("refuses a WAV QA report whose size conflicts with current generated audio", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "render_story_v2") return generatedAudio();
      if (command === "inspect_generated_audio") return {
        ...inspectedAudio(), file_bytes: 60000,
      };
      throw new Error("Unexpected Tauri command: " + command);
    });
    const { onMessage } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Generate story dialogue WAV" }));
    await screen.findByRole("button", { name: "Inspect generated WAV (no model)" });
    fireEvent.click(screen.getByRole("button", { name: "Inspect generated WAV (no model)" }));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith(
      expect.stringContaining("Generated WAV metadata changed")));
    expect(screen.queryByRole("region", {
      name: "Generated WAV level and pause inspection",
    })).toBeNull();
  });

  it("renders a selected scene and pairs WAV/SRT filenames with human QA gating", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "render_story_v2") return generatedAudio();
      if (command === "export_wav" || command === "export_subtitles") return undefined;
      throw new Error("Unexpected Tauri command: " + command);
    });
    mocks.save
      .mockResolvedValueOnce("/test/new.wav")
      .mockResolvedValueOnce("/test/new.srt");
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Generate selected scene" }));
    expect(await screen.findByRole("region", { name: "Manual narration quality checklist" }))
      .toBeTruthy();
    expect(mocks.invoke).toHaveBeenCalledWith("render_story_v2",
      expect.objectContaining({ selectedSceneIds: ["scene-one"],
        selectedSegmentIds: null, forceSegmentIds: null }));
    const captions = screen.getByRole("checkbox", {
      name: "I reviewed exported SRT wording and cue timing",
    }) as HTMLInputElement;
    expect(captions.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Export WAV" }));
    await waitFor(() => expect(mocks.invoke)
      .toHaveBeenCalledWith("export_wav", { audioId: ID, destination: "/test/new.wav" }));
    fireEvent.click(screen.getByRole("button", { name: "Export dialogue SRT" }));
    await waitFor(() => expect(mocks.invoke)
      .toHaveBeenCalledWith("export_subtitles", expect.objectContaining({
        destination: "/test/new.srt",
      })));
    expect(mocks.save.mock.calls[0][0].defaultPath).toMatch(/scene-001-.*\.wav$/u);
    expect(mocks.save.mock.calls[1][0].defaultPath).toBe(
      mocks.save.mock.calls[0][0].defaultPath.replace(/\.wav$/u, ".srt"),
    );
    expect((screen.getByRole("checkbox", { name:
      "I reviewed exported SRT wording and cue timing" }) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText(/Human review incomplete/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", {
      name: "I listened to the entire generated WAV (in-app or exported)",
    }));
    fireEvent.click(screen.getByRole("checkbox", {
      name: "I checked Hindi pronunciation and mixed-language words",
    }));
    fireEvent.click(screen.getByRole("checkbox", {
      name: "I checked dialogue order and intended character turns",
    }));
    fireEvent.click(screen.getByRole("checkbox", {
      name: "I reviewed exported SRT wording and cue timing",
    }));
    expect(screen.getByText(/All four items were marked by you/)).toBeTruthy();
    expect(mocks.invoke.mock.calls.some(([command]) => command === "check_engine")).toBe(false);
  });

  it("refuses a stale WAV destination if generated audio is cleared during the dialog", async () => {
    let finishSave: (path: string) => void = () => { throw new Error("Dialog wasn't opened"); };
    mocks.save.mockImplementation(() => new Promise<string>(resolve => { finishSave = resolve; }));
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "render_story_v2") return generatedAudio();
      if (command === "discard_audio") return undefined;
      throw new Error("Unexpected Tauri command: " + command);
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Generate story dialogue WAV" }));
    await screen.findByRole("button", { name: "Export WAV" });
    fireEvent.click(screen.getByRole("button", { name: "Export WAV" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Clear preview" }));
    await act(async () => { finishSave("/test/stale.wav"); });
    expect(mocks.invoke.mock.calls.some(([command]) => command === "export_wav")).toBe(false);
    expect(screen.queryByRole("button", { name: "Export WAV" })).toBeNull();
  });

  it("does not automatically retry; confirmation launches a new full-story render", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "story_render_history") return [{
        job_id: "old-job", story_id: ID, state: "interrupted", done: 1, total: 2,
        updated_at: "2026-10-21T00:00:00Z",
      }];
      if (command === "render_story_v2") return generatedAudio();
      throw new Error("Unexpected Tauri command: " + command);
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Recent render history" }));
    await screen.findByRole("button", { name: "Retry current full story" });
    expect(mocks.invoke.mock.calls.some(([command]) => command === "render_story_v2")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Retry current full story" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mocks.invoke.mock.calls.some(([command]) => command === "render_story_v2")).toBe(false);
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry current full story" }));
    await waitFor(() => expect(mocks.invoke)
      .toHaveBeenCalledWith("render_story_v2", expect.objectContaining({
        selectedSceneIds: null, selectedSegmentIds: null, forceSegmentIds: null,
        jobId: ID,
      })));
  });

  it("ignores a late audit response when the document changes", async () => {
    let finishAudit: (result: unknown) => void = () => { throw new Error("Audit not invoked"); };
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "audit_production") {
        return new Promise(resolve => { finishAudit = resolve; });
      }
      return Promise.reject(new Error("Unexpected Tauri command: " + command));
    });
    const doc = story();
    const { rerender, onChange, onMessage } = mount(doc);
    fireEvent.click(screen.getByRole("button", { name: /Audit scene readiness/ }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      "audit_production", { project: doc }));
    rerender(<CastStudio document={{ ...doc, title: "Edited title" }}
      onChange={onChange} onMessage={onMessage} />);
    await act(async () => {
      finishAudit({
        total_scenes: 1, ready_scenes: 1,
        full_story_ready: true, full_story_reason: "ready", full_story_chunks: 1,
        scenes: [{ scene_id: "scene-one", ready: true, reason: "ready", segments: 1, chunks: 1 }],
        model_loaded: false, audio_verified: false, distinct_voices_verified: false,
      });
    });
    expect(screen.queryByRole("region", { name: "Production readiness audit" })).toBeNull();
  });
});
