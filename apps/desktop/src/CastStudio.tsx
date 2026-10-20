// SPDX-License-Identifier: MPL-2.0
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { AudioResult } from "./lib/story";
import { buildDialogueSrt } from "./lib/subtitles";
import PronunciationStudio from "./PronunciationStudio";
import {
  addCharacter, addScene, assignSegment, duplicateCharacter, moveScene, moveSegment, renameCharacter, reassignAndRemoveCharacter,
  renameScene, reviewSpokenText, unresolvedSpeech, type DialogueParseResponse, type StoryV2,
} from "./lib/story_v2";

type RenderHistory = {
  job_id: string;
  story_id: string;
  state: "running" | "interrupted" | "cancelled" | "failed" | "completed";
  done: number;
  total: number;
  updated_at: string;
};

interface Props {
  document: StoryV2;
  onChange: Dispatch<SetStateAction<StoryV2>>;
  onMessage: (message: string) => void;
}

function errorString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function CastStudio({ document, onChange, onMessage }: Props) {
  const [newName, setNewName] = useState("");
  const [newSceneTitle, setNewSceneTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(true);
  const [selectedScene, setSelectedScene] = useState<string | null>(null);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [rendering, setRendering] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [history, setHistory] = useState<RenderHistory[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [audio, setAudio] = useState<AudioResult | null>(null);
  const renderRevision = useRef(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentJob = useRef<string | null>(null);
  const currentAudio = useRef<string | null>(null);
  currentJob.current = jobId;
  currentAudio.current = audio?.audio_id ?? null;
  useEffect(() => () => {
    renderRevision.current += 1;
    if (currentJob.current) void invoke("cancel_story_render", { jobId: currentJob.current }).catch(() => {});
    if (currentAudio.current) void invoke("discard_audio", { audioId: currentAudio.current }).catch(() => {});
  }, []);
  useEffect(() => {
    // Parent script/story switches are edits too; reject late renders of older documents.
    renderRevision.current += 1;
    if (currentJob.current) void invoke("cancel_story_render", { jobId: currentJob.current }).catch(() => {});
    if (currentAudio.current) void invoke("discard_audio", { audioId: currentAudio.current }).catch(() => {});
    setAudio(null);
    setHistory(null);
  }, [document]);
  useEffect(() => {
    if (!jobId) return;
    const interval = window.setInterval(() => {
      void invoke<{ done: number; total: number }>("story_render_progress", { jobId })
        .then(setProgress).catch(() => {});
    }, 500);
    return () => window.clearInterval(interval);
  }, [jobId]);
  function edit(update: (previous: StoryV2) => StoryV2) {
    renderRevision.current += 1;
    if (jobId) void invoke("cancel_story_render", { jobId }).catch(() => {});
    if (audio) void invoke("discard_audio", { audioId: audio.audio_id }).catch(() => {});
    setAudio(null);
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
  function removeCharacter(id: string, name: string) {
    if (!window.confirm(`Delete ${name}? All their dialogue will be reassigned to Narrator and cached audio invalidated.`)) return;
    try {
      edit(previous => reassignAndRemoveCharacter(previous, id));
    } catch (error) {
      onMessage(errorString(error));
    }
  }
  async function startRender(sceneId?: string, forceSegmentId?: string, forceAll = false) {
    if (rendering) return;
    if (!document.scenes.length) {
      onMessage("Parse labeled dialogue before rendering selected scenes.");
      return;
    }
    const selected = sceneId ? document.scenes.filter(scene => scene.id === sceneId) : document.scenes;
    const speech = selected.flatMap(scene => scene.segments)
      .filter(seg => seg.kind === "speech" && (!forceSegmentId || seg.id === forceSegmentId));
    if (!speech.length) {
      onMessage("Select a scene with spoken dialogue before rendering.");
      return;
    }
    if (speech.some(seg => !seg.speaker_id)) {
      onMessage("Assign the selected dialogue speaker before rendering.");
      return;
    }
    if (speech.length > 256 || speech.reduce((length, seg) => length + seg.spoken_text.length, 0) > 100_000) {
      onMessage("Render limit: 256 spoken segments and 100,000 characters. Choose a scene or split the story.");
      return;
    }
    const id = crypto.randomUUID();
    const revision = renderRevision.current;
    setJobId(id);
    setProgress({ done: 0, total: 0 });
    setRendering(true);
    if (audio) void invoke("discard_audio", { audioId: audio.audio_id }).catch(() => {});
    setAudio(null);
    onMessage("Generating speech locally, with one model voice and per-character supported controls. Cancellation is cooperative.");
    try {
      const result = await invoke<AudioResult>("render_story_v2", {
        project: document,
        jobId: id,
        selectedSceneIds: sceneId ? [sceneId] : null,
        selectedSegmentIds: forceSegmentId ? [forceSegmentId] : null,
        forceSegmentIds: forceAll
          ? document.scenes.flatMap(scene => scene.segments.filter(seg => seg.kind === "speech").map(seg => seg.id))
          : forceSegmentId ? [forceSegmentId] : null,
      });
      if (revision !== renderRevision.current) {
        await invoke("discard_audio", { audioId: result.audio_id }).catch(() => {});
        return;
      }
      setAudio(result);
      onMessage(result.preview_available === false
        ? "Full-length WAV generated on disk. Inline preview is unavailable above 25 MiB; export the WAV to listen and review."
        : "A generated WAV is ready. Listen critically: multiple distinct character voices have NOT been verified.");
    } catch (error) {
      onMessage("Scene render stopped or failed: " + errorString(error));
    } finally {
      setJobId(null);
      setRendering(false);
    }
  }
  async function showRenderHistory() {
    const revision = renderRevision.current;
    setLoadingHistory(true);
    try {
      const records = await invoke<RenderHistory[]>("story_render_history", { storyId: document.id });
      if (revision !== renderRevision.current) return;
      setHistory(records.slice(0, 10));
      onMessage("Local history loaded. Interrupted jobs can be retried using unchanged cached dialogue.");
    } catch (error) {
      if (revision === renderRevision.current) {
        onMessage("Could not read local render history: " + errorString(error));
      }
    } finally {
      setLoadingHistory(false);
    }
  }

  async function forgetHistory(job: RenderHistory) {
    if (job.state === "running") return;
    if (!window.confirm("Forget this inactive render attempt and its temporary progress/cancel markers? The story, finished WAVs, exports and speech cache will remain unchanged.")) return;
    try {
      await invoke("forget_render_journal", { jobId: job.job_id, storyId: job.story_id });
      setHistory(previous => previous?.filter(item => item.job_id !== job.job_id) ?? null);
      onMessage("Render record and matching bookkeeping markers removed. Projects and completed WAV audio were untouched.");
    } catch (error) {
      onMessage("Cannot forget render history: " + errorString(error));
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
  async function exportSceneSubtitles() {
    if (!audio?.segment_timings?.length) return;
    try {
      const lines = document.scenes.flatMap(scene =>
        scene.segments.filter(segment => segment.kind === "speech")
          .map(segment => ({ segment_id: segment.id, text: segment.spoken_text })),
      );
      // Timings are derived from actual rendered PCM frames, not reading-speed estimates.
      const content = buildDialogueSrt(audio.segment_timings, lines);
      const destination = await save({
        title: "Export segment-timed Hindi SubRip subtitles",
        defaultPath: "kathasvara-dialogue.srt",
        filters: [{ name: "SubRip subtitles", extensions: ["srt"] }],
      });
      if (!destination) return;
      await invoke("export_subtitles", { destination, content });
      onMessage("Measured dialogue-level .srt captions exported. Review caption timing and text before publishing.");
    } catch (error) {
      onMessage("Cannot export dialogue subtitles: " + errorString(error));
    }
  }

  async function exportAudio() {
    if (!audio) return;
    try {
      const destination = await save({
        title: "Export scene or story dialogue WAV",
        defaultPath: "kathasvara-dialogue.wav",
        filters: [{ name: "Uncompressed WAV", extensions: ["wav"] }],
      });
      if (destination) {
        await invoke("export_wav", { audioId: audio.audio_id, destination });
        onMessage("Dialogue WAV exported locally.");
      }
    } catch (error) {
      onMessage("Cannot export audio: " + errorString(error));
    }
  }
  async function clearAudio() {
    if (!audio) return;
    const id = audio.audio_id;
    setAudio(null);
    try {
      await invoke("discard_audio", { audioId: id });
      onMessage("Generated dialogue preview removed from local audio cache.");
    } catch (error) {
      onMessage("Local cache deletion failed: " + errorString(error));
    }
  }
  async function parse() {
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
    setBusy(true);
    try {
      const response = await invoke<DialogueParseResponse>("parse_dialogue", {
        title: document.title, text: document.text,
        characters: document.characters,
        scriptId: document.id || null,
      });
      if (!response.ok) throw new Error("Dialogue parser returned an unsuccessful response.");
      if (audio) void invoke("discard_audio", { audioId: audio.audio_id }).catch(() => {});
      setAudio(null);
      renderRevision.current += 1;
      onChange({ ...response.result, pronunciation_glossary: document.pronunciation_glossary ?? [] });
      setUnresolved(response.unresolved);
      setSelectedScene(response.result.scenes[0]?.id ?? null);
      setDirty(true);
      onMessage(response.unresolved.length
        ? `Parsed with ${response.unresolved.length} unknown speaker label(s). Assign them manually before generating.`
        : `Parsed ${response.result.scenes.length} scene(s). Save the v2 story to preserve character assignments.`);
    } catch (error) {
      onMessage("Dialogue parsing failed: " + errorString(error));
    } finally {
      setBusy(false);
    }
  }
  async function saveDocument() {
    setBusy(true);
    try {
      const saved = await invoke<StoryV2>("save_story_v2", {
        project: { ...document, id: document.id || crypto.randomUUID() },
      });
      onChange(saved);
      setDirty(false);
      onMessage("Version 2 story and voice profiles saved atomically in local app data.");
    } catch (error) {
      onMessage("Unable to save version 2 story: " + errorString(error));
    } finally {
      setBusy(false);
    }
  }
  async function loadDocument() {
    if (dirty && !window.confirm("Discard current unsaved cast/scenes and load a saved v2 version?")) return;
    setBusy(true);
    try {
      const loaded = await invoke<StoryV2>("load_story_v2", { id: document.id });
      renderRevision.current += 1;
      if (audio) void invoke("discard_audio", { audioId: audio.audio_id }).catch(() => {});
      setAudio(null);
      onChange(loaded);
      setSelectedScene(loaded.scenes[0]?.id ?? null);
      setDirty(false);
      onMessage("Saved v2 story loaded. Legacy v0.1.x stories remain in their original folder.");
    } catch (error) {
      onMessage("No saved v2 story for this ID: " + errorString(error));
    } finally {
      setBusy(false);
    }
  }
  const activeScene = document.scenes.find(scene => scene.id === selectedScene) ?? document.scenes[0];
  const unresolvedNow = unresolvedSpeech(document);
  return (
    <section className="cast-layout" aria-label="Character and scene editor">
      <div className="panel cast-panel">
        <div className="section-label">CHARACTER LIBRARY / पात्र</div>
        <h2>Characters and voice profiles</h2>
        <p>Every character currently uses the same verified engine parameter set. Distinct voice identity and speaker conditioning are <strong>unavailable until actual model support is tested.</strong></p>
        <div className="cast-add">
          <input aria-label="New character name" placeholder="नया पात्र — e.g. राजा भोज" maxLength={120} value={newName}
            onChange={event => setNewName(event.target.value)} />
          <button className="secondary-button" onClick={addNewCharacter} disabled={busy || !newName.trim()}>+ Add</button>
        </div>
        <ul className="cast-list">
          {document.characters.map(char => (
            <li key={char.id}>
              <label>
                <span>Character name</span>
                <input value={char.name} disabled={char.id === "narrator"} maxLength={120}
                  onChange={event => {
                    try { edit(doc => renameCharacter(doc, char.id, event.target.value)); }
                    catch (error) { onMessage(errorString(error)); }
                  }} />
              </label>
              <div className="cast-voice-row">
                <label>Expression
                  <input type="range" min="0.25" max="2" step="0.05" value={char.voice.exaggeration}
                    onChange={event => edit(doc => ({
                      ...doc, characters: doc.characters.map(item => item.id === char.id
                        ? { ...item, voice: { ...item.voice, exaggeration: Number(event.target.value) } } : item),
                    }))} />
                </label>
                <label>CFG
                  <input type="range" min="0" max="1" step="0.05" value={char.voice.cfg_weight}
                    onChange={event => edit(doc => ({
                      ...doc, characters: doc.characters.map(item => item.id === char.id
                        ? { ...item, voice: { ...item.voice, cfg_weight: Number(event.target.value) } } : item),
                    }))} />
                </label>
              </div>
              <p className="helper">Hindi · Chatterbox Multilingual · pause {char.voice.pause_ms} ms · no distinct speaker verified</p>
              <div className="cast-actions">
                <button className="quiet-button" onClick={() => duplicateProfile(char.id)}>Duplicate voice profile</button>
                {char.id !== "narrator" && <button className="quiet-button" onClick={() => removeCharacter(char.id, char.name)}>Delete and reassign to narrator</button>}
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
          <button className="quiet-button" disabled={busy || rendering || !document.scenes.length}
            onClick={() => void startRender(undefined, undefined, true)}>Force re-render story</button>
          {activeScene && <button className="secondary-button" disabled={busy || rendering}
            onClick={() => void startRender(activeScene.id)}>Generate selected scene</button>}
          <button className="quiet-button" disabled={!rendering} onClick={() => void cancelRender()}>Cancel render</button>
          <button className="secondary-button" disabled={loadingHistory}
            onClick={() => void showRenderHistory()}>
            {loadingHistory ? "Reading history…" : "Recent render history"}
          </button>
          <div className="render-meter" role="status" aria-live="polite">
            {rendering
              ? (progress.total ? `Segments ${progress.done} / ${progress.total}` : "Loading local inference model…")
              : "Not generating"}
          </div>
          {history && <section className="inspection-panel" aria-label="Recent local render jobs">
            <strong>Recent render attempts for this story</strong>
            <p>Records store segment IDs and outcomes, not script text. Interrupted
              means a previous worker is no longer active in this app process.
              Generate again to reuse unchanged cached audio; retry is never automatic.</p>
            {history.length === 0
              ? <p>No recorded renders for this story yet.</p>
              : <ul>{history.map(item => (
                <li key={item.job_id}>
                  <strong>{item.state === "interrupted" ? "Interrupted — retry available" : item.state}</strong>
                  {" · "}{item.done}/{item.total} segments
                  {" · "}{item.updated_at}
                  <button className="quiet-button" type="button" disabled={item.state === "running"}
                    onClick={() => void forgetHistory(item)}>Forget record</button>
                </li>
              ))}</ul>}
          </section>}
          {audio && <>
            {audio.preview_available !== false
              ? <audio ref={audioRef} controls src={audio.data_url} aria-label="Generated dialogue preview" />
              : <p role="status">This long narration is saved locally, but exceeds the 25 MiB inline preview limit.
                Use <strong>Export WAV</strong> to copy the complete audio to a new file and listen in your preferred audio player.</p>}
            <small>{audio.duration_seconds.toFixed(1)} seconds · {audio.sample_rate} Hz · {audio.chunks} synthesis chunks
              {audio.file_bytes != null ? ` · ${(audio.file_bytes / (1024 * 1024)).toFixed(1)} MiB WAV` : ""}
            </small>
            <p className="helper">Subtitles are aligned to measured dialogue segments, not individual words.
              Review Hindi punctuation and timing before adding them to a video.</p>
            <div className="cast-actions">
              <button className="secondary-button" onClick={() => void exportAudio()}>Export WAV</button>
              <button className="secondary-button"
                disabled={!audio.segment_timings?.length}
                onClick={() => void exportSceneSubtitles()}>Export dialogue SRT</button>
              <button className="quiet-button" onClick={() => void clearAudio()}>Clear preview</button>
            </div>
          </>}
        </div>
        <p role="status" className={dirty ? "dirty-label" : "saved-label"}>{dirty ? "● Unsaved character or scene changes" : "✓ Version 2 story saved"}</p>
        {unresolved.length > 0 && <p role="alert">{unresolved.length} unknown speaker label(s): {unresolved.join(", ")}</p>}
        <div className="cast-add">
          <input placeholder="New scene title / नया दृश्य" aria-label="New scene title" value={newSceneTitle}
            maxLength={120} onChange={event => setNewSceneTitle(event.target.value)} />
          <button className="secondary-button" disabled={!newSceneTitle.trim() || busy || rendering} onClick={createScene}>+ Scene</button>
        </div>
        <div className="scene-navigation" aria-label="Scenes">
          {document.scenes.map(scene => (
            <button key={scene.id} className={"quiet-button " + (activeScene?.id === scene.id ? "selected-scene" : "")}
              onClick={() => setSelectedScene(scene.id)}>{scene.title}</button>
          ))}
        </div>
        {activeScene ? (
          <>
            <div className="cast-actions">
              <label className="scene-title-label">Scene title
                <input value={activeScene.title} maxLength={120} onChange={event => {
                  const title = event.target.value;
                  if (!title.trim()) return;
                  edit(doc => renameScene(doc, activeScene.id, title));
                }} />
              </label>
              <button className="quiet-button" onClick={() => edit(doc => moveScene(doc, activeScene.id, -1))}>↑ Move up</button>
              <button className="quiet-button" onClick={() => edit(doc => moveScene(doc, activeScene.id, 1))}>↓ Move down</button>
            </div>
            <ol className="scene-segments">
              {activeScene.segments.map(segment => (
                <li key={segment.id}>
                  <div className="segment-header">
                    <span>{segment.kind === "direction" ? "Stage direction (not spoken)" : "Spoken segment"}</span>
                    {segment.kind === "speech" && (
                      <select aria-label={"Speaker for " + segment.original_text.slice(0, 30)} value={segment.speaker_id ?? ""}
                        onChange={event => {
                          try { edit(doc => assignSegment(doc, segment.id, event.target.value)); }
                          catch (error) { onMessage(errorString(error)); }
                        }}>
                        <option value="">Unassigned — manual correction required</option>
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
                  <label className="move-segment-label">Move line to scene
                    <select aria-label={"Move line " + segment.id} value={activeScene.id}
                      onChange={event => {
                        try { edit(doc => moveSegment(doc, segment.id, event.target.value)); }
                        catch (error) { onMessage(errorString(error)); }
                      }}>
                      {document.scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.title}</option>)}
                    </select>
                  </label>
                  {segment.kind === "speech" && segment.speaker_id && (
                    <button className="quiet-button" disabled={rendering}
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
        <p className="helper">{unresolvedNow.length} unresolved speech segments. Actual distinct-character audio is not yet a supported feature. Source scripts are retained independently of parsed text.</p>
      </div>
    </section>
  );
}
