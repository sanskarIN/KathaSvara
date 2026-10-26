// SPDX-License-Identifier: MPL-2.0
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { AudioResult } from "./lib/story";
import { buildDialogueCues, buildDialogueSrt, type DialogueCue } from "./lib/subtitles";
import { parseWavQuality, qualityReviewHints, type WavQualityReport } from "./lib/wav_quality";
import { resolveRenderSelection } from "./lib/render_selection";
import { isCurrentExportSession, renderExportLabel, suggestedOutputFile, type AudioExportLabel } from "./lib/export_names";
import {
  canOfferManualRetry, recordSubtitleExport, reviewForAudio, reviewProgress,
  updateAudioReview, type AudioReview, type ReviewStep,
} from "./lib/production_review";
import { serializeProductionManifest, type ProductionAudit } from "./lib/production_manifest";
import { recoveryHint } from "./lib/recovery_hints";
import PronunciationStudio from "./PronunciationStudio";
import { castCoverage, nextSpeakerReviewTarget, previousSpeakerReviewTarget, sceneOverview, speakerReviewChoices, type SpeakerReviewTarget } from "./lib/scene_overview";
import {
  addCharacter, addScene, assignSegment, duplicateCharacter, duplicateScene, mergeSceneWithNext, moveScene, moveSegment, moveSegmentWithinScene, renameCharacter, reassignAndRemoveCharacter,
  removeScene, renameScene, reviewSpokenText, splitSceneAtSegment, unresolvedSpeech, updateSceneNotes, type DialogueParseResponse, type StoryV2,
} from "./lib/story_v2";

type RenderPlan = {
  segments: number;
  source_characters: number;
  spoken_characters: number;
  chunks: number;
  forced_segments: number;
  model_loaded: false;
  duration_known: false;
  distinct_voices_verified: false;
};

type RenderHistory = {
  job_id: string;
  story_id: string;
  state: "running" | "interrupted" | "cancelled" | "failed" | "completed";
  done: number;
  total: number;
  updated_at: string;
  failure_code?: string;
};

interface Props {
  document: StoryV2;
  onChange: Dispatch<SetStateAction<StoryV2>>;
  onMessage: (message: string) => void;
}

function errorString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function spokenSubtitleLines(doc: StoryV2) {
  return doc.scenes.flatMap(scene =>
    scene.segments.filter(segment => segment.kind === "speech")
      .map(segment => ({ segment_id: segment.id, text: segment.spoken_text })),
  );
}

