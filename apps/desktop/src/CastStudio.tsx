// SPDX-License-Identifier: MPL-2.0
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { AudioResult } from "./lib/story";
import {
  addCharacter, addScene, assignSegment, duplicateCharacter, moveScene, moveSegment, renameCharacter, reassignAndRemoveCharacter,
  renameScene, unresolvedSpeech, type DialogueParseResponse, type StoryV2,
} from "./lib/story_v2";

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
  const [audio, setAudio] = useState<AudioResult | null>(null);
  const renderRevision = useRef(0);
  const audioRef = useRef<HTMLAudioElement>(null);
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
  async function startRender(sceneId?: string, forceSegmentId?: string) {
    if (rendering) return;
    if (!document.scenes.length) {
      onMessage("Parse labeled dialogue before rendering selected scenes.");
      return;
    }
    const selected = sceneId ? document.scenes.filter(scene => scene.id === sceneId) : document.scenes;
    if (selected.some(scene => scene.segments.some(seg => seg.kind === "speech" && !seg.speaker_id))) {
      onMessage("Assign unresolved dialogue speakers before rendering.");
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
        forceSegmentIds: forceSegmentId ? [forceSegmentId] : null,
      });
      if (revision !== renderRevision.current) {
        await invoke("discard_audio", { audioId: result.audio_id }).catch(() => {});
        return;
      }
      setAudio(result);
      onMessage("A generated WAV is ready. Listen critically: multiple distinct character voices have NOT been verified.");
    } catch (error) {
      onMessage("Scene render stopped or failed: " + errorString(error));
    } finally {
      setJobId(null);
      setRendering(false);
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
    if (document.scenes.some(scene => scene.segments.some(segment => segment.audio_ref)) &&
        !window.confirm("Reparsing changes dialogue IDs or text. Previously generated segment previews may become stale. Continue?")) {
      return;
    }
    setBusy(true);
    try {
      const response = await invoke<DialogueParseResponse>("parse_dialogue", {
        title: document.title, text: document.text,
        characters: document.characters,
        scriptId: document.id,
      });
      if (!response.ok) throw new Error("Dialogue parser returned an unsuccessful response.");
      if (audio) void invoke("discard_audio", { audioId: audio.audio_id }).catch(() => {});
      setAudio(null);
      onChange(response.result);
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
      const saved = await invoke<StoryV2>("save_story_v2", { project: document });
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
        <div className="section-label">SCENES & DIALOGUE / दृश्य</div>
        <h2>Script breakdown</h2>
        <p>Use labels like <code>राजा भोज: नमस्कार।</code> and scene headings like <code># दरबार</code>. Unknown speaker names are never guessed.</p>
        <div className="cast-actions">
          <button className="secondary-button" disabled={busy || rendering} onClick={() => void parse()}>{busy ? "Processing…" : "Parse labeled Hindi script"}</button>
          <button className="secondary-button" disabled={busy} onClick={() => void saveDocument()}>Save cast and scenes</button>
          <button className="quiet-button" disabled={busy} onClick={() => void loadDocument()}>Load saved v2</button>
        </div>
        <div className="render-tools">
          <button className="primary-button" disabled={busy || rendering || !document.scenes.length}
            onClick={() => void startRender()}>Generate story dialogue WAV</button>
          {activeScene && <button className="secondary-button" disabled={busy || rendering}
            onClick={() => void startRender(activeScene.id)}>Generate selected scene</button>}
          <button className="quiet-button" disabled={!rendering} onClick={() => void cancelRender()}>Cancel render</button>
          <div className="render-meter" role="status" aria-live="polite">
            {rendering
              ? (progress.total ? `Segments ${progress.done} / ${progress.total}` : "Loading local inference model…")
              : "Not generating"}
          </div>
          {audio && <>
            <audio ref={audioRef} controls src={audio.data_url} aria-label="Generated dialogue preview" />
            <small>{audio.duration_seconds.toFixed(1)} seconds · {audio.sample_rate} Hz · {audio.chunks} synthesis chunks</small>
            <div className="cast-actions">
              <button className="secondary-button" onClick={() => void exportAudio()}>Export WAV</button>
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
                      Regenerate this line within scene
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
