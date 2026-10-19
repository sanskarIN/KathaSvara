// SPDX-License-Identifier: MPL-2.0
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import {
  AudioResult,
  countText,
  GenerationStatus,
  STARTER_STORY,
  StoryProject,
  SUPPORT_LINKS,
  TextInspection,
  readSavedNumber,
  validateText,
} from "./lib/story";

type Page = "studio" | "projects" | "settings" | "about";
type Theme = "dark" | "light";

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
  const [exaggeration, setExaggeration] = useState(() =>
    readSavedNumber(localStorage.getItem("kathasvara-exaggeration"), 0.25, 2, 0.5),
  );
  const [cfgWeight, setCfgWeight] = useState(() =>
    readSavedNumber(localStorage.getItem("kathasvara-guidance"), 0, 1, 0.5),
  );
  const [inspection, setInspection] = useState<TextInspection | null>(null);
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
    setAudio(null);
    setInspection(null);
    setStatus("waiting");
  }

  function changeScript(text: string) {
    invalidateGeneration();
    setProject((previous) => ({ ...previous, text }));
  }

  function changeExaggeration(value: number) {
    invalidateGeneration();
    setExaggeration(value);
  }

  function changeGuidance(value: number) {
    invalidateGeneration();
    setCfgWeight(value);
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
      setPage("studio");
      setMessage("Project loaded. Generate a new preview when ready.");
    } catch (error) {
      setMessage("Load failed: " + errorMessage(error));
    }
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
      });
      if (revision !== generationRevision.current) {
        setMessage("Script or voice settings changed during synthesis. Generate again to hear the new version.");
        return;
      }
      setAudio(result);
      setStatus("completed");
      setMessage("Hindi WAV ready. Listen before exporting to check pronunciation and quality.");
    } catch (error) {
      if (revision === generationRevision.current) {
        setStatus("failed");
        setMessage(errorMessage(error));
      }
    } finally {
      setWorking(false);
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
          <small>v0.1.0 · Development preview</small>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div><span className="eyebrow">CREATIVE AUDIO STUDIO</span><h1>{page === "studio" ? "Give Every Story a Voice." : page === "projects" ? "Your story library" : page === "settings" ? "Preferences" : "About KathaSvara"}</h1></div>
          <div className="header-actions"><span className="chip">हिन्दी · Hindi</span><button className="quiet-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "☀ Light" : "☾ Dark"}</button></div>
        </header>

        <main>
          {page === "studio" && (
            <div className="studio-grid">
              <section className="panel editor-panel">
                <div className="panel-heading"><div><div className="section-label">01 / SCRIPT</div><h2>Story editor</h2><p>Write in Hindi, naturally.</p></div><button className="quiet-button" onClick={() => void saveProject()}>Save project</button></div>
                <label htmlFor="story-title" className="field-label">PROJECT TITLE</label>
                <input id="story-title" className="title-input" value={project.title} maxLength={120} onChange={(e) => setProject({ ...project, title: e.target.value })} />
                <label htmlFor="story-text" className="field-label">NARRATION TEXT</label>
                <textarea id="story-text" className="story-text" lang="hi" spellCheck value={project.text} onChange={(e) => changeScript(e.target.value)} aria-describedby="script-stats" placeholder="अपनी कहानी यहाँ लिखें..." />
                <div id="script-stats" className="editor-footer"><span>{counts.characters.toLocaleString("en-IN")} / 3,000 characters</span><span>{counts.words} words</span></div>
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
                  <p className="helper">Only controls supported by the selected model are shown. Generating does not upload your script.</p>
                  <button className="primary-button" disabled={working} onClick={() => void generate()}>{working ? "Generating speech…" : "✦ Generate Hindi Voice"}</button>
                </section>
                <section className="panel preview-panel">
                  <div className="section-label">03 / LISTEN</div><h2>Audio preview</h2>
                  <div className={"status status-" + status} role="status" aria-live="polite"><span aria-hidden="true">●</span>{status === "waiting" ? "Waiting" : status === "loading" ? "Model loading / synthesizing" : status === "completed" ? "Completed" : "Failed"}</div>
                  {audio ? (
                    <>
                      <audio ref={audioRef} controls src={audio.data_url} aria-label="Generated Hindi WAV preview" />
                      <div className="audio-meta">{audio.duration_seconds.toFixed(1)} sec · {audio.sample_rate} Hz · {audio.chunks} chunk(s)</div>
                      <div className="preview-actions"><button className="quiet-button" onClick={() => { if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; } }}>■ Stop</button><button className="secondary-button" onClick={() => void exportWav()}>Export WAV ↓</button></div>
                    </>
                  ) : <div className="empty-preview"><div className="waveform" aria-hidden="true">▂ ▆ ▃ █ ▅ ▇ ▃ ▅ ▂ ▆ ▃</div><span>Your audio preview appears here.</span></div>}
                </section>
              </div>
            </div>
          )}

          {page === "projects" && (
            <section className="panel"><div className="panel-heading"><div className="section-label">YOUR WORK</div><button className="secondary-button" onClick={() => { invalidateGeneration(); setProject({ id:"", title:"नई कहानी", text:"" }); setPage("studio"); }}>+ New story</button></div>
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
              <button className="secondary-button" onClick={() => void checkRuntime()}>Check Python bridge</button>
              <p className="helper">A successful bridge check does not confirm the model is installed or able to synthesize.</p>
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