export default function CastStudio({ document, onChange, onMessage }: Props) {
  const [newName, setNewName] = useState("");
  const [newSceneTitle, setNewSceneTitle] = useState("");
  const [sceneSearch, setSceneSearch] = useState("");
  const [unresolvedScenesOnly, setUnresolvedScenesOnly] = useState(false);
  const [sceneCharacterFilter, setSceneCharacterFilter] = useState("");
  const [speakerReviewCursor, setSpeakerReviewCursor] = useState<SpeakerReviewTarget | null>(null);
  const speakerReviewSelectRef = useRef<HTMLSelectElement | null>(null);
  useEffect(() => {
    // A search belongs to the current story; do not hide a newly loaded story
    // behind the previous author's private dialogue terms or note filters.
    setSceneSearch("");
    setUnresolvedScenesOnly(false);
    setSceneCharacterFilter("");
    setSpeakerReviewCursor(null);
  }, [document.id]);
  useEffect(() => {
    // If a character is removed while filtering, restore the full outline.
    if (sceneCharacterFilter && !document.characters.some(char => char.id === sceneCharacterFilter)) {
      setSceneCharacterFilter("");
    }
  }, [document.characters, sceneCharacterFilter]);
  const [busy, setBusy] = useState(false);
  // Only the current parse/save/load operation can own the busy flag.
  const editorOperationEpoch = useRef(0);
  const [dirty, setDirty] = useState(true);
  const [selectedScene, setSelectedScene] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [history, setHistory] = useState<RenderHistory[] | null>(null);
  const [renderPlan, setRenderPlan] = useState<(RenderPlan & { scope: string }) | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [audit, setAudit] = useState<ProductionAudit | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [audio, setAudio] = useState<AudioResult | null>(null);
  const [audioExportLabel, setAudioExportLabel] = useState<AudioExportLabel | null>(null);
  const [wavQa, setWavQa] = useState<{ audioId: string; report: WavQualityReport } | null>(null);
  // Preview stays in memory only and never marks the separate human QA checklist.
  const [subtitlePreview, setSubtitlePreview] = useState<{ audioId: string; cues: DialogueCue[] } | null>(null);
  const [subtitlePage, setSubtitlePage] = useState(0);
  const [subtitleQuery, setSubtitleQuery] = useState("");
  const [inspectingWav, setInspectingWav] = useState(false);
  const qaEpoch = useRef(0);
  function clearWavInspection() {
    qaEpoch.current += 1;
    setWavQa(null);
    setInspectingWav(false);
    setSubtitlePreview(null);
    setSubtitlePage(0);
    setSubtitleQuery("");
  }
  const audioEpoch = useRef(0);
  // Never persisted or transferred to the model: only manual QA for the current WAV.
  const [review, setReview] = useState<AudioReview | null>(null);
  const renderRevision = useRef(0);
  // Synchronous render ownership: a retired async job cannot finish a newer job.
  const activeRenderJob = useRef<string | null>(null);
  // Invalidates history reads when the story, render or recovery list changes.
  const historyEpoch = useRef(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentAudio = useRef<string | null>(null);
  currentAudio.current = audio?.audio_id ?? null;
  useEffect(() => () => {
    renderRevision.current += 1;
    historyEpoch.current += 1;
    const abandoned = activeRenderJob.current;
    activeRenderJob.current = null;
    if (abandoned) void invoke("cancel_story_render", { jobId: abandoned }).catch(() => {});
    if (currentAudio.current) void invoke("discard_audio", { audioId: currentAudio.current }).catch(() => {});
  }, []);
  useEffect(() => {
    // Parent script/story switches are edits too; reject late renders of older documents.
    renderRevision.current += 1;
    editorOperationEpoch.current += 1;
    setBusy(false);
    historyEpoch.current += 1;
    setLoadingHistory(false);
    // A document switch retires its previous render synchronously. The old
    // promise may settle later; it is forbidden to clear the new job's UI.
    const abandoned = activeRenderJob.current;
    activeRenderJob.current = null;
    setJobId(null);
    setRendering(false);
    setProgress({ done: 0, total: 0 });
    if (abandoned) void invoke("cancel_story_render", { jobId: abandoned }).catch(() => {});
    if (currentAudio.current) void invoke("discard_audio", { audioId: currentAudio.current }).catch(() => {});
    audioEpoch.current += 1;
    setAudio(null);
    clearWavInspection();
    setAudioExportLabel(null);
    setReview(null);
    setHistory(null);
    setRenderPlan(null);
    setAudit(null);
  }, [document]);
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    const interval = window.setInterval(() => {
      void invoke<{ done: number; total: number }>("story_render_progress", { jobId })
        .then(result => {
          if (active && activeRenderJob.current === jobId) setProgress(result);
        }).catch(() => {});
    }, 500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [jobId]);
  function edit(update: (previous: StoryV2) => StoryV2) {
    renderRevision.current += 1;
    editorOperationEpoch.current += 1;
    setBusy(false);
    historyEpoch.current += 1;
    setHistory(null);
    setLoadingHistory(false);
    const abandoned = activeRenderJob.current;
    activeRenderJob.current = null;
    setJobId(null);
    setRendering(false);
    setProgress({ done: 0, total: 0 });
    if (abandoned) void invoke("cancel_story_render", { jobId: abandoned }).catch(() => {});
    if (audio) void invoke("discard_audio", { audioId: audio.audio_id }).catch(() => {});
    audioEpoch.current += 1;
    setAudio(null);
    clearWavInspection();
    setAudioExportLabel(null);
    setReview(null);
    onChange(previous => update(previous));
    setDirty(true);
  }
  function addNewCharacter() {
    try {
      edit(previous => addCharacter(previous, newName));
      setNewName("");
    } catch (error) {
      onMessage(errorString(error));
    }
  }
  function duplicateProfile(id: string) {
    try {
      edit(previous => duplicateCharacter(previous, id));
    } catch (error) {
      onMessage(errorString(error));
    }
  }
  function createScene() {
    try {
      edit(previous => addScene(previous, newSceneTitle));
      setNewSceneTitle("");
    } catch (error) {
      onMessage(errorString(error));
    }
  }
  function duplicateCurrentScene(sceneId: string) {
    if (busy || rendering) return;
    try {
      // Materialize the IDs before the React state updater is scheduled, so
      // the newly selected scene is the actual clone, not the source scene.
      const cloned = duplicateScene(document, sceneId);
      const originalIndex = document.scenes.findIndex(scene => scene.id === sceneId);
      const copyId = cloned.scenes[originalIndex + 1].id;
      edit(() => cloned);
      setSelectedScene(copyId);
      onMessage("Copied this scene with new line IDs. Old generated audio was not copied; save the story and review any new narration.");
    } catch (error) {
      onMessage(errorString(error));
    }
  }
  function splitCurrentScene(sceneId: string, segmentId: string) {
    if (busy || rendering) return;
    try {
      // Validate and assign the new scene ID before the deferred React updater.
      const updated = splitSceneAtSegment(document, sceneId, segmentId);
      const index = updated.scenes.findIndex(scene => scene.id === sceneId);
      const newScene = updated.scenes[index + 1];
      edit(() => updated);
      setSelectedScene(newScene.id);
      onMessage("Scene split before the selected line. Dialogue order, original script and reviewed Hindi are preserved. Save the story to keep this change.");
    } catch (error) {
      onMessage(errorString(error));
    }
  }
  function mergeCurrentSceneWithNext(sceneId: string) {
    if (busy || rendering) return;
    const position = document.scenes.findIndex(scene => scene.id === sceneId);
    const following = document.scenes[position + 1];
    if (!following) return;
    if (!window.confirm(
      `Merge this scene with the next scene "${following.title}"? ` +
      "All dialogue lines, voice assignments and cached line metadata are preserved in order. " +
      "The next scene title and any notes move to nonspoken production notes. " +
      "The original script is not edited; Save explicitly to keep this merge."
    )) return;
    try {
      // Preflight the entire merge before invalidating the current preview.
      const updated = mergeSceneWithNext(document, sceneId);
      edit(() => updated);
      setSelectedScene(sceneId);
      onMessage("Adjacent scenes merged. Original script, dialogue order and voice assignments remain unchanged; save to persist.");
    } catch (error) {
      onMessage(errorString(error));
    }
  }
  function deleteCurrentScene(sceneId: string, title: string) {
    if (busy || rendering) return;
    if (!window.confirm(
      `Remove scene "${title}" and all its parsed dialogue lines from this edited version? `
      + "The original script text and other scenes are kept. This change is not saved until you choose Save."
    )) return;
    try {
      const index = document.scenes.findIndex(scene => scene.id === sceneId);
      if (index < 0) throw new Error("Scene to remove was not found.");
      const remaining = document.scenes.filter(scene => scene.id !== sceneId);
      // Select the next visible scene, otherwise the previous one.
      setSelectedScene(remaining[Math.min(index, remaining.length - 1)]?.id ?? null);
      edit(previous => removeScene(previous, sceneId));
      onMessage("Scene removed from this unsaved project. Original script text remains unchanged.");
    } catch (error) {
      onMessage(errorString(error));
    }
  }
  function removeCharacter(id: string, name: string) {
    if (!window.confirm(`Delete ${name}? All their dialogue will be reassigned to Narrator and cached audio invalidated.`)) return;
    try {
      edit(previous => reassignAndRemoveCharacter(previous, id));
    } catch (error) {
      onMessage(errorString(error));
    }
  }
  async function startRender(sceneId?: string, forceSegmentId?: string, forceAll = false) {
    if (rendering || activeRenderJob.current) return;
    let selection;
    try {
      selection = resolveRenderSelection(document, { sceneId, segmentId: forceSegmentId, forceAll });
    } catch (error) {
      onMessage(errorString(error));
      return;
    }
    const id = crypto.randomUUID();
    // Scope and scene order are captured when generation begins, not when an
    // unrelated scene tab is selected during playback or export.
    const exportLabel = renderExportLabel(document, id, sceneId, forceSegmentId);
    const revision = renderRevision.current;
    activeRenderJob.current = id;
    historyEpoch.current += 1;
    setLoadingHistory(false);
    setJobId(id);
    setProgress({ done: 0, total: 0 });
    setRendering(true);
    audioEpoch.current += 1;
    setAudioExportLabel(null);
    setRenderPlan(null);
    setHistory(null);
    setReview(null);
    if (audio) void invoke("discard_audio", { audioId: audio.audio_id }).catch(() => {});
    setAudio(null);
    clearWavInspection();
    onMessage("Generating speech locally, with one model voice and per-character supported controls. Cancellation is cooperative.");
    try {
      const result = await invoke<AudioResult>("render_story_v2", {
        project: document,
        jobId: id,
        ...selection,
      });
      if (revision !== renderRevision.current || activeRenderJob.current !== id) {
        await invoke("discard_audio", { audioId: result.audio_id }).catch(() => {});
        return;
      }
      setAudio(result);
      setAudioExportLabel(exportLabel);
      // A successful render never counts as human listening or caption acceptance.
      setReview(null);
      onMessage(result.preview_available === false
        ? "Full-length WAV generated on disk. Inline preview is unavailable above 25 MiB; export the WAV to listen and review."
        : "A generated WAV is ready. Listen critically: multiple distinct character voices have NOT been verified.");
    } catch (error) {
      if (revision === renderRevision.current && activeRenderJob.current === id) {
        onMessage("Scene render stopped or failed: " + errorString(error));
      }
    } finally {
      // If a different story has begun rendering, this obsolete promise may
      // not clear its progress indicator, cancel control or render lock.
      if (activeRenderJob.current === id) {
        activeRenderJob.current = null;
        setJobId(null);
        setRendering(false);
      }
    }
  }
  async function inspectRenderPlan(sceneId?: string) {
    if (rendering || planBusy) return;
    const revision = renderRevision.current;
    setPlanBusy(true);
    setRenderPlan(null);
    try {
      const selection = resolveRenderSelection(document, { sceneId });
      const result = await invoke<RenderPlan>("preflight_render", {
        project: document, ...selection,
      });
      if (revision !== renderRevision.current) return;
      const scope = sceneId
        ? document.scenes.find(scene => scene.id === sceneId)?.title ?? "Selected scene"
        : "Full story";
      setRenderPlan({ ...result, scope });
      onMessage("Model-free plan reviewed: no model loaded and no speech duration or voice quality assumed.");
    } catch (error) {
      if (revision === renderRevision.current) {
        onMessage("Render preflight failed: " + errorString(error));
      }
    } finally {
      setPlanBusy(false);
    }
  }

  async function inspectProductionReadiness() {
    if (rendering || auditBusy) return;
    const revision = renderRevision.current;
    setAuditBusy(true);
    setAudit(null);
    try {
      const result = await invoke<ProductionAudit>("audit_production", {
        project: document,
      });
      if (revision !== renderRevision.current) return;
      setAudit(result);
      onMessage("Model-free production audit complete. Review each scene before loading the speech model.");
    } catch (error) {
      if (revision === renderRevision.current) {
        onMessage("Production audit failed: " + errorString(error));
      }
    } finally {
      setAuditBusy(false);
    }
  }

  async function exportProductionManifest() {
    if (!audit || auditBusy || rendering) return;
    const revision = renderRevision.current;
    try {
      // The export allowlist excludes scene/story IDs, private Hindi dialogue,
      // speaker names, voice settings and generated audio paths.
      const content = serializeProductionManifest(audit);
      const destination = await save({
        title: "Export model-free production readiness report",
        defaultPath: "kathasvara-production-audit.json",
        filters: [{ name: "Production audit JSON", extensions: ["json"] }],
      });
      if (!destination) return;
      if (revision !== renderRevision.current) {
        onMessage("The story changed while choosing the export location. Run the audit again.");
        return;
      }
      await invoke("export_production_manifest", { destination, content });
      if (revision === renderRevision.current) {
        onMessage("Private-text-free production report exported. It does not prove voice quality or model readiness.");
      }
    } catch (error) {
      if (revision === renderRevision.current) {
        onMessage("Cannot export production report: " + errorString(error));
      }
    }
  }

  async function showRenderHistory() {
    const revision = renderRevision.current;
    const epoch = ++historyEpoch.current;
    setLoadingHistory(true);
    try {
      const records = await invoke<RenderHistory[]>("story_render_history", { storyId: document.id });
      if (revision !== renderRevision.current || epoch !== historyEpoch.current) return;
      setHistory(records.slice(0, 10));
      onMessage("Local history loaded. Retry is manual: the current entire story will be revalidated with a fresh job ID; only unchanged cached speech can be reused.");
    } catch (error) {
      if (revision === renderRevision.current && epoch === historyEpoch.current) {
        onMessage("Could not read local render history: " + errorString(error));
      }
    } finally {
      if (epoch === historyEpoch.current) setLoadingHistory(false);
    }
  }

  function retryFromHistory(job: RenderHistory) {
    if (busy || rendering || !canOfferManualRetry(job, document.id)) return;
    if (!window.confirm(
      "Start a NEW full-story render from the CURRENT script and voice profiles? "
      + "The original scene/line selection was not stored in recovery history and cannot "
      + "be reconstructed. Only unchanged cached dialogue can be reused. "
      + "This will not overwrite the previous attempt, its journal or any exported WAV."
    )) return;
    onMessage("Starting an explicit full-story retry. Existing journal remains; unchanged valid speech may be reused.");
    void startRender();
  }

  async function forgetHistory(job: RenderHistory) {
    if (job.state === "running") return;
    if (!window.confirm("Forget this inactive render attempt and its temporary progress/cancel markers? The story, finished WAVs, exports and speech cache will remain unchanged.")) return;
    const revision = renderRevision.current;
    const epoch = ++historyEpoch.current;
    setLoadingHistory(false);
    try {
      await invoke("forget_render_journal", { jobId: job.job_id, storyId: job.story_id });
      if (revision !== renderRevision.current || epoch !== historyEpoch.current) return;
      setHistory(previous => previous?.filter(item => item.job_id !== job.job_id) ?? null);
      onMessage("Render record and matching bookkeeping markers removed. Projects and completed WAV audio were untouched.");
    } catch (error) {
      if (revision === renderRevision.current && epoch === historyEpoch.current) {
        onMessage("Cannot forget render history: " + errorString(error));
      }
    }
  }

  async function cancelRender() {
    if (jobId) {
      try {
        await invoke("cancel_story_render", { jobId });
        onMessage("Cancellation requested. The current model chunk may need to finish first.");
      } catch (error) {
        onMessage("Unable to signal cancellation: " + errorString(error));
      }
    }
  }
  function previewDialogueSubtitles() {
    if (!audio?.segment_timings?.length) return;
    try {
      // Validate ALL cues, not just the first visible page; no filesystem I/O.
      const cues = buildDialogueCues(audio.segment_timings, spokenSubtitleLines(document), {
        duration_seconds: audio.duration_seconds, sample_rate: audio.sample_rate,
      });
      setSubtitlePreview({ audioId: audio.audio_id, cues });
      setSubtitlePage(0);
      setSubtitleQuery("");
      onMessage("Dialogue cues ready for local preview. Listen and compare before exporting; no human QA step was marked.");
    } catch (error) {
      setSubtitlePreview(null);
      onMessage("Cannot preview dialogue subtitles: " + errorString(error));
    }
  }

  async function exportSceneSubtitles() {
    if (!audio?.segment_timings?.length || !audioExportLabel) return;
    const revision = renderRevision.current;
    const epoch = audioEpoch.current;
    const label = audioExportLabel;
    const audioId = audio.audio_id;
    try {
      // Timings are derived from actual rendered PCM frames, not reading-speed estimates.
      // The same complete validation is used by the optional in-app preview.
      const content = buildDialogueSrt(audio.segment_timings, spokenSubtitleLines(document), {
        duration_seconds: audio.duration_seconds, sample_rate: audio.sample_rate,
      });
      const destination = await save({
        title: "Export segment-timed Hindi SubRip subtitles",
        defaultPath: suggestedOutputFile(label, "srt"),
        filters: [{ name: "SubRip subtitles", extensions: ["srt"] }],
      });
      if (!destination) return;
      if (!isCurrentExportSession(label, audioId, epoch, audioEpoch.current,
        revision, renderRevision.current)) {
        onMessage("Story or generated audio changed while choosing SRT destination. Re-export the current WAV.");
        return;
      }
      await invoke("export_subtitles", { destination, content });
      // A pending filesystem export may finish after a new render or a
      // preview deletion. Never credit its SRT review or show a misleading
      // success status against the *new* current WAV.
      if (isCurrentExportSession(label, audioId, epoch, audioEpoch.current,
        revision, renderRevision.current)) {
        setReview(previous => recordSubtitleExport(previous, audioId));
        onMessage("Measured dialogue-level .srt captions exported. Review caption timing and text before marking subtitles checked.");
      }
    } catch (error) {
      if (isCurrentExportSession(label, audioId, epoch, audioEpoch.current,
        revision, renderRevision.current)) {
        onMessage("Cannot export dialogue subtitles: " + errorString(error));
      }
    }
  }

  async function inspectGeneratedWav() {
    if (!audio || inspectingWav) return;
    const request = ++qaEpoch.current;
    const revision = renderRevision.current;
    const epoch = audioEpoch.current;
    const id = audio.audio_id;
    setWavQa(null);
    setInspectingWav(true);
    try {
      const raw = await invoke<unknown>("inspect_generated_audio", { audioId: id });
      const report = parseWavQuality(raw);
      if (request !== qaEpoch.current || epoch !== audioEpoch.current ||
          revision !== renderRevision.current) return;
      if ((audio.file_bytes !== undefined && report.file_bytes !== audio.file_bytes) ||
          Math.abs(report.duration_seconds - audio.duration_seconds) > 0.05) {
        throw new Error("Generated WAV metadata changed; render or inspect again.");
      }
      setWavQa({ audioId: id, report });
      onMessage("Local WAV structure and audio-level hints checked. These do not confirm Hindi voice quality; listen to the actual audio.");
    } catch (error) {
      if (request === qaEpoch.current && epoch === audioEpoch.current &&
          revision === renderRevision.current) {
        onMessage("WAV inspection failed: " + errorString(error));
      }
    } finally {
      if (request === qaEpoch.current) setInspectingWav(false);
    }
  }

  async function exportAudio() {
    if (!audio || !audioExportLabel) return;
    const revision = renderRevision.current;
    const epoch = audioEpoch.current;
    const label = audioExportLabel;
    const audioId = audio.audio_id;
    try {
      const destination = await save({
        title: "Export scene or story dialogue WAV",
        defaultPath: suggestedOutputFile(label, "wav"),
        filters: [{ name: "Uncompressed WAV", extensions: ["wav"] }],
      });
      if (!destination) return;
      if (!isCurrentExportSession(label, audioId, epoch, audioEpoch.current,
        revision, renderRevision.current)) {
        onMessage("Story or generated audio changed while choosing WAV destination. Re-export the current WAV.");
        return;
      }
      await invoke("export_wav", { audioId, destination });
      if (isCurrentExportSession(label, audioId, epoch, audioEpoch.current,
        revision, renderRevision.current)) {
        onMessage("Dialogue WAV exported locally. The matching SRT uses the same filename stem.");
      }
    } catch (error) {
      if (isCurrentExportSession(label, audioId, epoch, audioEpoch.current,
        revision, renderRevision.current)) {
        onMessage("Cannot export audio: " + errorString(error));
      }
    }
  }
  async function clearAudio() {
    if (!audio) return;
    const id = audio.audio_id;
    audioEpoch.current += 1;
    setAudio(null);
    clearWavInspection();
    setAudioExportLabel(null);
    setReview(null);
    try {
      await invoke("discard_audio", { audioId: id });
      onMessage("Generated dialogue preview removed from local audio cache.");
    } catch (error) {
      onMessage("Local cache deletion failed: " + errorString(error));
    }
  }
  async function parse() {
    if (busy) return;
    if (document.text.trim().length === 0) {
      onMessage("Enter a Hindi script before parsing dialogue.");
      return;
    }
    if (document.text.length > 100_000) {
      onMessage("The character and scene editor has a 100,000-character limit.");
      return;
    }
    if (document.scenes.length > 0 &&
        !window.confirm("Reparsing replaces reviewed spoken text and speaker corrections. Original script and pronunciation glossary stay intact. Continue?")) {
      return;
    }
    const revision = renderRevision.current;
    const op = ++editorOperationEpoch.current;
    setBusy(true);
    try {
      const response = await invoke<DialogueParseResponse>("parse_dialogue", {
        title: document.title, text: document.text,
        characters: document.characters,
        scriptId: document.id || null,
      });
      // The user may edit or switch stories while Python is still parsing.
      // A late result must never replace a newer document or its audio.
      if (revision !== renderRevision.current) return;
      if (!response.ok) throw new Error("Dialogue parser returned an unsuccessful response.");
      if (audio) void invoke("discard_audio", { audioId: audio.audio_id }).catch(() => {});
      setAudio(null);
      clearWavInspection();
      renderRevision.current += 1;
      onChange({ ...response.result, pronunciation_glossary: document.pronunciation_glossary ?? [] });
      setSelectedScene(response.result.scenes[0]?.id ?? null);
      setDirty(true);
      onMessage(response.unresolved.length
        ? `Parsed with ${response.unresolved.length} unknown speaker label(s). Assign them manually before generating.`
        : `Parsed ${response.result.scenes.length} scene(s). Save the v2 story to preserve character assignments.`);
    } catch (error) {
      if (revision === renderRevision.current) {
        onMessage("Dialogue parsing failed: " + errorString(error));
      }
    } finally {
      if (op === editorOperationEpoch.current) setBusy(false);
    }
  }
  async function saveDocument() {
    if (busy) return;
    const revision = renderRevision.current;
    const op = ++editorOperationEpoch.current;
    setBusy(true);
    try {
      const saved = await invoke<StoryV2>("save_story_v2", {
        project: { ...document, id: document.id || crypto.randomUUID() },
      });
      // A completed filesystem write does not authorize switching the UI back
      // to an older story after an intervening edit or parent document change.
      if (revision !== renderRevision.current) return;
      onChange(saved);
      setDirty(false);
      onMessage("Version 2 story and voice profiles saved atomically in local app data.");
    } catch (error) {
      if (revision === renderRevision.current) {
        onMessage("Unable to save version 2 story: " + errorString(error));
      }
    } finally {
      if (op === editorOperationEpoch.current) setBusy(false);
    }
  }
  async function loadDocument() {
    if (busy) return;
    if (dirty && !window.confirm("Discard current unsaved cast/scenes and load a saved v2 version?")) return;
    const revision = renderRevision.current;
    const op = ++editorOperationEpoch.current;
    setBusy(true);
    try {
      const loaded = await invoke<StoryV2>("load_story_v2", { id: document.id });
      if (revision !== renderRevision.current) return;
      renderRevision.current += 1;
      if (audio) void invoke("discard_audio", { audioId: audio.audio_id }).catch(() => {});
      audioEpoch.current += 1;
      setAudio(null);
      clearWavInspection();
      setAudioExportLabel(null);
      setReview(null);
      onChange(loaded);
      setSelectedScene(loaded.scenes[0]?.id ?? null);
      setDirty(false);
      onMessage("Saved v2 story loaded. Legacy v0.1.x stories remain in their original folder.");
    } catch (error) {
      if (revision === renderRevision.current) {
        onMessage("No saved v2 story for this ID: " + errorString(error));
      }
    } finally {
      if (op === editorOperationEpoch.current) setBusy(false);
    }
  }
  const activeScene = document.scenes.find(scene => scene.id === selectedScene) ?? document.scenes[0];
  const activeCharacterFilter = document.characters.some(char => char.id === sceneCharacterFilter)
    ? sceneCharacterFilter : "";
  const visibleScenes = useMemo(() =>
    sceneOverview(document, sceneSearch, unresolvedScenesOnly, activeCharacterFilter || null),
    [document, sceneSearch, unresolvedScenesOnly, activeCharacterFilter]);
  const coverage = useMemo(() => castCoverage(document), [document]);
  const speakerIssues = useMemo(() => speakerReviewChoices(document), [document]);
  const selectedSpeakerIssueIndex = speakerReviewCursor === null ? -1 :
    speakerIssues.findIndex(issue =>
      issue.sceneId === speakerReviewCursor.sceneId &&
      issue.segmentId === speakerReviewCursor.segmentId);
  useEffect(() => {
    if (speakerReviewCursor?.sceneId === activeScene?.id) {
      // Focus naturally scrolls the selected speaker control into the scene list.
      speakerReviewSelectRef.current?.focus();
    }
  }, [speakerReviewCursor, activeScene?.id]);
  function focusSpeakerIssue(target: SpeakerReviewTarget) {
    if (busy || rendering) return;
    // Filtering is navigation only, not an edit to the story.
    setSceneSearch("");
    setUnresolvedScenesOnly(false);
    setSceneCharacterFilter("");
    setSelectedScene(target.sceneId);
    setSpeakerReviewCursor(target);
    setRenderPlan(null);
  }
  function jumpToSpeakerIssue(direction: -1 | 1) {
    const target = direction === 1
      ? nextSpeakerReviewTarget(document, speakerReviewCursor)
      : previousSpeakerReviewTarget(document, speakerReviewCursor);
    if (target) focusSpeakerIssue(target);
  }
  const unresolvedNow = unresolvedSpeech(document);
  // Derive the alert from the active document, not the one-time parse response:
  // assigning a previously unknown actor must immediately clear stale warnings.
  const unknownSpeakerLabels = Array.from(new Set(unresolvedNow.map(segment =>
    segment.source_label?.trim() || "Unlabeled dialogue")));
  const activeSubtitlePreview = audio && subtitlePreview?.audioId === audio.audio_id
    ? subtitlePreview : null;
  const subtitlePageSize = 10;
  const normalizedSubtitleQuery = subtitleQuery.trim().normalize("NFC").toLocaleLowerCase();
  const filteredSubtitleCues = activeSubtitlePreview
    ? activeSubtitlePreview.cues.filter(cue =>
        cue.text.normalize("NFC").toLocaleLowerCase().includes(normalizedSubtitleQuery))
    : [];
  const subtitlePages = Math.ceil(filteredSubtitleCues.length / subtitlePageSize);
  const activeReview = audio ? reviewForAudio(review, audio.audio_id) : null;
  const reviewState = audio ? reviewProgress(activeReview, audio.audio_id) : null;
  const reviewPrompts: Array<{ step: ReviewStep; label: string }> = [
    { step: "listened_in_full", label: "I listened to the entire generated WAV (in-app or exported)" },
    { step: "pronunciation_reviewed", label: "I checked Hindi pronunciation and mixed-language words" },
    { step: "character_turns_reviewed", label: "I checked dialogue order and intended character turns" },
    { step: "subtitles_reviewed", label: "I reviewed exported SRT wording and cue timing" },
  ];
  return (
    <section className="cast-layout" aria-label="Character and scene editor">
      <div className="panel cast-panel">
        <div className="section-label">CHARACTER LIBRARY / पात्र</div>
        <h2>Characters and voice profiles</h2>
        <p>Every character currently uses the same verified engine parameter set. Distinct voice identity and speaker conditioning are <strong>unavailable until actual model support is tested.</strong></p>
        <div className="cast-add">
          <input aria-label="New character name" placeholder="नया पात्र — e.g. राजा भोज" maxLength={120} value={newName}
            onChange={event => setNewName(event.target.value)} />
          <button className="secondary-button" onClick={addNewCharacter} disabled={busy || rendering || document.characters.length >= 100 || !newName.trim()}>+ Add</button>
        </div>
        <ul className="cast-list">
          {document.characters.map(char => (
            <li key={char.id}>
              <label>
                <span>Character name</span>
                <input value={char.name} disabled={char.id === "narrator" || busy || rendering} maxLength={120}
                  onChange={event => {
                    const nextName = event.target.value;
                    if (nextName === char.name) return;
                    try {
                      renameCharacter(document, char.id, nextName);
                      edit(doc => renameCharacter(doc, char.id, nextName));
                    } catch (error) { onMessage(errorString(error)); }
                  }} />
              </label>
              <div className="cast-voice-row">
                <label>Expression
                  <input type="range" min="0.25" max="2" step="0.05" value={char.voice.exaggeration} disabled={busy || rendering}
                    onChange={event => {
                      const exaggeration = Number(event.target.value);
                      edit(doc => ({
                        ...doc, characters: doc.characters.map(item => item.id === char.id
                          ? { ...item, voice: { ...item.voice, exaggeration } } : item),
                      }));
                    }} />
                </label>
                <label>CFG
                  <input type="range" min="0" max="1" step="0.05" value={char.voice.cfg_weight} disabled={busy || rendering}
                    onChange={event => {
                      const cfg_weight = Number(event.target.value);
                      edit(doc => ({
                        ...doc, characters: doc.characters.map(item => item.id === char.id
                          ? { ...item, voice: { ...item.voice, cfg_weight } } : item),
                      }));
                    }} />
                </label>
              </div>
              <p className="helper">Hindi · Chatterbox Multilingual · pause {char.voice.pause_ms} ms · no distinct speaker verified</p>
              <div className="cast-actions">
                <button className="quiet-button" disabled={busy || rendering || document.characters.length >= 100} onClick={() => duplicateProfile(char.id)}>Duplicate voice profile</button>
                {char.id !== "narrator" && <button className="quiet-button" disabled={busy || rendering} onClick={() => removeCharacter(char.id, char.name)}>Delete and reassign to narrator</button>}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="panel scene-panel">
        <PronunciationStudio document={document} edit={edit} onMessage={onMessage} />
        <div className="section-label">SCENES & DIALOGUE / दृश्य</div>
        <h2>Script breakdown</h2>
        <p>Use labels like <code>राजा भोज: नमस्कार।</code> and scene headings like <code># दरबार</code>. Unknown speaker names are never guessed.</p>
        <div className="cast-actions">
          <button className="secondary-button" disabled={busy || rendering} onClick={() => void parse()}>{busy ? "Processing…" : "Parse labeled Hindi script"}</button>
          <button className="secondary-button" disabled={busy} onClick={() => void saveDocument()}>Save cast and scenes</button>
          <button className="quiet-button" disabled={busy || rendering} onClick={() => void loadDocument()}>Load saved v2</button>
        </div>
        <div className="render-tools">
          <button className="primary-button" disabled={busy || rendering || !document.scenes.length}
            onClick={() => void startRender()}>Generate story dialogue WAV</button>
          <button className="secondary-button" disabled={busy || rendering || planBusy || !document.scenes.length}
            onClick={() => void inspectRenderPlan()}>{planBusy ? "Checking plan…" : "Inspect render plan (no model)"}</button>
          <button className="quiet-button" disabled={busy || rendering || !document.scenes.length}
            onClick={() => void startRender(undefined, undefined, true)}>Force re-render story</button>
          {activeScene && <button className="secondary-button" disabled={busy || rendering}
            onClick={() => void startRender(activeScene.id)}>Generate selected scene</button>}
          {activeScene && <button className="secondary-button"
            disabled={busy || rendering || planBusy}
            onClick={() => void inspectRenderPlan(activeScene.id)}>
            Inspect selected scene (no model)
          </button>}
          <button className="secondary-button"
            disabled={busy || rendering || auditBusy || !document.scenes.length}
            onClick={() => void inspectProductionReadiness()}>
            {auditBusy ? "Checking scenes…" : "Audit scene readiness (no model)"}
          </button>
          <button className="quiet-button" disabled={!rendering} onClick={() => void cancelRender()}>Cancel render</button>
          <button className="secondary-button" disabled={loadingHistory}
            onClick={() => void showRenderHistory()}>
            {loadingHistory ? "Reading history…" : "Recent render history"}
          </button>
          {audit && <section className="inspection-panel" aria-label="Production readiness audit">
            <strong>Hindi production readiness · model-free</strong>
            <p>{audit.ready_scenes} / {audit.total_scenes} scenes ready for a render attempt.
              {" "}Entire story: {audit.full_story_ready
                ? `plan valid (${audit.full_story_chunks} chunks)`
                : `needs review (${audit.full_story_reason.replaceAll("_", " ")})`}.
            </p>
            <ul>{audit.scenes.map(item => (
              <li key={item.scene_id}>
                <strong>{document.scenes.find(scene => scene.id === item.scene_id)?.title ?? "Scene"}</strong>
                {" · "}{item.ready ? "ready to attempt" : item.reason.replaceAll("_", " ")}
                {" · "}{item.segments} speech lines
                {item.ready ? ` · ${item.chunks} chunks` : ""}
              </li>
            ))}</ul>
            <p className="helper">No model loaded and no speech or distinct voices verified.
              Check local model setup and listen to every generated WAV before publishing.</p>
            <button type="button" className="secondary-button"
              disabled={auditBusy || rendering}
              onClick={() => void exportProductionManifest()}>
              Export privacy-safe audit JSON
            </button>
            <p className="helper">Export contains scene numbers, aggregate counts and fixed reason
              codes only — no dialogue, story/scene IDs, actor names or voice parameters.
              The app will refuse to overwrite an existing JSON file.</p>
          </section>}
          {renderPlan && <p className="helper" role="status">
            {renderPlan.scope} preflight: {renderPlan.segments} dialogue lines · {renderPlan.chunks} model chunks ·
            {" "}{renderPlan.spoken_characters} spoken characters (after pronunciation rules).
            No model loaded; duration, Hindi naturalness and distinct voices are not verified.
          </p>}
          <div className="render-meter" role="status" aria-live="polite">
            {rendering
              ? (progress.total ? `Segments ${progress.done} / ${progress.total}` : "Loading local inference model…")
              : "Not generating"}
          </div>
          {history && <section className="inspection-panel" aria-label="Recent local render jobs">
            <strong>Recent render attempts for this story</strong>
            <p>Records store segment IDs and outcomes, not script text. Interrupted
              means a previous worker is no longer active in this app process.
              The retry button starts a NEW whole-story attempt from the CURRENT document,
              not necessarily the originally selected scene. Existing journals are not
              overwritten; unchanged cached speech may be reused. Retry is never automatic.</p>
            {history.length === 0
              ? <p>No recorded renders for this story yet.</p>
              : <ul>{history.map(item => (
                <li key={item.job_id}>
                  <strong>{item.state === "interrupted" ? "Interrupted" : item.state}</strong>
                  {" · "}{item.done}/{item.total} segments
                  {" · "}{item.updated_at}
                  <span className="helper">{" · "}{recoveryHint(item)}</span>
                  {canOfferManualRetry(item, document.id) && (
                    <button className="secondary-button" type="button" disabled={busy || rendering}
                      onClick={() => retryFromHistory(item)}>Retry current full story</button>
                  )}
                  <button className="quiet-button" type="button" disabled={item.state === "running" || rendering}
                    onClick={() => void forgetHistory(item)}>Forget record</button>
                </li>
              ))}</ul>}
          </section>}
          {audio && <>
            {audio.preview_available !== false
              ? <audio ref={audioRef} controls src={audio.data_url} aria-label="Generated dialogue preview" />
              : <p role="status">This long narration is saved locally, but exceeds the 25 MiB inline preview limit.
                Use <strong>Export WAV</strong> to copy the complete audio to a new file and listen in your preferred audio player.</p>}
            {audioExportLabel && <p className="helper" role="status">
              Export scope: {audioExportLabel.scope === "story" ? "full story" :
                audioExportLabel.scope === "scene" ? "selected scene" : "selected dialogue line"}.
              WAV and SRT exports will suggest matching filenames captured at render time.
            </p>}
            <small>{audio.duration_seconds.toFixed(1)} seconds · {audio.sample_rate} Hz · {audio.chunks} synthesis chunks
              {audio.file_bytes != null ? ` · ${(audio.file_bytes / (1024 * 1024)).toFixed(1)} MiB WAV` : ""}
            </small>
            <p className="helper">Subtitles are aligned to measured dialogue segments, not individual words.
              Review Hindi punctuation and timing before adding them to a video.</p>
            <div className="cast-actions">
              <button className="secondary-button" onClick={() => void exportAudio()}>Export WAV</button>
              <button className="secondary-button" disabled={inspectingWav}
                onClick={() => void inspectGeneratedWav()}>
                {inspectingWav ? "Inspecting WAV…" : "Inspect generated WAV (no model)"}
              </button>
              <button className="secondary-button"
                disabled={!audio.segment_timings?.length}
                onClick={() => previewDialogueSubtitles()}>Preview dialogue cues</button>
              <button className="secondary-button"
                disabled={!audio.segment_timings?.length}
                onClick={() => void exportSceneSubtitles()}>Export dialogue SRT</button>
              <button className="quiet-button" onClick={() => void clearAudio()}>Clear preview</button>
            </div>
            {activeSubtitlePreview && (
              <section className="inspection-panel" aria-label="Dialogue subtitle cue preview">
                <strong>Measured dialogue captions · {activeSubtitlePreview.cues.length} cues</strong>
                <p>Local preview only; all cues were checked for valid timeline ordering.
                  These captions are timed per dialogue, not word-aligned. No SRT has been
                  exported and no listening or subtitle review is automatically completed.</p>
                <label className="field-label" htmlFor="dialogue-cue-search">Find a Hindi dialogue cue</label>
                <input id="dialogue-cue-search" type="search" className="title-input"
                  aria-label="Find dialogue cue text" maxLength={120}
                  placeholder="Search spoken dialogue…" value={subtitleQuery}
                  onChange={event => {
                    setSubtitleQuery(event.target.value);
                    setSubtitlePage(0);
                  }} />
                <p role="status">{filteredSubtitleCues.length} of {activeSubtitlePreview.cues.length} cues shown.
                  Search stays on this device and does not modify the exported SRT.</p>
                {filteredSubtitleCues.length === 0 && (
                  <p>No matching dialogue cues. Clear the search to show all captions.</p>
                )}
                <ol className="subtitle-cues" start={subtitlePage * subtitlePageSize + 1}>
                  {filteredSubtitleCues
                    .slice(subtitlePage * subtitlePageSize, (subtitlePage + 1) * subtitlePageSize)
                    .map(cue => (
                      <li key={cue.number} value={cue.number}>
                        <small>{cue.start_seconds.toFixed(3)}s → {cue.end_seconds.toFixed(3)}s</small>
                        <p lang="hi">{cue.text}</p>
                        {audio.preview_available !== false && (
                          <button type="button" className="quiet-button"
                            aria-label={"Jump to cue " + cue.number}
                            onClick={() => {
                              if (audioRef.current) audioRef.current.currentTime = cue.start_seconds;
                            }}>Jump to cue</button>
                        )}
                      </li>
                    ))}
                </ol>
                {subtitlePages > 1 && (
                  <div className="cast-actions" aria-label="Subtitle cue pages">
                    <button type="button" className="quiet-button"
                      disabled={subtitlePage === 0}
                      onClick={() => setSubtitlePage(page => Math.max(0, page - 1))}>
                      Previous cues
                    </button>
                    <span>Page {subtitlePage + 1} / {subtitlePages}</span>
                    <button type="button" className="quiet-button"
                      disabled={subtitlePage + 1 >= subtitlePages}
                      onClick={() => setSubtitlePage(page => Math.min(subtitlePages - 1, page + 1))}>
                      Next cues
                    </button>
                  </div>
                )}
              </section>
            )}
            {wavQa?.audioId === audio.audio_id && (
              <section className="inspection-panel" aria-label="Generated WAV level and pause inspection">
                <strong>Structural WAV inspection · human listening still required</strong>
                <p>{wavQa.report.duration_seconds.toFixed(1)} seconds checked ·
                  {" "}{(wavQa.report.file_bytes / (1024 * 1024)).toFixed(2)} MiB ·
                  {" "}RMS {wavQa.report.level_hints.rms_dbfs?.toFixed(1) ?? "silent"} dBFS.
                </p>
                <ul>{qualityReviewHints(wavQa.report).map(hint => <li key={hint}>{hint}</li>)}</ul>
                {wavQa.report.level_hints.long_internal_pause_hint &&
                  audio.preview_available !== false && (
                  <button type="button" className="quiet-button"
                    onClick={() => {
                      const start = wavQa.report.level_hints.longest_internal_quiet_span_start_seconds;
                      if (audioRef.current && start !== null) {
                        audioRef.current.currentTime = start;
                      }
                    }}>Jump to flagged quiet gap</button>
                )}
                <p className="helper">This no-model structural report is not a listening pass.
                  Dramatic pauses can be intentional; a clean result cannot establish
                  natural Hindi pronunciation, correct character voices or SRT accuracy.
                  Your separate checklist remains entirely manual and unsaved.</p>
              </section>
            )}
            {activeReview && reviewState && (
              <section className="inspection-panel" aria-label="Manual narration quality checklist">
                <strong>Human review for this WAV — {reviewState.completed} / {reviewState.total} marked</strong>
                <p>Optional, local-only and not saved. Mark each item only after personally
                  reviewing this exact WAV. A checked item is a user note, not a verified
                  Chatterbox voice-quality or distinct-character voice claim.</p>
                <div className="review-checklist">
                  {reviewPrompts.map(({ step, label }) => (
                    <label key={step}>
                      <input type="checkbox"
                        checked={activeReview.completed[step]}
                        disabled={step === "subtitles_reviewed" && !activeReview.subtitleExported}
                        onChange={event => {
                          try {
                            const next = updateAudioReview(activeReview, audio.audio_id, step, event.target.checked);
                            setReview(next);
                          } catch (error) {
                            onMessage(errorString(error));
                          }
                        }} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <p className="helper" role="status">
                  {reviewState.personallyReviewed
                    ? "All four items were marked by you for this WAV; no automatic audio quality verification was performed."
                    : "Human review incomplete. Export dialogue SRT before marking subtitle review."}
                </p>
              </section>
            )}
          </>}
        </div>
        <p role="status" className={dirty ? "dirty-label" : "saved-label"}>{dirty ? "● Unsaved character or scene changes" : "✓ Version 2 story saved"}</p>
        {unresolvedNow.length > 0 && <p role="alert">{unresolvedNow.length} unknown speaker label(s): {unknownSpeakerLabels.join(", ")}</p>}
        {coverage.invalidSpeakerAssignments > 0 && (
          <p role="alert">{coverage.invalidSpeakerAssignments} spoken line(s) reference missing character IDs. Assign a valid speaker before saving or rendering.</p>
        )}
        <div className="cast-add">
          <input placeholder="New scene title / नया दृश्य" aria-label="New scene title" value={newSceneTitle}
            maxLength={120} onChange={event => setNewSceneTitle(event.target.value)} />
          <button className="secondary-button" disabled={!newSceneTitle.trim() || busy || rendering} onClick={createScene}>+ Scene</button>
        </div>
        <div className="scene-outline-controls" aria-label="Scene navigation filters">
          <label>
            Find scenes or dialogue
            <input type="search" aria-label="Find scenes or dialogue" maxLength={120}
              placeholder="दृश्य, संवाद, या नोट खोजें"
              value={sceneSearch} onChange={event => setSceneSearch(event.target.value)} />
          </label>
          <label className="scene-outline-character">
            Show scenes for character
            <select aria-label="Show scenes for character" value={activeCharacterFilter}
              onChange={event => setSceneCharacterFilter(event.target.value)}>
              <option value="">All characters</option>
              {document.characters.map(char => <option key={char.id} value={char.id}>{char.name}</option>)}
            </select>
          </label>
          <label className="scene-outline-checkbox">
            <input type="checkbox" checked={unresolvedScenesOnly}
              onChange={event => setUnresolvedScenesOnly(event.target.checked)} />
            Only scenes needing speaker review
          </label>
          <button type="button" className="quiet-button" disabled={!sceneSearch && !unresolvedScenesOnly && !activeCharacterFilter}
            onClick={() => { setSceneSearch(""); setUnresolvedScenesOnly(false); setSceneCharacterFilter(""); }}>
            Clear scene filters
          </button>
        </div>
        <p className="helper scene-outline-count" aria-live="polite">
          Showing {visibleScenes.length} of {document.scenes.length} scenes. Search filters navigation only; the selected scene stays open until you choose another.
        </p>
        <div className="scene-review-navigation">
          <button type="button" className="secondary-button"
            disabled={busy || rendering || speakerIssues.length === 0}
            onClick={() => jumpToSpeakerIssue(-1)}>Previous speaker issue</button>
          <button type="button" className="secondary-button"
            disabled={busy || rendering || speakerIssues.length === 0}
            onClick={() => jumpToSpeakerIssue(1)}>Next speaker issue</button>
          <label className="speaker-review-jump">
            Jump to speaker issue
            <select aria-label="Jump to speaker issue"
              value={selectedSpeakerIssueIndex < 0 ? "" : String(selectedSpeakerIssueIndex)}
              disabled={busy || rendering || speakerIssues.length === 0}
              onChange={event => {
                if (event.target.value === "") return;
                const index = Number(event.target.value);
                if (Number.isSafeInteger(index) && speakerIssues[index]) {
                  focusSpeakerIssue(speakerIssues[index]);
                }
              }}>
              <option value="">Choose dialogue to review…</option>
              {speakerIssues.map((issue, index) => (
                <option key={issue.sceneId + ":" + issue.segmentId + ":" + index}
                  value={String(index)}>{issue.label}</option>
              ))}
            </select>
          </label>
          <span role="status" aria-live="polite">
            {speakerIssues.length} spoken line(s) need manual speaker review.
            {selectedSpeakerIssueIndex >= 0 &&
              ` Issue ${selectedSpeakerIssueIndex + 1} of ${speakerIssues.length}: ${speakerIssues[selectedSpeakerIssueIndex].reason === "invalid" ? "missing character" : "unassigned"}.`}
          </span>
        </div>
        <details className="cast-coverage">
          <summary>Local cast coverage · {coverage.spokenLines} spoken · {coverage.directions} directions</summary>
          <p className="helper">Model-free line counts only, not verified different voices.
            {" "}{coverage.unassignedSpeech} unassigned spoken line(s).
            {coverage.invalidSpeakerAssignments > 0 &&
              ` ${coverage.invalidSpeakerAssignments} invalid character assignment(s) require repair before saving.`}
          </p>
          <ul aria-label="Cast coverage by character">
            {coverage.characters.map(actor => (
              <li key={actor.characterId}>
                <span>{actor.characterName}</span>
                <small>{actor.spokenLines} spoken · {actor.sceneCount} scene(s)</small>
              </li>
            ))}
          </ul>
        </details>
        <div className="scene-navigation" aria-label="Scenes">
          {visibleScenes.map(scene => (
            <button type="button" key={scene.id} aria-label={scene.title}
              className={"quiet-button scene-outline-entry " + (activeScene?.id === scene.id ? "selected-scene" : "")}
              onClick={() => { setSelectedScene(scene.id); setSpeakerReviewCursor(null); setRenderPlan(null); }}>
              <span>{scene.title}</span>
              <small aria-hidden="true" className="scene-outline-meta">
                {scene.spoken} spoken · {scene.directions} directions
                {scene.unresolved > 0 ? ` · ${scene.unresolved} unassigned` : ""}
                {scene.invalidSpeakers > 0 ? ` · ${scene.invalidSpeakers} invalid speaker ID(s)` : ""}
                {scene.hasProductionNotes ? " · notes" : ""}
              </small>
            </button>
          ))}
        </div>
        {visibleScenes.length === 0 && (
          <p className="helper">No matching scenes. Clear filters to show all scenes; your original story has not changed.</p>
        )}
        {activeScene ? (
          <>
            <div className="cast-actions">
              <label className="scene-title-label">Scene title
                <input value={activeScene.title} disabled={busy || rendering} maxLength={120} onChange={event => {
                  const title = event.target.value;
                  if (!title.trim() || title.trim() === activeScene.title) return;
                  edit(doc => renameScene(doc, activeScene.id, title));
                }} />
              </label>
              <button type="button" className="quiet-button"
                disabled={busy || rendering || document.scenes[0]?.id === activeScene.id}
                onClick={() => edit(doc => moveScene(doc, activeScene.id, -1))}>↑ Move up</button>
              <button type="button" className="quiet-button"
                disabled={busy || rendering || document.scenes[document.scenes.length - 1]?.id === activeScene.id}
                onClick={() => edit(doc => moveScene(doc, activeScene.id, 1))}>↓ Move down</button>
              <button type="button" className="secondary-button"
                disabled={busy || rendering || document.scenes.length >= 200}
                onClick={() => duplicateCurrentScene(activeScene.id)}>
                Duplicate scene (fresh audio)
              </button>
              <button type="button" className="secondary-button"
                disabled={busy || rendering || document.scenes[document.scenes.length - 1]?.id === activeScene.id}
                onClick={() => mergeCurrentSceneWithNext(activeScene.id)}>
                Merge with next scene (keep dialogue)
              </button>
              <button type="button" className="quiet-button"
                disabled={busy || rendering}
                onClick={() => deleteCurrentScene(activeScene.id, activeScene.title)}>
                Delete scene (keep original script)
              </button>
            </div>
            <label className="reviewed-dialogue-label">
              Production notes for this scene (not spoken)
              <textarea lang="hi" rows={3} maxLength={4000}
                aria-label="Scene production notes (not spoken)"
                value={activeScene.notes}
                disabled={busy || rendering}
                placeholder="Optional staging or editing notes. Never synthesized as speech."
                onChange={event => {
                  const next = event.target.value;
                  if (next === activeScene.notes) return;
                  try {
                    updateSceneNotes(document, activeScene.id, next);
                    edit(previous => updateSceneNotes(previous, activeScene.id, next));
                  } catch (error) {
                    onMessage(errorString(error));
                  }
                }} />
            </label>
            <p className="helper">Production notes are stored with this scene, not read aloud, and do not alter the original script or dialogue text.</p>
            <ol className="scene-segments">
              {activeScene.segments.map((segment, index) => (
                <li key={segment.id} className={speakerReviewCursor?.sceneId === activeScene.id &&
                  speakerReviewCursor.segmentId === segment.id ? "speaker-review-target" : undefined}>
                  <div className="segment-header">
                    <span>{segment.kind === "direction" ? "Stage direction (not spoken)" : "Spoken segment"}</span>
                    {segment.kind === "speech" && (
                      <select aria-label={"Speaker for " + segment.original_text.slice(0, 30)}
                        ref={speakerReviewCursor?.sceneId === activeScene.id &&
                          speakerReviewCursor.segmentId === segment.id ? speakerReviewSelectRef : undefined}
                        value={segment.speaker_id ?? ""} disabled={busy || rendering}
                        onChange={event => {
                          const speakerId = event.target.value;
                          if (speakerId === segment.speaker_id && segment.source_label === null) return;
                          try {
                            assignSegment(document, segment.id, speakerId);
                            edit(doc => assignSegment(doc, segment.id, speakerId));
                          } catch (error) { onMessage(errorString(error)); }
                        }}>
                        <option value="">Unassigned — manual correction required</option>
                        {segment.speaker_id !== null &&
                          !document.characters.some(char => char.id === segment.speaker_id) && (
                            <option value={segment.speaker_id} disabled>Invalid character ID — choose a valid speaker</option>
                          )}
                        {document.characters.map(char => <option key={char.id} value={char.id}>{char.name}</option>)}
                      </select>
                    )}
                  </div>
                  <p lang="hi">{segment.original_text}</p>
                   {segment.kind === "speech" && <label className="reviewed-dialogue-label">
                     Reviewed spoken text (not the original script)
                     <textarea key={segment.id + segment.spoken_text} lang="hi"
                       aria-label={"Reviewed speech for " + segment.id}
                       defaultValue={segment.spoken_text} rows={2} maxLength={100_000}
                       onBlur={event => {
                         const next = event.currentTarget.value;
                         if (next === segment.spoken_text) return;
                         try {
                           reviewSpokenText(document, segment.id, next);
                           edit(doc => reviewSpokenText(doc, segment.id, next));
                         }
                         catch (error) {
                           onMessage(errorString(error));
                           event.currentTarget.value = segment.spoken_text;
                         }
                       }} />
                   </label>}
                  <div className="cast-actions" aria-label={"Order controls for " + segment.id}>
                    <button type="button" className="quiet-button"
                      aria-label={"Move line " + segment.id + " up"}
                      disabled={busy || rendering || index === 0}
                      onClick={() => edit(doc => moveSegmentWithinScene(doc, segment.id, -1))}>
                      ↑ Line up
                    </button>
                    <button type="button" className="quiet-button"
                      aria-label={"Move line " + segment.id + " down"}
                      disabled={busy || rendering || index === activeScene.segments.length - 1}
                      onClick={() => edit(doc => moveSegmentWithinScene(doc, segment.id, 1))}>
                      ↓ Line down
                    </button>
                    {index > 0 && (
                      <button type="button" className="secondary-button"
                        aria-label={"Split scene before line " + segment.id}
                        disabled={busy || rendering || document.scenes.length >= 200}
                        onClick={() => splitCurrentScene(activeScene.id, segment.id)}>
                        Split scene here
                      </button>
                    )}
                  </div>
                  <label className="move-segment-label">Move line to scene
                    <select aria-label={"Move line " + segment.id} value={activeScene.id} disabled={busy || rendering || document.scenes.length < 2}
                      onChange={event => {
                        const destinationId = event.target.value;
                        if (destinationId === activeScene.id) return;
                        try {
                          moveSegment(document, segment.id, destinationId);
                          edit(doc => moveSegment(doc, segment.id, destinationId));
                        } catch (error) { onMessage(errorString(error)); }
                      }}>
                      {document.scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.title}</option>)}
                    </select>
                  </label>
                  {segment.kind === "speech" && segment.speaker_id && (
                    <button className="quiet-button" disabled={busy || rendering}
                      onClick={() => void startRender(activeScene.id, segment.id)}>
                      Regenerate / retry this line only
                    </button>
                  )}
                  {segment.kind === "speech" && segment.speaker_id === null && <small className="dirty-label">Unknown speaker: {segment.source_label}. Assign manually.</small>}
                </li>
              ))}
            </ol>
          </>
        ) : <p>No scenes parsed yet. The original story text remains unchanged.</p>}
        <p className="helper">{coverage.unassignedSpeech + coverage.invalidSpeakerAssignments} spoken segment(s) need speaker review ({coverage.unassignedSpeech} unassigned, {coverage.invalidSpeakerAssignments} invalid IDs). Actual distinct-character audio is not yet a supported feature. Source scripts are retained independently of parsed text.</p>
      </div>
    </section>
  );
}
