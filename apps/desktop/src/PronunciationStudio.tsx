// SPDX-License-Identifier: MPL-2.0
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { setGlossary, type PronunciationRuleV2, type StoryV2 } from "./lib/story_v2";

type Preview = {
  original: string;
  reviewed: string;
  effective: string;
  changes: { rule_id: string; original: string; spoken: string }[];
};
interface Props {
  document: StoryV2;
  edit: (update: (previous: StoryV2) => StoryV2) => void;
  onMessage: (text: string) => void;
}

export default function PronunciationStudio({ document, edit, onMessage }: Props) {
  const [original, setOriginal] = useState("");
  const [spoken, setSpoken] = useState("");
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const rules = document.pronunciation_glossary ?? [];
  const speech = document.scenes.flatMap(scene => scene.segments.filter(seg => seg.kind === "speech"));

  useEffect(() => {
    let cancelled = false;
    if (!selected || !speech.some(segment => segment.id === selected)) {
      setPreview(null);
      setPreviewError("");
      return;
    }
    setPreview(null);
    setPreviewError("");
    const timeout = window.setTimeout(() => {
      void invoke<Preview>("preview_pronunciation", { project: document, segmentId: selected })
        .then(result => { if (!cancelled) setPreview(result); })
        .catch(reason => {
          if (!cancelled) setPreviewError("Preview unavailable: " + String(reason));
        });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  // Preview is derived from the complete saved/editable document, not guessed in JS.
  }, [document, selected]);

  function commitRules(next: PronunciationRuleV2[]) {
    try {
      setGlossary(document, next);
      edit(project => setGlossary(project, next));
      setEditing(null);
      setOriginal("");
      setSpoken("");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    }
  }
  function addOrSave() {
    if (editing) {
      commitRules(rules.map(rule => rule.id === editing
        ? { ...rule, original: original.trim(), spoken: spoken.trim() } : rule));
    } else {
      commitRules([...rules, { id: crypto.randomUUID(), original: original.trim(),
        spoken: spoken.trim(), enabled: true }]);
    }
  }
  return (
    <section className="pronunciation-studio" aria-label="Hindi pronunciation review">
      <h3>Pronunciation glossary / उच्चारण</h3>
      <p className="helper">
        Reviewed text substitutions are applied locally once, before synthesis.
        They are not model phonemes or guaranteed pronunciations. Original story text is preserved.
      </p>
      <div className="glossary-fields">
        <label>Written form
          <input aria-label="Glossary written form" maxLength={80} value={original}
            onChange={event => setOriginal(event.target.value)} placeholder="राजा भोज" />
        </label>
        <label>Spoken form
          <input aria-label="Glossary spoken form" maxLength={160} value={spoken}
            onChange={event => setSpoken(event.target.value)} placeholder="Reviewed pronunciation" />
        </label>
        <button className="secondary-button" disabled={!original.trim() || !spoken.trim()}
          onClick={addOrSave}>{editing ? "Save correction" : "Add pronunciation"}</button>
        {editing && <button className="quiet-button" onClick={() => {
          setEditing(null); setOriginal(""); setSpoken("");
        }}>Cancel edit</button>}
      </div>
      <label className="glossary-search">Search corrections
        <input aria-label="Search pronunciation glossary" value={filter}
          onChange={event => setFilter(event.target.value)} placeholder="Filter words" />
      </label>
      <ul className="glossary-list">
        {rules.filter(rule => (rule.original + rule.spoken).toLocaleLowerCase()
          .includes(filter.toLocaleLowerCase())).map(rule => (
            <li key={rule.id}>
              <label><input type="checkbox" checked={rule.enabled}
                aria-label={"Enable " + rule.original}
                onChange={event => commitRules(rules.map(entry => entry.id === rule.id
                  ? { ...entry, enabled: event.target.checked } : entry))} />
                <span lang="hi">{rule.original} → {rule.spoken}</span>
              </label>
              <button className="quiet-button" onClick={() => {
                setEditing(rule.id); setOriginal(rule.original); setSpoken(rule.spoken);
              }}>Edit</button>
              <button className="quiet-button" onClick={() => commitRules(
                rules.filter(entry => entry.id !== rule.id))}>Delete</button>
            </li>
          ))}
      </ul>
      <label>Review segment sent to TTS
        <select aria-label="Choose segment for pronunciation review" value={selected}
          onChange={event => setSelected(event.target.value)}>
          <option value="">Select a spoken segment</option>
          {speech.map(seg => <option key={seg.id} value={seg.id}>
            {seg.spoken_text.slice(0, 72)}
          </option>)}
        </select>
      </label>
      {previewError && <p role="alert">{previewError}</p>}
      {selected && !preview && !previewError && <p role="status">Preparing model-free text preview…</p>}
      {preview && <div className="pronunciation-preview" aria-live="polite">
        <div><strong>Original script</strong><pre lang="hi">{preview.original}</pre></div>
        <div><strong>Reviewed dialogue</strong><pre lang="hi">{preview.reviewed}</pre></div>
        <div><strong>Exact preprocessed TTS text</strong><pre lang="hi">{preview.effective}</pre></div>
        <p>{preview.changes.length} glossary replacement(s) applied. Disable or edit a
          rule to revert its effect; listen and revise after generating real speech.</p>
        {preview.changes.length > 0 && <ul>{preview.changes.map((change, i) =>
          <li key={change.rule_id + i}>{change.original} → {change.spoken}</li>)}</ul>}
      </div>}
    </section>
  );
}
