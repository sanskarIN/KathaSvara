// @vitest-environment jsdom
// SPDX-License-Identifier: MPL-2.0
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    structure_valid: true, codec: "pcm_s16le", channels: 1,
    sample_rate_hz: 24_000, frames: 30_000,
    duration_seconds: 1.25, file_bytes: 60200,
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


  it("refuses contradictory model-free IPC hints without presenting a clean inspection", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "render_story_v2") return generatedAudio();
      if (command === "inspect_generated_audio") return {
        ...inspectedAudio(),
        level_hints: {
          ...inspectedAudio().level_hints,
          near_silence_hint: true, signal_review_required: false,
        },
      };
      throw new Error("Unexpected Tauri command: " + command);
    });
    const { onMessage } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Generate story dialogue WAV" }));
    await screen.findByRole("button", { name: "Inspect generated WAV (no model)" });
    fireEvent.click(screen.getByRole("button", { name: "Inspect generated WAV (no model)" }));
    await waitFor(() => expect(onMessage.mock.calls.some(([message]) =>
      typeof message === "string" && message.includes("WAV inspection failed")
    )).toBe(true));
    expect(screen.queryByRole("region", {
      name: "Generated WAV level and pause inspection",
    })).toBeNull();
    expect(screen.getByText(/Human review incomplete/)).toBeTruthy();
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
    await act(async () => { finish(inspectedAudio()); });
    expect(screen.queryByRole("region", {
      name: "Generated WAV level and pause inspection",
    })).toBeNull();
    // Clearing the preview may itself complete asynchronously and rightly
    // emit a deletion message. Only the stale inspection's success/failure
    // messages are forbidden after the audio identity has been invalidated.
    expect(onMessage.mock.calls.some(([message]) =>
      typeof message === "string" && (
        message.includes("Local WAV structure and audio-level hints checked") ||
        message.includes("WAV inspection failed")
      ))).toBe(false);
  });

  it("refuses a WAV QA report whose size conflicts with current generated audio", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "render_story_v2") return generatedAudio();
      if (command === "inspect_generated_audio") return {
        ...inspectedAudio(), file_bytes: 60046,
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

  it.each([
    ["WAV", "Export WAV", "export_wav"],
    ["SRT", "Export dialogue SRT", "export_subtitles"],
  ])("does not show stale %s export completion after the WAV is discarded",
    async (_kind, buttonName, command) => {
      let finishExport: (fail: boolean) => void = () => { throw new Error("Export not started"); };
      mocks.save.mockResolvedValue("/test/export.wav");
      mocks.invoke.mockImplementation((name: string) => {
        if (name === "render_story_v2") return Promise.resolve(generatedAudio());
        if (name === command) {
          return new Promise<void>((resolve, reject) => {
            finishExport = (fail: boolean) => {
              if (fail) reject(new Error("old export failure"));
              else resolve();
            };
          });
        }
        if (name === "discard_audio") return Promise.resolve(undefined);
        return Promise.reject(new Error("Unexpected Tauri command: " + name));
      });
      const { onMessage } = mount();
      fireEvent.click(screen.getByRole("button", { name: "Generate story dialogue WAV" }));
      await screen.findByRole("button", { name: buttonName });
      fireEvent.click(screen.getByRole("button", { name: buttonName }));
      await waitFor(() => expect(mocks.invoke.mock.calls.some(([name]) => name === command))
        .toBe(true));
      fireEvent.click(screen.getByRole("button", { name: "Clear preview" }));
      await act(async () => { finishExport(false); });
      expect(screen.queryByRole("region", { name: "Manual narration quality checklist" })).toBeNull();
      expect(onMessage.mock.calls.some(([message]) => typeof message === "string" &&
        (message.includes("exported locally") || message.includes("captions exported")))).toBe(false);
    },
  );

  it.each([
    ["WAV", "Export WAV", "export_wav"],
    ["SRT", "Export dialogue SRT", "export_subtitles"],
  ])("does not display stale %s export failure after a new preview is started",
    async (_kind, buttonName, command) => {
      let failExport: () => void = () => { throw new Error("Export not started"); };
      mocks.save.mockResolvedValue("/test/export.wav");
      mocks.invoke.mockImplementation((name: string) => {
        if (name === "render_story_v2") return Promise.resolve(generatedAudio());
        if (name === command) {
          return new Promise<void>((_resolve, reject) => {
            failExport = () => reject(new Error("old export failure"));
          });
        }
        if (name === "discard_audio") return Promise.resolve(undefined);
        return Promise.reject(new Error("Unexpected Tauri command: " + name));
      });
      const { onMessage } = mount();
      fireEvent.click(screen.getByRole("button", { name: "Generate story dialogue WAV" }));
      await screen.findByRole("button", { name: buttonName });
      fireEvent.click(screen.getByRole("button", { name: buttonName }));
      await waitFor(() => expect(mocks.invoke.mock.calls.some(([name]) => name === command))
        .toBe(true));
      fireEvent.click(screen.getByRole("button", { name: "Clear preview" }));
      fireEvent.click(screen.getByRole("button", { name: "Generate story dialogue WAV" }));
      await screen.findByRole("region", { name: "Manual narration quality checklist" });
      await act(async () => { failExport(); });
      expect(onMessage.mock.calls.some(([message]) =>
        typeof message === "string" && message.includes("old export failure"))).toBe(false);
      if (command === "export_subtitles") {
        expect((screen.getByRole("checkbox", {
          name: "I reviewed exported SRT wording and cue timing",
        }) as HTMLInputElement).disabled).toBe(true);
      }
    },
  );

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

  it("shows a bounded recovery explanation without echoing raw exception data", async () => {
    const privateText = "/Users/private/story/निजी Chatterbox MODEL_SECRET";
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "story_render_history") return [{
        job_id: "stopped-job", story_id: ID, state: "failed",
        done: 1, total: 3, failure_code: "storage",
        updated_at: "2026-10-21T00:00:00Z",
      }, {
        job_id: "legacy-job", story_id: ID, state: "failed",
        done: 0, total: 3, failure_code: privateText,
        updated_at: "2026-10-21T00:00:00Z",
      }];
      throw new Error("Unexpected Tauri command: " + command);
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Recent render history" }));
    await screen.findByText(/Review free space and folder permissions/);
    expect(screen.getByText(/exact reason is not stored/)).toBeTruthy();
    expect(screen.queryByText(/MODEL_SECRET/)).toBeNull();
    expect(screen.queryByText(/निजी/)).toBeNull();
    expect(screen.getAllByRole("button", { name: "Retry current full story" }))
      .toHaveLength(2);
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

  it("does not resurrect old history after switching stories while the IPC read is pending", async () => {
    let finishHistory: (records: unknown) => void = () => { throw new Error("History not requested"); };
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "story_render_history") {
        return new Promise(resolve => { finishHistory = resolve; });
      }
      return Promise.reject(new Error("Unexpected Tauri command: " + command));
    });
    const doc = story();
    const { rerender, onChange, onMessage } = mount(doc);
    fireEvent.click(screen.getByRole("button", { name: "Recent render history" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      "story_render_history", { storyId: ID },
    ));
    expect(screen.getByRole("button", { name: "Reading history…" })).toBeTruthy();
    rerender(<CastStudio document={{ ...doc, id: "new-story", title: "New story" }}
      onChange={onChange} onMessage={onMessage} />);
    expect(screen.getByRole("button", { name: "Recent render history" })).toBeTruthy();
    await act(async () => {
      finishHistory([{
        job_id: "previous-job", story_id: ID, state: "failed", done: 1, total: 2,
        updated_at: "2026-10-21T00:00:00Z",
      }]);
    });
    expect(screen.queryByRole("button", { name: "Forget record" })).toBeNull();
    expect(onMessage.mock.calls.some(([message]) =>
      typeof message === "string" && message.includes("Local history loaded"))).toBe(false);
  });

  it("does not restore an old history response after beginning a new narration", async () => {
    let finishHistory: (records: unknown) => void = () => { throw new Error("History not requested"); };
    let finishRender: (audio: unknown) => void = () => { throw new Error("Render not requested"); };
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "story_render_history") {
        return new Promise(resolve => { finishHistory = resolve; });
      }
      if (command === "render_story_v2") {
        return new Promise(resolve => { finishRender = resolve; });
      }
      return Promise.reject(new Error("Unexpected Tauri command: " + command));
    });
    const { onMessage } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Recent render history" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      "story_render_history", { storyId: ID },
    ));
    fireEvent.click(screen.getByRole("button", { name: "Generate story dialogue WAV" }));
    await waitFor(() => expect(mocks.invoke.mock.calls.some(([command]) =>
      command === "render_story_v2")).toBe(true));
    await act(async () => {
      finishHistory([{
        job_id: "old-job", story_id: ID, state: "interrupted", done: 1, total: 2,
        updated_at: "2026-10-21T00:00:00Z",
      }]);
    });
    expect(screen.queryByRole("button", { name: "Retry current full story" })).toBeNull();
    expect(onMessage.mock.calls.some(([message]) =>
      typeof message === "string" && message.includes("Local history loaded"))).toBe(false);
    await act(async () => { finishRender(generatedAudio()); });
  });

  it("does not show a stale forget response after switching to another story", async () => {
    let finishForget: () => void = () => { throw new Error("Forget not requested"); };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "story_render_history") return Promise.resolve([{
        job_id: "old-job", story_id: ID, state: "failed", done: 1, total: 2,
        updated_at: "2026-10-21T00:00:00Z",
      }]);
      if (command === "forget_render_journal") {
        return new Promise<void>(resolve => { finishForget = resolve; });
      }
      return Promise.reject(new Error("Unexpected Tauri command: " + command));
    });
    const doc = story();
    const { rerender, onChange, onMessage } = mount(doc);
    fireEvent.click(screen.getByRole("button", { name: "Recent render history" }));
    await screen.findByRole("button", { name: "Forget record" });
    fireEvent.click(screen.getByRole("button", { name: "Forget record" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      "forget_render_journal", { jobId: "old-job", storyId: ID },
    ));
    rerender(<CastStudio document={{ ...doc, id: "next-story" }}
      onChange={onChange} onMessage={onMessage} />);
    await act(async () => { finishForget(); });
    expect(screen.queryByRole("button", { name: "Forget record" })).toBeNull();
    expect(onMessage.mock.calls.some(([message]) =>
      typeof message === "string" && message.includes("bookkeeping markers removed"))).toBe(false);
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

  it("shows exact generated Hindi subtitle cues and seeks locally without exporting or approving review", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "render_story_v2") return generatedAudio();
      if (command === "discard_audio") return undefined;
      throw new Error("Unexpected Tauri command: " + command);
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Generate story dialogue WAV" }));
    await screen.findByRole("button", { name: "Preview dialogue cues" });
    fireEvent.click(screen.getByRole("button", { name: "Preview dialogue cues" }));
    const panel = screen.getByRole("region", { name: "Dialogue subtitle cue preview" });
    expect(within(panel).getByText("नमस्कार।")).toBeTruthy();
    expect(within(panel).getByText("0.000s → 1.250s")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Jump to cue 1" }));
    expect((screen.getByLabelText("Generated dialogue preview") as HTMLAudioElement).currentTime)
      .toBe(0);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.invoke.mock.calls.some(([name]) => name === "export_subtitles")).toBe(false);
    expect((screen.getByRole("checkbox", {
      name: "I reviewed exported SRT wording and cue timing",
    }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Clear preview" }));
    expect(screen.queryByRole("region", { name: "Dialogue subtitle cue preview" })).toBeNull();
  });

  it("rejects invalid duplicate generated cue identities instead of showing false captions", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "render_story_v2") {
        const current = generatedAudio();
        return { ...current, segment_timings: [
          ...current.segment_timings,
          { segment_id: "line-one", start_seconds: 1.5, end_seconds: 2,
            effective_text: "दूसरा वाक्य" },
        ] };
      }
      throw new Error("Unexpected Tauri command: " + command);
    });
    const { onMessage } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Generate story dialogue WAV" }));
    await screen.findByRole("button", { name: "Preview dialogue cues" });
    fireEvent.click(screen.getByRole("button", { name: "Preview dialogue cues" }));
    expect(screen.queryByRole("region", { name: "Dialogue subtitle cue preview" })).toBeNull();
    expect(onMessage.mock.calls.some(([message]) =>
      typeof message === "string" && message.includes("invalid generated subtitle timings"))).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
  });


  it("searches and pages a 12-line Hindi cue sequence without changing export or human review", async () => {
    const doc = story();
    const seed = doc.scenes[0].segments[0];
    doc.scenes[0].segments = Array.from({ length: 12 }, (_, i) => ({
      ...seed, id: "line-" + i, spoken_text: i === 11 ? "विशेष अंतिम संवाद।" : "सामान्य संवाद।",
    }));
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "render_story_v2") return {
        ...generatedAudio(), duration_seconds: 12.5,
        segment_timings: doc.scenes[0].segments.map((segment, i) => ({
          segment_id: segment.id, start_seconds: i,
          end_seconds: i + 0.5, effective_text: segment.spoken_text,
        })),
      };
      throw new Error("Unexpected Tauri command: " + command);
    });
    mount(doc);
    fireEvent.click(screen.getByRole("button", { name: "Generate story dialogue WAV" }));
    await screen.findByRole("button", { name: "Preview dialogue cues" });
    fireEvent.click(screen.getByRole("button", { name: "Preview dialogue cues" }));
    const panel = screen.getByRole("region", { name: "Dialogue subtitle cue preview" });
    expect(within(panel).getByRole("button", { name: "Jump to cue 10" })).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Jump to cue 12" })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Next cues" }));
    expect(within(panel).getByRole("button", { name: "Jump to cue 12" })).toBeTruthy();
    const search = within(panel).getByRole("searchbox", { name: "Find dialogue cue text" });
    fireEvent.change(search, { target: { value: "विशेष" } });
    expect(within(panel).getByText("विशेष अंतिम संवाद।")).toBeTruthy();
    expect(within(panel).getByText(/1 of 12 cues shown/)).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Next cues" })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Jump to cue 12" }));
    expect((screen.getByLabelText("Generated dialogue preview") as HTMLAudioElement).currentTime)
      .toBe(11);
    fireEvent.change(search, { target: { value: "no matching words" } });
    expect(within(panel).getByText(/No matching dialogue cues/)).toBeTruthy();
    fireEvent.change(search, { target: { value: "" } });
    expect(within(panel).getByText(/12 of 12 cues shown/)).toBeTruthy();
    expect(mocks.save).not.toHaveBeenCalled();
    expect((screen.getByRole("checkbox", {
      name: "I reviewed exported SRT wording and cue timing",
    }) as HTMLInputElement).disabled).toBe(true);
  });

  it("refuses an SRT export if an apparently valid last cue exceeds generated WAV duration", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "render_story_v2") return {
        ...generatedAudio(),
        segment_timings: [{
          segment_id: "line-one", start_seconds: 0, end_seconds: 1.35,
          effective_text: "नमस्कार।",
        }],
      };
      throw new Error("Unexpected Tauri command: " + command);
    });
    const { onMessage } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Generate story dialogue WAV" }));
    await screen.findByRole("button", { name: "Export dialogue SRT" });
    fireEvent.click(screen.getByRole("button", { name: "Export dialogue SRT" }));
    await waitFor(() => expect(onMessage.mock.calls.some(([message]) =>
      typeof message === "string" && message.includes("invalid generated subtitle timings"))).toBe(true));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.invoke.mock.calls.some(([command]) => command === "export_subtitles")).toBe(false);
  });


  it("does not replace the current story with an obsolete dialogue parse response", async () => {
    // The fixture already contains scenes; reparsing requires explicit consent.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let finishParse: (result: unknown) => void = () => { throw new Error("Parser not called"); };
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "parse_dialogue") {
        return new Promise(resolve => { finishParse = resolve; });
      }
      return Promise.reject(new Error("Unexpected Tauri command: " + command));
    });
    const doc = story();
    const { rerender, onChange, onMessage } = mount(doc);
    fireEvent.click(screen.getByRole("button", { name: "Parse labeled Hindi script" }));
    await waitFor(() => expect(mocks.invoke.mock.calls.some(([name]) => name === "parse_dialogue"))
      .toBe(true));
    const next = { ...doc, id: "new-story-id", title: "अलग कहानी" };
    rerender(<CastStudio document={next} onChange={onChange} onMessage={onMessage} />);
    await act(async () => { finishParse({
      ok: true, result: { ...doc, title: "पुरानी पार्स की गई कहानी" },
      unresolved: [], distinct_voices_verified: false,
    }); });
    expect(onChange).not.toHaveBeenCalled();
    expect(onMessage.mock.calls.some(([message]) => typeof message === "string" &&
      message.includes("Parsed "))).toBe(false);
    expect(mocks.invoke.mock.calls.some(([name]) => name === "discard_audio")).toBe(false);
    expect(screen.getByRole("button", { name: "Parse labeled Hindi script" })).toBeTruthy();
  });

  it("does not mark a newer document as saved after an old save resolves", async () => {
    let finishSave: (result: unknown) => void = () => { throw new Error("Save not called"); };
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "save_story_v2") {
        return new Promise(resolve => { finishSave = resolve; });
      }
      return Promise.reject(new Error("Unexpected Tauri command: " + command));
    });
    const doc = story();
    const { rerender, onChange, onMessage } = mount(doc);
    fireEvent.click(screen.getByRole("button", { name: "Save cast and scenes" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      "save_story_v2", expect.objectContaining({ project: doc }),
    ));
    rerender(<CastStudio document={{ ...doc, title: "नई संपादित कहानी" }}
      onChange={onChange} onMessage={onMessage} />);
    await act(async () => { finishSave({ ...doc, title: "पुरानी बचाई हुई कहानी" }); });
    expect(onChange).not.toHaveBeenCalled();
    expect(onMessage.mock.calls.some(([message]) =>
      typeof message === "string" && message.includes("saved atomically"))).toBe(false);
    expect(screen.getByRole("button", { name: "Save cast and scenes" })).toBeTruthy();
  });

  it("does not replace another story when a delayed load completes", async () => {
    let finishLoad: (result: unknown) => void = () => { throw new Error("Load not called"); };
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "load_story_v2") {
        return new Promise(resolve => { finishLoad = resolve; });
      }
      return Promise.reject(new Error("Unexpected Tauri command: " + command));
    });
    const doc = story();
    const { rerender, onChange, onMessage } = mount(doc);
    fireEvent.click(screen.getByRole("button", { name: "Load saved v2" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("load_story_v2", { id: ID }));
    rerender(<CastStudio document={{ ...doc, id: "another-story", title: "दूसरी कहानी" }}
      onChange={onChange} onMessage={onMessage} />);
    await act(async () => { finishLoad({ ...doc, title: "पुरानी कहानी" }); });
    expect(onChange).not.toHaveBeenCalled();
    expect(onMessage.mock.calls.some(([message]) => typeof message === "string" &&
      message.includes("Saved v2 story loaded"))).toBe(false);
    expect(mocks.invoke.mock.calls.some(([name]) => name === "discard_audio")).toBe(false);
  });

  it("does not echo stale parse failures after switching stories", async () => {
    // The fixture already contains scenes; reparsing requires explicit consent.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let failParse: (reason: Error) => void = () => { throw new Error("Parse not called"); };
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "parse_dialogue") {
        return new Promise((_resolve, reject) => { failParse = reject; });
      }
      return Promise.reject(new Error("Unexpected Tauri command: " + command));
    });
    const doc = story();
    const { rerender, onChange, onMessage } = mount(doc);
    fireEvent.click(screen.getByRole("button", { name: "Parse labeled Hindi script" }));
    await waitFor(() => expect(mocks.invoke.mock.calls.some(([name]) => name === "parse_dialogue"))
      .toBe(true));
    rerender(<CastStudio document={{ ...doc, id: "new-story", title: "दूसरी कहानी" }}
      onChange={onChange} onMessage={onMessage} />);
    await act(async () => { failParse(new Error("old private source path")); });
    expect(onMessage.mock.calls.some(([message]) => typeof message === "string" &&
      message.includes("old private source path"))).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });


  it("lets a new story parse start immediately and prevents an older completion unlocking it", async () => {
    // The fixture already contains scenes; reparsing requires explicit consent.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const finish: Array<(result: unknown) => void> = [];
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "parse_dialogue") {
        return new Promise(resolve => { finish.push(resolve); });
      }
      return Promise.reject(new Error("Unexpected Tauri command: " + command));
    });
    const doc = story();
    const { rerender, onChange, onMessage } = mount(doc);
    fireEvent.click(screen.getByRole("button", { name: "Parse labeled Hindi script" }));
    await waitFor(() => expect(finish).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Processing…" })).toBeTruthy();

    const next = { ...doc, id: "second-story", title: "नई कहानी" };
    rerender(<CastStudio document={next} onChange={onChange} onMessage={onMessage} />);
    expect(screen.getByRole("button", { name: "Parse labeled Hindi script" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Parse labeled Hindi script" }));
    await waitFor(() => expect(finish).toHaveLength(2));
    await act(async () => {
      finish[0]({
        ok: true, result: { ...doc, title: "stale story" },
        unresolved: [], distinct_voices_verified: false,
      });
    });
    expect(screen.getByRole("button", { name: "Processing…" })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    expect(onMessage.mock.calls.some(([message]) =>
      typeof message === "string" && message.includes("stale story"))).toBe(false);

    await act(async () => {
      finish[1]({
        ok: true, result: { ...next, title: "अभी की कहानी" },
        unresolved: [], distinct_voices_verified: false,
      });
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      id: "second-story", title: "अभी की कहानी",
    }));
    expect(screen.getByRole("button", { name: "Parse labeled Hindi script" })).toBeTruthy();
  });


  it("splits the current Hindi scene before a later line and preserves the complete narration", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "550e8400-e29b-41d4-a716-446655440003" });
    const doc = story();
    const first = doc.scenes[0].segments[0];
    doc.scenes[0].notes = "दृश्य निर्देश, बोलना नहीं";
    doc.scenes[0].segments.push(
      { ...first, id: "stage-one", kind: "direction", speaker_id: null,
        original_text: "[घंटी बजती है]", spoken_text: "", audio_ref: null,
        duration_seconds: null },
      { ...first, id: "line-two", original_text: "दूसरी पंक्ति।",
        spoken_text: "दूसरी पंक्ति।", audio_ref: "previous-audio" },
    );
    const { rerender, onChange, onMessage } = mount(doc);
    expect(screen.queryByRole("button", { name: "Split scene before line line-one" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Split scene before line stage-one" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const update = onChange.mock.calls[0][0] as (old: StoryV2) => StoryV2;
    const next = update(doc);
    expect(next.scenes.map(scene => scene.title))
      .toEqual(["प्रथम दृश्य", "प्रथम दृश्य (part 2)"]);
    expect(next.scenes.map(scene => scene.segments.map(segment => segment.id)))
      .toEqual([["line-one"], ["stage-one", "line-two"]]);
    expect(next.scenes[1].segments[1]).toBe(doc.scenes[0].segments[2]);
    expect(next.scenes[1].notes).toBe("");
    expect(next.scenes[0].notes).toBe("दृश्य निर्देश, बोलना नहीं");
    expect(next.text).toBe(doc.text);
    expect(next.characters).toBe(doc.characters);
    expect(onMessage).toHaveBeenCalledWith(expect.stringContaining("Save the story"));
    expect(screen.getByText(/Unsaved character or scene changes/)).toBeTruthy();
    expect(mocks.invoke.mock.calls.some(([command]) => command === "render_story_v2")).toBe(false);
    rerender(<CastStudio document={next} onChange={onChange} onMessage={onMessage} />);
    expect(screen.getByRole("textbox", { name: "Scene production notes (not spoken)" }))
      .toHaveProperty("value", "");
  });
  it("blocks scene splitting when 200 scenes are already present", () => {
    const doc = story();
    const first = doc.scenes[0].segments[0];
    doc.scenes = Array.from({ length: 200 }, (_, i) => ({
      id: "scene-" + i, title: "दृश्य " + i, notes: "",
      segments: i === 0 ? [first, { ...first, id: "second-line" }] : [],
    }));
    const { onChange, onMessage } = mount(doc);
    const split = screen.getByRole("button", { name: "Split scene before line second-line" });
    expect((split as HTMLButtonElement).disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("reorders scene dialogue and stage directions without regenerating audio or editing the original script", () => {
    const doc = story();
    const speech = doc.scenes[0].segments[0];
    doc.scenes[0].segments = [
      speech,
      { ...speech, id: "direction-one", kind: "direction", speaker_id: null,
        original_text: "[दरवाज़ा खुलता है]", spoken_text: "" },
      { ...speech, id: "line-two", original_text: "दूसरा वाक्य।",
        spoken_text: "दूसरा वाक्य।" },
    ];
    const { onChange } = mount(doc);
    expect((screen.getByRole("button", { name: "Move line line-one up" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect((screen.getByRole("button", { name: "Move line line-two down" }) as HTMLButtonElement).disabled)
      .toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Move line line-two up" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const update = onChange.mock.calls[0][0] as (doc: StoryV2) => StoryV2;
    const next = update(doc);
    expect(next.scenes[0].segments.map(line => line.id))
      .toEqual(["line-one", "line-two", "direction-one"]);
    expect(next.scenes[0].segments[1].spoken_text).toBe("दूसरा वाक्य।");
    expect(next.scenes[0].segments[0].speaker_id).toBe("narrator");
    expect(next.text).toBe(doc.text);
    expect(screen.getByText(/Unsaved character or scene changes/)).toBeTruthy();
    expect(mocks.invoke.mock.calls.some(([command]) => command === "render_story_v2")).toBe(false);
  });


  it("disables new and duplicated characters when native cast capacity is reached", () => {
    const doc = story();
    doc.characters.push(...Array.from({ length: 99 }, (_, i) => ({
      id: `character-${i}`, name: `पात्र ${i}`, description: "", voice: defaultVoice(),
    })));
    const { onChange, onMessage } = mount(doc);
    const duplicates = screen.getAllByRole("button", { name: "Duplicate voice profile" });
    expect(duplicates).toHaveLength(100);
    expect(duplicates.every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "New character name" }), {
      target: { value: "नया पात्र" },
    });
    expect((screen.getByRole("button", { name: "+ Add" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("duplicates the selected Hindi scene with new line identities and pending audio", () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn()
      .mockReturnValueOnce("550e8400-e29b-41d4-a716-446655440001")
      .mockReturnValueOnce("550e8400-e29b-41d4-a716-446655440002") });
    const doc = story();
    doc.scenes[0].segments[0].audio_ref = "completed-audio-placeholder";
    doc.scenes[0].segments[0].status = "completed";
    doc.scenes[0].segments[0].duration_seconds = 1.25;
    const { onChange, onMessage } = mount(doc);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate scene (fresh audio)" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const update = onChange.mock.calls[0][0] as (old: StoryV2) => StoryV2;
    const result = update(doc);
    expect(result.scenes).toHaveLength(2);
    expect(result.scenes[1].title).toBe("प्रथम दृश्य (copy)");
    expect(result.scenes[1].id).not.toBe(doc.scenes[0].id);
    expect(result.scenes[1].segments[0].id).not.toBe(doc.scenes[0].segments[0].id);
    expect(result.scenes[1].segments[0].spoken_text).toBe("नमस्कार।");
    expect(result.scenes[1].segments[0].speaker_id).toBe("narrator");
    expect(result.scenes[1].segments[0].audio_ref).toBeNull();
    expect(result.scenes[1].segments[0].duration_seconds).toBeNull();
    expect(result.scenes[1].segments[0].status).toBe("pending");
    expect(result.text).toBe(doc.text);
    expect(doc.scenes[0].segments[0].audio_ref).toBe("completed-audio-placeholder");
    expect(onMessage).toHaveBeenCalledWith(expect.stringContaining("new line IDs"));
    expect(screen.getByText(/Unsaved character or scene changes/)).toBeTruthy();
    expect(mocks.invoke.mock.calls.some(([command]) => command === "render_story_v2")).toBe(false);
  });
  it("does not edit or claim success when cloning would exceed the 200-scene limit", () => {
    const doc = story();
    doc.scenes = Array.from({ length: 200 }, (_, i) => ({
      id: "scene-" + i, title: "दृश्य " + i, notes: "",
      segments: i === 0 ? [doc.scenes[0].segments[0]] : [],
    }));
    const { onChange } = mount(doc);
    expect((screen.getByRole("button", {
      name: "Duplicate scene (fresh audio)",
    }) as HTMLButtonElement).disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });


  it("edits nonspoken production notes without modifying the source script or invoking synthesis", () => {
    const doc = story();
    const { onChange, onMessage } = mount(doc);
    const field = screen.getByRole("textbox", { name: "Scene production notes (not spoken)" });
    expect((field as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(field, { target: { value: "रोशनी कम।\nचुपचाप।" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const updater = onChange.mock.calls[0][0] as (previous: StoryV2) => StoryV2;
    const next = updater(doc);
    expect(next.scenes[0].notes).toBe("रोशनी कम।\nचुपचाप।");
    expect(next.scenes[0].segments).toBe(doc.scenes[0].segments);
    expect(next.text).toBe(doc.text);
    expect(screen.getByText(/Unsaved character or scene changes/)).toBeTruthy();
    expect(mocks.invoke.mock.calls.some(([command]) => command === "render_story_v2")).toBe(false);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("keeps a scene when deletion is cancelled and removes only that scene on confirmation", () => {
    const doc = story();
    doc.scenes.push({ id: "scene-two", title: "दूसरा दृश्य", notes: "not spoken",
      segments: [] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onChange, onMessage } = mount(doc);
    const action = screen.getByRole("button", { name: "Delete scene (keep original script)" });
    fireEvent.click(action);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("original script text"));
    expect(onChange).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(action);
    expect(onChange).toHaveBeenCalledTimes(1);
    const updater = onChange.mock.calls[0][0] as (previous: StoryV2) => StoryV2;
    const next = updater(doc);
    expect(next.scenes.map(scene => scene.id)).toEqual(["scene-two"]);
    expect(next.scenes[0].notes).toBe("not spoken");
    expect(next.text).toBe(doc.text);
    expect(doc.scenes).toHaveLength(2);
    expect(onMessage).toHaveBeenCalledWith(expect.stringContaining("Original script text remains unchanged"));
    expect(mocks.invoke.mock.calls.some(([command]) => command === "render_story_v2")).toBe(false);
  });


  it("clears stale unknown-speaker alert when its dialogue is reassigned", () => {
    const doc = story();
    doc.scenes[0].segments[0].speaker_id = null;
    doc.scenes[0].segments[0].source_label = "अज्ञात पात्र";
    const { rerender, onChange, onMessage } = mount(doc);
    expect(screen.getByRole("alert").textContent).toContain("अज्ञात पात्र");
    expect(screen.getByText(/1 unresolved speech segments/)).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: /Speaker for नमस्कार/ }), {
      target: { value: "narrator" },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const updater = onChange.mock.calls[0][0] as (previous: StoryV2) => StoryV2;
    const resolved = updater(doc);
    expect(resolved.scenes[0].segments[0].speaker_id).toBe("narrator");
    expect(resolved.scenes[0].segments[0].source_label).toBeNull();
    rerender(<CastStudio document={resolved} onChange={onChange} onMessage={onMessage} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/0 unresolved speech segments/)).toBeTruthy();
    expect(mocks.invoke.mock.calls.some(([command]) => command === "render_story_v2")).toBe(false);
  });


  it("captures destination scene selection before a deferred React updater executes", () => {
    const doc = story();
    doc.scenes.push({ id: "scene-two", title: "अगला दृश्य", notes: "", segments: [] });
    const { onChange, onMessage } = mount(doc);
    fireEvent.change(screen.getByRole("combobox", { name: "Move line line-one" }), {
      target: { value: "scene-two" },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const updater = onChange.mock.calls[0][0] as (previous: StoryV2) => StoryV2;
    const moved = updater(doc);
    expect(moved.scenes[0].segments).toHaveLength(0);
    expect(moved.scenes[1].segments.map(s => s.id)).toEqual(["line-one"]);
    expect(moved.scenes[1].segments[0].spoken_text).toBe("नमस्कार।");
    expect(moved.text).toBe(doc.text);
    expect(onMessage).not.toHaveBeenCalled();
  });

});
