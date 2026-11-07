// SPDX-License-Identifier: MPL-2.0
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import CastStudio from "./CastStudio";
import { version as desktopVersion } from "../package.json";
import { legacyToStoryV2, type StoryV2 } from "./lib/story_v2";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  AudioResult,
  EngineDiagnostics,
  countText,
  importedStoryTitle,
  GenerationStatus,
  STARTER_STORY,
  StoryProject,
  SUPPORT_LINKS,
  TextInspection,
  readSavedNumber,
  validateText,
} from "./lib/story";

type Page = "studio" | "cast" | "projects" | "settings" | "about";
type Theme = "dark" | "light";
type CacheStats = { files: number; bytes: number; ignored_entries: number };
type CachePruneReport = {
  files_before: number; bytes_before: number; candidates: number;
  bytes_reclaimable: number; dry_run: boolean; ignored_entries: number;
};
type AbandonedWavReport = {
  dry_run: boolean; candidates: number; bytes_reclaimable: number;
  removed: number; bytes_removed: number; ignored_entries: number;
  age_hours: number; max_deletions: number;
};
type OfflineWavProbe = {
  status: "passed" | "failed";
  failed_stage: "temporary_directory" | "write_pcm16" | "inspect_pcm16" | "cleanup" | null;
  temporary_wav_roundtrip_ok: boolean;
  model_loaded: false;
  hindi_listening_verified: false;
  audio_playback_verified: false;
  help: string;
};
type RuntimeImportProbe = {
  python_311: boolean;
  checks: Record<string, "ok" | "entrypoint_missing" | "import_failed">;
  failed_components: string[];
  imports_ok: boolean;
  tts_device_mode: "auto" | "cpu" | "invalid";
  device_configuration_valid: boolean;
  tts_model_variant: "v2" | "v3" | "invalid";
  model_configuration_valid: boolean;
  reference_voice_status: "not_set" | "valid" | "invalid";
  upstream_api_status: "not_requested" | "compatible" | "unavailable" |
    "v3_unsupported" | "reference_unsupported" | "unverifiable";
  upstream_api_compatible: boolean;
  preflight_ok: boolean;
  next_action_code?: "select_python_311" | "repair_tts_imports" |
    "fix_device_override" | "fix_model_selection" | "replace_reference_wav" |
    "update_chatterbox_api" | "verify_chatterbox_api" | "run_real_hindi_smoke";
  next_action?: string;
  model_weights_verified: false;
  audio_synthesis_verified: false;
  help: string;
};
const WAV_IO_REPAIR_ACTIONS: Record<NonNullable<OfflineWavProbe["failed_stage"]>, string> = {
  temporary_directory: "Check whether Python can create files in its temporary directory and whether the disk has free space.",
  write_pcm16: "Check temporary-folder write permissions, available disk space and security software restrictions.",
  inspect_pcm16: "Update KathaSvara inference sources, then rerun the synthetic WAV check. This does not inspect your voice recording.",
  cleanup: "Check whether the temporary folder permits deleting the test file. No story or reference voice was touched.",
};
const CACHE_TARGET_MIB = 512;
const OLD_PROBE_GUIDANCE = "Update the local KathaSvara inference sources to match this desktop build, then repeat the model-free speech probe.";
function nextProbeAction(report: RuntimeImportProbe): string {
  return typeof report.next_action === "string" && report.next_action.trim()
    ? report.next_action : OLD_PROBE_GUIDANCE;
}
function asMiB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2) + " MiB";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function App() {
  const [page, setPage] = useState<Page>("studio");
  const [theme, setTheme] = useState<Theme>(() =>
    localStorage.getItem("kathasvara-theme") === "light" ? "light" : "dark",
  );
  const [project, setProject] = useState<StoryProject>({
    id: "", title: "मेरी पहली कहानी", text: STARTER_STORY,
  });
  const [projects, setProjects] = useState<StoryProject[]>([]);
  const [castDoc, setCastDoc] = useState<StoryV2>(() =>
    legacyToStoryV2({ id: "", title: "मेरी पहली कहानी", text: STARTER_STORY }));
  const [exaggeration, setExaggeration] = useState(() =>
    readSavedNumber(localStorage.getItem("kathasvara-exaggeration"), 0.25, 2, 0.5),
  );
  const [cfgWeight, setCfgWeight] = useState(() =>
    readSavedNumber(localStorage.getItem("kathasvara-guidance"), 0, 1, 0.5),
  );
  const [inspection, setInspection] = useState<TextInspection | null>(null);
  const [diagnostics, setDiagnostics] = useState<EngineDiagnostics | null>(null);
  const [checkingSetup, setCheckingSetup] = useState(false);
  const [configuringRuntime, setConfiguringRuntime] = useState(false);
  const [sessionRuntimeConfigured, setSessionRuntimeConfigured] = useState(false);
  const [probingImports, setProbingImports] = useState(false);
  const [checkingAudioIo, setCheckingAudioIo] = useState(false);
  const [audioIoReport, setAudioIoReport] = useState<OfflineWavProbe | null>(null);
  const [importProbe, setImportProbe] = useState<RuntimeImportProbe | null>(null);
  // Never persist the user's private reference WAV path to projects or localStorage.
  const [referenceWavPath, setReferenceWavPath] = useState<string | null>(null);
  // Native dialogs and no-model Python probes can resolve out of order.
  const referencePickerRevision = useRef(0);
  const runtimePickerRevision = useRef(0);
  const importProbeRevision = useRef(0);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [cachePlan, setCachePlan] = useState<CachePruneReport | null>(null);
  const [checkingCache, setCheckingCache] = useState(false);
  const [cleanupPreview, setCleanupPreview] = useState<AbandonedWavReport | null>(null);
  const [checkingPartials, setCheckingPartials] = useState(false);
  const [status, setStatus] = useState<GenerationStatus>("waiting");
  const [message, setMessage] = useState("अभी तक कोई ऑडियो तैयार नहीं हुआ है।");
  const [audio, setAudio] = useState<AudioResult | null>(null);
  const [working, setWorking] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  // Invalidates in-flight results when the user edits any generation input.
  const generationRevision = useRef(0);
  const counts = countText(project.text);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("kathasvara-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("kathasvara-exaggeration", String(exaggeration));
    localStorage.setItem("kathasvara-guidance", String(cfgWeight));
  }, [exaggeration, cfgWeight]);

  function invalidateGeneration() {
    generationRevision.current += 1;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (audio) {
      void invoke("discard_audio", { audioId: audio.audio_id }).catch(() => {
        // A failed cache cleanup must not block further editing.
      });
    }
    setAudio(null);
    setInspection(null);
    setStatus("waiting");
  }

  function changeScript(text: string) {
    invalidateGeneration();
    setProject((previous) => ({ ...previous, text }));
    // Previous parsed scenes may not correspond to edited dialogue.
    setCastDoc(previous => ({ ...previous, text, scenes: [] }));
  }

  function changeExaggeration(value: number) {
    invalidateGeneration();
    setExaggeration(value);
  }

  function changeGuidance(value: number) {
    invalidateGeneration();
    setCfgWeight(value);
  }

  async function importStoryFile(event: ChangeEvent<HTMLInputElement>) {
    const picker = event.currentTarget;
    const file = picker.files?.item(0);
    picker.value = "";
    if (!file) return;
    const title = importedStoryTitle(file.name);
    if (!title) {
      setMessage("Only UTF-8 .txt and .md story files can be imported.");
      return;
    }
    if (file.size > 250_000) {
      setMessage("Story file is too large. The 250 KB import limit protects the editor.");
      return;
    }
    if (project.text.trim() && !window.confirm("Replace the current editor with a new imported story? Save the current project first if needed.")) {
      return;
    }
    try {
      const text = await file.text();
      if (text.includes("\u0000")) {
        setMessage("The selected file appears to be binary rather than a text story.");
        return;
      }
      invalidateGeneration();
      const normalized = text.replace(/\r\n?/g, "\n");
      const imported = { id: "", title, text: normalized };
      setProject(imported);
      setCastDoc(legacyToStoryV2(imported));
      setMessage("Story imported as a new unsaved project. Review it before generating or saving.");
      setPage("studio");
    } catch (error) {
      setMessage("Unable to read selected story file: " + errorMessage(error));
    }
  }

  async function inspectScript() {
    const error = validateText(project.text);
    if (error) {
      setMessage(error);
      return;
    }
    const revision = generationRevision.current;
    try {
      const inspected = await invoke<TextInspection>("inspect_script", { text: project.text });
      if (revision !== generationRevision.current) return;
      setInspection(inspected);
      setMessage("Review how Hindi will be normalized and split before generating.");
    } catch (error) {
      setInspection(null);
      setMessage("Inspection failed: " + errorMessage(error));
    }
  }

  async function refreshProjects() {
    try {
      setProjects(await invoke<StoryProject[]>("list_projects"));
    } catch (error) {
      setMessage("Cannot load local projects: " + errorMessage(error));
    }
  }

  async function saveProject() {
    try {
      const updated = await invoke<StoryProject>("save_project", { project });
      setProject((current) =>
        current.id === project.id ? { ...current, id: updated.id } : current,
      );
      setCastDoc((current) => ({ ...current, id: updated.id }));
      setMessage("Project saved locally. Changes made during saving may need another save.");
      await refreshProjects();
    } catch (error) {
      setMessage("Save failed: " + errorMessage(error));
    }
  }

  async function openProject(id: string) {
    try {
      const loaded = await invoke<StoryProject>("load_project", { id });
      invalidateGeneration();
      setProject(loaded);
      setCastDoc(legacyToStoryV2(loaded));
      setPage("studio");
      setMessage("Project loaded. Generate a new preview when ready.");
    } catch (error) {
      setMessage("Load failed: " + errorMessage(error));
    }
  }

  function invalidateReferenceProbe() {
    importProbeRevision.current += 1;
    setProbingImports(false);
    setImportProbe(null);
  }

  async function chooseLocalRuntime() {
    const revision = ++runtimePickerRevision.current;
    setConfiguringRuntime(true);
    try {
      const python = await open({
        title: "Select your trusted Python 3.11 interpreter (python.exe on Windows)",
        multiple: false, directory: false,
      });
      if (revision !== runtimePickerRevision.current || typeof python !== "string") return;
      const inference = await open({
        title: "Select the KathaSvara services/inference source folder",
        multiple: false, directory: true,
      });
      if (revision !== runtimePickerRevision.current || typeof inference !== "string") return;
      // Both selections are validated atomically by Rust; neither is stored
      // in localStorage, project JSON, React diagnostics, or public logs.
      await invoke("configure_local_inference", {
        pythonPath: python, inferenceDir: inference,
      });
      if (revision !== runtimePickerRevision.current) return;
      setSessionRuntimeConfigured(true);
      setDiagnostics(null);
      setAudioIoReport(null);
      invalidateReferenceProbe();
      setMessage("Working Python 3.11 and matching KathaSvara source verified for this app session. Run the TTS preflight; packages, weights and real Hindi audio remain unverified.");
    } catch {
      if (revision === runtimePickerRevision.current) {
        setMessage("Could not configure the local speech runtime. Choose a working Python 3.11 interpreter and KathaSvara inference sources matching this desktop version. The previous selection, if any, remains unchanged.");
      }
    } finally {
      if (revision === runtimePickerRevision.current) setConfiguringRuntime(false);
    }
  }

  async function clearLocalRuntime() {
    runtimePickerRevision.current += 1;
    setConfiguringRuntime(true);
    try {
      await invoke("clear_local_inference");
      setSessionRuntimeConfigured(false);
      setDiagnostics(null);
      setAudioIoReport(null);
      invalidateReferenceProbe();
      setMessage("Session runtime selection cleared. New jobs use the launcher environment or automatic source discovery.");
    } catch {
      setMessage("Unable to clear the session runtime selection.");
    } finally {
      setConfiguringRuntime(false);
    }
  }

  async function chooseReferenceVoice() {
    const pickerRevision = ++referencePickerRevision.current;
    try {
      const selected = await open({
        title: "Choose your own or consented voice reference",
        multiple: false,
        directory: false,
        filters: [{ name: "Local PCM16 WAV recording", extensions: ["wav"] }],
      });
      if (pickerRevision !== referencePickerRevision.current ||
          typeof selected !== "string") return;
      invalidateGeneration();
      setReferenceWavPath(selected);
      invalidateReferenceProbe();
      setMessage("Session voice reference selected. Run the no-model TTS preflight before generating.");
    } catch {
      if (pickerRevision === referencePickerRevision.current) {
        setMessage("Unable to open local WAV selection dialog. No reference was changed.");
      }
    }
  }

  function clearReferenceVoice() {
    // Retire any older picker before it can restore a now-cleared reference.
    referencePickerRevision.current += 1;
    invalidateGeneration();
    setReferenceWavPath(null);
    invalidateReferenceProbe();
    setMessage("Session voice selection cleared. The launcher default, if configured, will apply.");
  }

  async function generate() {
    const invalid = validateText(project.text);
    if (invalid) {
      setStatus("failed");
      setMessage(invalid);
      return;
    }
    const revision = generationRevision.current;
    setWorking(true);
    setAudio(null);
    setStatus("loading");
    setMessage("Loading Hindi model and generating genuine speech locally. First use may download model weights.");
    try {
      const result = await invoke<AudioResult>("synthesize", {
        text: project.text,
        exaggeration,
        cfgWeight,
        referenceWavPath,
      });
      if (revision !== generationRevision.current) {
        void invoke("discard_audio", { audioId: result.audio_id }).catch(() => {});
        // A changed reference, script, or voice slider owns the newer status.
        // Do not replace its message with this obsolete worker's response.
        return;
      }
      setAudio(result);
      setStatus("completed");
      setMessage(result.preview_available === false
        ? "Hindi WAV generated and kept locally. It exceeds the 25 MiB inline playback limit; use Export WAV to listen in an audio player."
        : "Hindi WAV ready. Listen before exporting to check pronunciation and quality.");
    } catch (error) {
      if (revision === generationRevision.current) {
        setStatus("failed");
        setMessage("Hindi speech was not generated: " + errorMessage(error) +
          " This developer EXE does not bundle Python, the inference source, Chatterbox dependencies or model weights. Open Settings → Inspect local TTS setup and follow the audio installation guide.");
      }
    } finally {
      setWorking(false);
    }
  }

  async function clearPreview() {
    if (!audio) return;
    const audioId = audio.audio_id;
    setAudio(null);
    setStatus("waiting");
    try {
      await invoke("discard_audio", { audioId });
      setMessage("Local generated-audio preview deleted.");
    } catch (error) {
      setMessage("Preview hidden, but cache cleanup failed: " + errorMessage(error));
    }
  }

  async function exportWav() {
    if (!audio) return;
    try {
      const destination = await save({
        title: "Export Hindi narration",
        defaultPath: "kathasvara-narration.wav",
        filters: [{ name: "Uncompressed Wave audio", extensions: ["wav"] }],
      });
      if (!destination) return;
      await invoke("export_wav", { audioId: audio.audio_id, destination });
      setMessage("WAV exported successfully.");
    } catch (error) {
      setMessage("Export failed: " + errorMessage(error) + " Choose a new filename if the file already exists.");
    }
  }

  async function diagnoseRuntime() {
    setCheckingSetup(true);
    try {
      const details = await invoke<EngineDiagnostics>("diagnose_engine");
      setDiagnostics(details);
      setMessage(details.dependencies_present
        ? "Python dependencies appear installed. Model weights and real Hindi audio are NOT validated."
        : "Local speech dependencies are incomplete. See the diagnostics below.");
    } catch (error) {
      setDiagnostics(null);
      setMessage("Local diagnostic unavailable: " + errorMessage(error));
    } finally {
      setCheckingSetup(false);
    }
  }

  async function verifyAudioIo() {
    setCheckingAudioIo(true);
    setAudioIoReport(null);
    try {
      const report = await invoke<OfflineWavProbe>("probe_audio_io");
      setAudioIoReport(report);
      setMessage(report.temporary_wav_roundtrip_ok
        ? "Temporary WAV write/read passed. Speech, speakers and playback are still unverified."
        : "Temporary WAV I/O needs attention. Check the failing stage in Settings.");
    } catch {
      // Native/OS errors may contain private filesystem paths. Never reflect
      // exception details or the user's reference path into the Settings UI.
      setMessage("Cannot run the WAV I/O check. Configure Python 3.11 and local inference sources.");
    } finally {
      setCheckingAudioIo(false);
    }
  }

  async function verifyTtsImports() {
    const probeRevision = ++importProbeRevision.current;
    setProbingImports(true);
    setImportProbe(null);
    try {
      const report = await invoke<RuntimeImportProbe>("probe_tts_runtime", {
        referenceWavPath,
      });
      if (probeRevision !== importProbeRevision.current) return;
      setImportProbe(report);
      setMessage(report.preflight_ok
        ? "TTS preflight passed. Model weights, Hindi generation, and voice quality are still unverified."
        : "TTS preflight needs attention. " + nextProbeAction(report));
    } catch (error) {
      if (probeRevision === importProbeRevision.current) {
        setMessage("TTS import probe could not run: " + errorMessage(error));
      }
    } finally {
      if (probeRevision === importProbeRevision.current) {
        setProbingImports(false);
      }
    }
  }

  async function inspectCache() {
    setCheckingCache(true);
    try {
      const report = await invoke<CacheStats>("inspect_segment_cache");
      setCacheStats(report);
      setCachePlan(null);
      setMessage("Cache inspection complete. No files were changed.");
    } catch (error) {
      setMessage("Cache inspection failed: " + errorMessage(error));
    } finally {
      setCheckingCache(false);
    }
  }

  async function previewCacheCleanup() {
    setCheckingCache(true);
    setCachePlan(null);
    try {
      const plan = await invoke<CachePruneReport>("prune_segment_cache", {
        maxMib: CACHE_TARGET_MIB, dryRun: true,
      });
      setCachePlan(plan);
      setMessage("Cache cleanup preview only; no files were deleted.");
    } catch (error) {
      setMessage("Cannot preview cache cleanup: " + errorMessage(error));
    } finally {
      setCheckingCache(false);
    }
  }

  async function applyCacheCleanup() {
    if (!cachePlan || cachePlan.candidates === 0) return;
    if (!window.confirm(
      `Delete eligible old cached speech segments above ${CACHE_TARGET_MIB} MiB? ` +
      "Source projects and exported audio will not be touched. Deleted cached segments must be regenerated.",
    )) return;
    setCheckingCache(true);
    setCachePlan(null);
    try {
      const result = await invoke<CachePruneReport>("prune_segment_cache", {
        maxMib: CACHE_TARGET_MIB, dryRun: false,
      });
      setCacheStats(await invoke<CacheStats>("inspect_segment_cache"));
      setMessage(`Removed ${asMiB(result.bytes_reclaimable)} of old segment-cache entries. ` +
        "Projects and exported audio were not touched.");
    } catch (error) {
      setMessage("Cache cleanup failed: " + errorMessage(error));
    } finally {
      setCheckingCache(false);
    }
  }

  async function inspectAbandonedAudio() {
    setCheckingPartials(true);
    setCleanupPreview(null);
    try {
      const report = await invoke<AbandonedWavReport>("maintain_abandoned_wavs", { dryRun: true });
      setCleanupPreview(report);
      setMessage("Abandoned partial WAV preview completed; no audio or projects were deleted.");
    } catch (error) {
      setMessage("Unable to inspect abandoned audio: " + errorMessage(error));
    } finally {
      setCheckingPartials(false);
    }
  }

  async function removeAbandonedAudio() {
    if (!cleanupPreview || cleanupPreview.candidates === 0) return;
    if (!window.confirm(
      "Permanently delete generated temporary WAV files older than 24 hours? " +
      "Complete WAV recordings, project files, speech cache entries and render journals will be kept. " +
      "No active render may be using the shared cache.",
    )) return;
    setCheckingPartials(true);
    setCleanupPreview(null);
    try {
      const report = await invoke<AbandonedWavReport>("maintain_abandoned_wavs", { dryRun: false });
      setMessage(`Removed ${report.removed} old temporary WAV files (${asMiB(report.bytes_removed)}). ` +
        "Completed narration, cached segments, stories and render history remain untouched.");
    } catch (error) {
      setMessage("Abandoned-audio cleanup failed: " + errorMessage(error));
    } finally {
      setCheckingPartials(false);
    }
  }

  async function checkRuntime() {
    try {
      const result = await invoke<string>("check_engine");
      setMessage(result);
    } catch (error) {
      setMessage("Runtime unavailable: " + errorMessage(error));
    }
  }

  const nav: { key: Page; icon: string; label: string }[] = [
    { key: "studio", icon: "◉", label: "Voice Studio" },
    { key: "cast", icon: "♧", label: "Characters & Scenes" },
    { key: "projects", icon: "▤", label: "My Stories" },
    { key: "settings", icon: "⚙", label: "Settings" },
    { key: "about", icon: "ⓘ", label: "About" },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-icon">क</div><div><strong>KathaSvara</strong><span>कथास्वर</span></div></div>
        <div className="side-group">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button key={item.key} className={"nav-item " + (page === item.key ? "active" : "")}
              onClick={() => { setPage(item.key); if (item.key === "projects") void refreshProjects(); }}>
              <span aria-hidden="true">{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="side-tag">LOCAL FIRST</span>
          <p>Your scripts stay on your machine. No account required.</p>
          <small>v{desktopVersion} · Experimental developer preview</small>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div><span className="eyebrow">CREATIVE AUDIO STUDIO</span><h1>{page === "studio" ? "Give Every Story a Voice." : page === "cast" ? "Characters & Scenes" : page === "projects" ? "Your story library" : page === "settings" ? "Preferences" : "About KathaSvara"}</h1></div>
          <div className="header-actions"><span className="chip">हिन्दी · Hindi</span><button className="quiet-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "☀ Light" : "☾ Dark"}</button></div>
        </header>

        <main>
          {page === "studio" && (
            <div className="studio-grid">
              <section className="panel editor-panel">
                <div className="panel-heading"><div><div className="section-label">01 / SCRIPT</div><h2>Story editor</h2><p>Write in Hindi, naturally.</p></div><button className="quiet-button" onClick={() => void saveProject()}>Save project</button></div>
                <label htmlFor="story-title" className="field-label">PROJECT TITLE</label>
                <input id="story-title" className="title-input" value={project.title} maxLength={120} onChange={(e) => {
                  setProject({ ...project, title: e.target.value });
                  setCastDoc(previous => ({ ...previous, title: e.target.value }));
                }} />
                <label htmlFor="story-text" className="field-label">NARRATION TEXT</label>
                <textarea id="story-text" className="story-text" lang="hi" spellCheck value={project.text} onChange={(e) => changeScript(e.target.value)} aria-describedby="script-stats" placeholder="अपनी कहानी यहाँ लिखें..." />
                <div id="script-stats" className="editor-footer"><span>{counts.characters.toLocaleString("en-IN")} / 3,000 characters</span><span>{counts.words} words</span></div>
                <label className="import-control" htmlFor="import-story">Import UTF-8 text or Markdown story</label>
                <input id="import-story" type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => void importStoryFile(event)} />
                <button className="quiet-button inspect-button" disabled={working} onClick={() => void inspectScript()}>Inspect Hindi pronunciation text ↗</button>
                {inspection && (
                  <div className="inspection-panel" aria-label="Hindi text inspection">
                    <div className="section-label">BEFORE GENERATION</div>
                    <p>{inspection.characters} normalized characters · {inspection.chunk_count} speech segment(s)</p>
                    <p>{inspection.changed
                      ? "Spaces or Unicode normalization changed. Original script has not been modified."
                      : "No normalization changes needed."}</p>
                    <details>
                      <summary>Show exact text and speech segments</summary>
                      <pre lang="hi">{inspection.normalized}</pre>
                      <ol lang="hi">{inspection.chunks.map((part, index) => (
                        <li key={index}>{part}</li>
                      ))}</ol>
                    </details>
                    {inspection.changed && (
                      <button className="secondary-button" onClick={() => changeScript(inspection.normalized)}>
                        Apply normalized text to editor
                      </button>
                    )}
                  </div>
                )}
              </section>
              <div className="right-column">
                <section className="panel voice-panel">
                  <div className="section-label">02 / VOICE</div><h2>Voice settings</h2>
                  <div className="engine"><span className="engine-mark">◈</span><div><strong>Chatterbox Multilingual</strong><small>Local model · Hindi (hi)</small></div><span className="experimental">Setup required</span></div>
                  <label className="range-label" htmlFor="exaggeration">Expressiveness <strong>{exaggeration.toFixed(2)}</strong></label>
                  <input id="exaggeration" type="range" min="0.25" max="2" step="0.05" value={exaggeration} onChange={(e) => changeExaggeration(Number(e.target.value))} />
                  <label className="range-label" htmlFor="cfg">CFG guidance <strong>{cfgWeight.toFixed(2)}</strong></label>
                  <input id="cfg" type="range" min="0" max="1" step="0.05" value={cfgWeight} onChange={(e) => changeGuidance(Number(e.target.value))} />
                  <p className="helper" aria-label="Active narration reference mode">
                    <strong>Voice reference:</strong> {referenceWavPath === null
                      ? "Launcher/default model conditioning (if available)."
                      : "Session-selected local WAV (private path hidden). The model will try to condition on this one recording."}
                  </p>
                  <p className="helper">Only controls supported by the selected model are shown. Generating does not upload your script.</p>
                  <p className="helper"><strong>Real audio setup required:</strong> this developer EXE does not contain Python, Chatterbox, or model weights. The Windows audio setup guide includes a real Hindi WAV smoke test; a passing dependency check alone is not enough.</p>
                  <button className="quiet-button" type="button"
                    onClick={() => setPage("settings")}>Open local TTS diagnostics</button>
                  <button className="primary-button" disabled={working} onClick={() => void generate()}>{working ? "Generating speech…" : "✦ Generate Hindi Voice"}</button>
                </section>
                <section className="panel preview-panel">
                  <div className="section-label">03 / LISTEN</div><h2>Audio preview</h2>
                  <div className={"status status-" + status} role="status" aria-live="polite"><span aria-hidden="true">●</span>{status === "waiting" ? "Waiting" : status === "loading" ? "Model loading / synthesizing" : status === "completed" ? "Completed" : "Failed"}</div>
                  {audio ? (
                    <>
                      {audio.preview_available === false
                        ? <p role="status">The generated WAV is saved locally but is too large for an inline preview.
                          Select <strong>Export WAV</strong> and listen in your audio player. The recording has not been discarded.</p>
                        : <audio ref={audioRef} controls src={audio.data_url} aria-label="Generated Hindi WAV preview" />}
                      <div className="audio-meta">{audio.duration_seconds.toFixed(1)} sec · {audio.sample_rate} Hz · {audio.chunks} chunk(s)</div>
                      <div className="preview-actions">
                        {audio.preview_available !== false && <button className="quiet-button"
                          onClick={() => { if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; } }}>■ Stop</button>}
                        <button className="quiet-button" onClick={() => void clearPreview()}>Clear preview</button>
                        <button className="secondary-button" onClick={() => void exportWav()}>Export WAV ↓</button>
                      </div>
                    </>
                  ) : <div className="empty-preview"><div className="waveform" aria-hidden="true">▂ ▆ ▃ █ ▅ ▇ ▃ ▅ ▂ ▆ ▃</div><span>Your audio preview appears here.</span></div>}
                </section>
              </div>
            </div>
          )}

          {page === "cast" && (
            <CastStudio document={castDoc} onChange={setCastDoc} onMessage={setMessage}
              referenceWavPath={referenceWavPath} />
          )}

          {page === "projects" && (
            <section className="panel"><div className="panel-heading"><div className="section-label">YOUR WORK</div><button className="secondary-button" onClick={() => { invalidateGeneration(); setProject({ id:"", title:"नई कहानी", text:"" }); setCastDoc(legacyToStoryV2({ id:"", title:"नई कहानी", text:"" })); setPage("studio"); }}>+ New story</button></div>
              <h2>Saved stories</h2><p>Stored in the application data folder on this device.</p>
              {projects.length === 0 ? <div className="empty-preview">No saved projects yet. Save a script in Voice Studio.</div> : <ul className="project-list">{projects.map((item) => <li key={item.id}><div><strong>{item.title}</strong><small>{countText(item.text).characters} characters</small></div><button className="secondary-button" onClick={() => void openProject(item.id)}>Open →</button></li>)}</ul>}
            </section>
          )}

          {page === "settings" && (
            <section className="panel simple-page">
              <div className="section-label">APPLICATION</div><h2>Settings</h2>
              <p>Appearance and a diagnostic check of the Python integration. This is a development preview, not a standalone packaged runtime.</p>
              <label className="field-label" htmlFor="theme-select">COLOR THEME</label>
              <select id="theme-select" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}><option value="dark">Dark</option><option value="light">Light</option></select>
              <section aria-label="Local Python setup" className="diagnostic-report">
                <h3>Connect your local speech runtime</h3>
                <p className="helper">To enable narration, character renders and audio export on a developer EXE,
                  select your trusted, working Python 3.11 interpreter and the matching KathaSvara
                  <code>services/inference</code> folder. Speech libraries and authorized model weights
                  must already be installed separately. The desktop checks the Python 3.11 version and matching source version before activating. Selecting files never installs packages,
                  loads a model, changes system settings, or uploads a recording.</p>
                <button className="secondary-button" disabled={configuringRuntime || working}
                  onClick={() => void chooseLocalRuntime()}>
                  {configuringRuntime ? "Choosing local runtime…" : "Choose Python and inference folder"}
                </button>
                {sessionRuntimeConfigured && (
                  <button className="quiet-button" disabled={configuringRuntime || working}
                    onClick={() => void clearLocalRuntime()}>
                    Clear session runtime selection
                  </button>
                )}
                <p role="status"><strong>Runtime selection:</strong> {sessionRuntimeConfigured
                  ? "Local Python and sources selected for this app session (private paths hidden)"
                  : "Launcher-provided Python and source discovery"}</p>
                <p className="helper">This selection affects new Python jobs only and is not saved
                  after the app closes. Use the no-model checks below to confirm installation.
                  A valid interpreter location is not proof that Hindi speech works.</p>
              </section>
              <button className="secondary-button" onClick={() => void checkRuntime()}>Check Python bridge</button>
              <button className="secondary-button" disabled={checkingSetup} onClick={() => void diagnoseRuntime()}>
                {checkingSetup ? "Checking dependencies…" : "Inspect local TTS setup"}
              </button>
              <div className="field-label">OPTIONAL CONSENTED LOCAL VOICE</div>
              <p className="helper">Select a WAV recording that you own or have permission to use.
                KathaSvara uses one reference for the entire render, not different voices per
                character. The selection is kept in memory for this app session only; its path
                is not shown here, stored in projects, or uploaded.</p>
              <button className="secondary-button" onClick={() => void chooseReferenceVoice()}>
                Choose local reference WAV
              </button>
              {referenceWavPath !== null && (
                <button className="quiet-button" onClick={clearReferenceVoice}>
                  Clear session voice selection
                </button>
              )}
              <p role="status"><strong>Session reference:</strong> {referenceWavPath === null
                ? "Launcher default (if available)"
                : "Local recording selected (private path hidden)"}</p>
              <button className="secondary-button" disabled={checkingAudioIo} onClick={() => void verifyAudioIo()}>
                {checkingAudioIo ? "Checking temporary WAV I/O…" : "Test temporary WAV I/O (no model or playback)"}
              </button>
              <p className="helper">Writes, inspects and deletes one disposable 250 ms synthetic PCM16 WAV in Python's temporary folder.
                No TTS model, speech packages, microphone, speakers, private story or reference voice are used.
                Passing here does not verify actual Hindi generation or the final export destination.</p>
              {audioIoReport && (
                <section aria-label="Offline WAV I/O result" className="diagnostic-report" role="status">
                  <h3>WAV I/O: {audioIoReport.temporary_wav_roundtrip_ok ? "Temporary round-trip passed" : "Temporary round-trip failed"}</h3>
                  {audioIoReport.failed_stage && (
                    <>
                      <p><strong>Failed stage:</strong> {audioIoReport.failed_stage}</p>
                      <p><strong>Recommended next step:</strong> {WAV_IO_REPAIR_ACTIONS[audioIoReport.failed_stage]}</p>
                    </>
                  )}
                  <p><strong>Model / Hindi speech / playback verified:</strong> No</p>
                  <p>{audioIoReport.help}</p>
                </section>
              )}
              <button className="secondary-button" disabled={probingImports} onClick={() => void verifyTtsImports()}>
                {probingImports ? "Verifying speech library imports…" : "Verify speech library imports (no model load)"}
              </button>
              <p className="helper">Dependency discovery only checks for installed modules. The optional import preflight checks whether
                their Python imports work and whether the device and model overrides are valid; neither test loads model weights or generates speech.</p>
              {importProbe && (
                <section aria-label="TTS import probe result" className="diagnostic-report" role="status">
                  <h3>TTS preflight: {importProbe.preflight_ok ? "Setup passed (no model loaded)" : "Setup needs attention"}</h3>
                  <p><strong>Recommended next step:</strong> {nextProbeAction(importProbe)}</p>
                  <p>Python 3.11: {importProbe.python_311 ? "Yes" : "Required"}</p>
                  <p><strong>TTS device:</strong> {importProbe.tts_device_mode === "invalid"
                    ? "Invalid override — use auto or cpu" : importProbe.tts_device_mode}
                    {" "}({importProbe.device_configuration_valid ? "configuration accepted" : "fix before generating"})
                  </p>
                  <p><strong>Multilingual checkpoint:</strong> {importProbe.tts_model_variant === "invalid"
                    ? "Invalid override — use v2 or v3" : importProbe.tts_model_variant}
                    {" "}({importProbe.model_configuration_valid ? "selection accepted" : "fix before generating"})
                  </p>
                  <p className="helper">V3 is opt-in through KATHASVARA_TTS_MODEL=v3 and may need updated
                    Chatterbox software and additional weights. This selection check does not download
                    weights or establish real Hindi generation quality.</p>
                  <p><strong>Local voice reference:</strong> {importProbe.reference_voice_status === "valid"
                    ? "Validated local PCM16 WAV (not uploaded)" : importProbe.reference_voice_status === "invalid"
                      ? "Invalid reference — check selected WAV" : "Not configured (uses bundled default voice if available)"}
                  </p>
                  <p className="helper">Only use recordings you own or have permission to use. A valid
                    reference does not prove speaker identity, audio quality or model compatibility.</p>
                  <p><strong>Installed Chatterbox API:</strong> {importProbe.upstream_api_status === "not_requested"
                    ? "Legacy V2 mode — optional API not required"
                    : importProbe.upstream_api_status === "compatible"
                      ? "Selected optional API signatures present"
                      : importProbe.upstream_api_status === "v3_unsupported"
                        ? "Installed package does not support V3 checkpoint selection"
                        : importProbe.upstream_api_status === "reference_unsupported"
                          ? "Installed package does not support reference audio prompts"
                          : importProbe.upstream_api_status === "unavailable"
                            ? "Chatterbox API unavailable"
                            : "Cannot verify the installed API signatures"}
                    {" "}({importProbe.upstream_api_compatible ? "signature check passed" : "check package compatibility"})
                  </p>
                  <p className="helper">Signature checks do not load a model, verify its weights, or establish
                    that the selected voice and Hindi generation will work.</p>
                  <ul>
                    {Object.entries(importProbe.checks).map(([module, result]) => (
                      <li key={module}><strong>{module}</strong>: {result === "ok"
                        ? "Imported" : result === "entrypoint_missing" ? "Required API not found" : "Import failed"}</li>
                    ))}
                  </ul>
                  <p><strong>Model weights / real Hindi audio verified:</strong> No</p>
                  <p>{importProbe.help}</p>
                </section>
              )}
              <section aria-label="Local segment-cache maintenance" className="diagnostic-report">
                <h3>Generated segment cache</h3>
                <p>Inspect or explicitly clean old content-addressed speech chunks.
                  The 512 MiB cleanup retains files newer than 10 minutes and does
                  not touch saved projects, generated previews, or exported WAV files.
                  Older removed segments will require synthesis again.</p>
                <div className="preview-actions">
                  <button className="secondary-button" disabled={checkingCache}
                    onClick={() => void inspectCache()}>Inspect cache</button>
                  <button className="secondary-button" disabled={checkingCache}
                    onClick={() => void previewCacheCleanup()}>Preview 512 MiB cleanup</button>
                  <button className="quiet-button"
                    disabled={checkingCache || !cachePlan || cachePlan.candidates === 0}
                    onClick={() => void applyCacheCleanup()}>Confirm cleanup…</button>
                </div>
                {cacheStats && <p role="status">
                  Current entries: {cacheStats.files} · {asMiB(cacheStats.bytes)}
                  {cacheStats.ignored_entries > 0 &&
                    ` · ${cacheStats.ignored_entries} unrelated entries ignored`}
                </p>}
                {cachePlan && <p role="status">
                  Dry run: {cachePlan.candidates} eligible files,
                  up to {asMiB(cachePlan.bytes_reclaimable)} reclaimable.
                  No files removed in preview.
                </p>}
              </section>
              <section aria-label="Abandoned temporary narration cleanup" className="diagnostic-report">
                <h3>Interrupted-render temporary audio</h3>
                <p>After a crash, an unfinished WAV can remain on disk. Preview files older
                  than 24 hours, then explicitly confirm cleanup. Only KathaSvara-generated
                  partial WAV names are eligible. Completed narration, story projects,
                  reusable speech segments and render history are never selected.
                  Inspection and cleanup are blocked while a participating render is active.</p>
                <div className="preview-actions">
                  <button className="secondary-button" disabled={checkingPartials}
                    onClick={() => void inspectAbandonedAudio()}>
                    {checkingPartials ? "Inspecting temporary files…" : "Preview abandoned WAV cleanup"}
                  </button>
                  <button className="quiet-button"
                    disabled={checkingPartials || !cleanupPreview || cleanupPreview.candidates === 0}
                    onClick={() => void removeAbandonedAudio()}>Confirm temporary cleanup…</button>
                </div>
                {cleanupPreview && <p role="status">
                  Dry run: {cleanupPreview.candidates} eligible incomplete WAV files
                  ({asMiB(cleanupPreview.bytes_reclaimable)}) older than {cleanupPreview.age_hours} hours.
                  No files deleted. Up to {cleanupPreview.max_deletions} files can be removed per confirmation.
                </p>}
              </section>
              {diagnostics && (
                <section aria-label="Local speech setup diagnostic" className="diagnostic-report">
                  <h3>Speech environment — {diagnostics.platform}</h3>
                  <p>Python {diagnostics.python_version}</p>
                  <ul>
                    {Object.entries(diagnostics.dependencies).map(([name, present]) => (
                      <li key={name}><strong>{name}</strong>: {present ? "Installed" : "Missing"}</li>
                    ))}
                  </ul>
                  <p><strong>Python 3.11 runtime:</strong> {diagnostics.python_311 ? "Compatible" : "Verify Python 3.11 separately"}</p>
                   <p><strong>Portable interpreter path:</strong> {diagnostics.runtime_python_configured
                     ? (diagnostics.runtime_python_path_exists ? "Configured, file exists" : "Configured path not found") : "Not configured"}</p>
                   <p><strong>Inference source:</strong> {diagnostics.inference_dir_configured
                     ? (diagnostics.inference_dir_looks_valid ? "Configured, source found" : "Configured source not found") : "Not configured"}</p>
                   <p><strong>Temporary-file writes:</strong> {diagnostics.temporary_write_test_passed ? "Working" : "Unavailable or not checked"}</p>
                   <p><strong>Model weights tested:</strong> No</p>
                  <p><strong>Hindi speech playback tested:</strong> No</p>
                  <p>{diagnostics.help}</p>
                </section>
              )}
            </section>
          )}

          {page === "about" && (
            <section className="panel simple-page">
              <div className="section-label">कथास्वर / KATHASVARA</div><h2>Give Every Story a Voice.</h2>
              <p>Open-source Hindi storytelling and local speech production. MPL-2.0 licensed source code. The speech model and weights have their own license terms.</p>
              <h3>कहानी वाली शाम</h3><p>हर शाम, एक नई कहानी। <a href="https://www.youtube.com/@KahaniWaliShaam" target="_blank" rel="noreferrer">YouTube channel ↗</a></p>
              <h3>Project and developer</h3><p><a href="https://github.com/sanskarIN/KathaSvara" target="_blank" rel="noreferrer">GitHub repository ↗</a> · <a href="https://github.com/sanskarIN" target="_blank" rel="noreferrer">Developer profile ↗</a> · <a href="https://sanskarin.github.io/contact/#send-a-message" target="_blank" rel="noreferrer">Contact ↗</a></p>
              <h3>Voluntary support</h3><div className="support-links">{SUPPORT_LINKS.map((item) => <a key={item.href} href={item.href} target="_blank" rel="noreferrer">{item.label} ↗</a>)}</div>
            </section>
          )}
        </main>
        <footer className="statusbar"><span role="status" aria-live="polite">{message}</span><span className="footer-note">OFFLINE-FIRST · MPL-2.0</span></footer>
      </div>
    </div>
  );
}
