import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, BookOpen, ChevronDown, ChevronRight, FolderOpen, Home, Menu, Moon, PanelLeftClose, PanelLeftOpen, Plus, Pencil, RotateCcw, Search, Settings, Square, Sun, Trash2, X } from "lucide-react";
import { MarkdownContent } from "./features/research/markdown-content";
import { ModalEscape } from "./modal-escape";
import feynmanQuotes from "./data/feynman-quotes.json";
import { ExportFiles, ReviewOutput, type ReviewData, type ReviewView } from "./review-output";
import { ReviewRun } from "./review-run";
import { CSReviewOutput } from "./cs-review-output";
import { ReferenceGraph } from "./reference-graph";
import { UsageSection } from "./usage-section";

type Review = {
  id: string;
  title: string;
  state: "running" | "completed" | "search_complete" | "screening_complete" | "evidence_mapping_complete" | "study_profiling_complete" | "mapping_complete" | "candidate_gaps_found" | "gap_verification_complete" | "synthesis_complete" | "insufficient_evidence" | "failed" | "cancelled" | "interrupted";
  directory: string;
  updatedAt: number | string;
  startedAt?: number | string;
  completedAt?: number | string;
  progress: string[];
  error: string | null;
  includedArticles?: number;
  counts?: Record<string, unknown>;
  parallelLimit?: number;
  keyCount?: number;
  classificationMode?: "gemini" | "jev";
  keyUsage?: Array<{ id: string; state: string; active: boolean; requests: number; tokens: number }>;
  articles?: Array<{ pmid: string; title: string; abstract: string; year: string; source: string; doi: string; state: string; scope?: string; text_status?: string; reason: string }>;
  tokenUsage?: { input: number; output: number; total: number; requests: number };
  gapVerification?: { status?: string; reason?: string; searched_sources?: string[] };
  project?: string;
};
type Environment = { python: string; installed: boolean; version: string | null; defaultWorkspace: string; keyCount: number; jevKeyAvailable: boolean };
type GoogleKeyInfo = { id: string; source: string; variable: string | null; manageable: boolean };
type Input = {
  title: string; objective: string; coreConcepts: string; relatedConcepts: string; inclusion: string; exclusion: string;
  dateStart: string; dateEnd: string; language: string; publicationType: string; sources: string[]; screeningTemplate: string; auditLogging: string; citationSnowballing: boolean; extractionDimensions: string; synthesisObjective: string; sourceTextRetention: string; maxResults: number;
};
type TauriWindow = Window & { __TAURI__?: { core: { invoke: <T>(name: string, args?: Record<string, unknown>) => Promise<T> } } };
type ReviewTab = ReviewView | "sources" | "progress" | "visualize";
type SourceFile = "review.json" | "references.bib" | "protocol.json";
type PreviewFile = SourceFile | "review.md" | "status.json" | "runner.log" | "gemini-calls.jsonl" | "run-manifest.json" | "runtime-manifest.json" | "search-checkpoint.json" | "execution-state.json";
const resultReady = (state?: string) => ["completed", "mapping_complete", "candidate_gaps_found", "gap_verification_complete", "synthesis_complete", "insufficient_evidence"].includes(state || "");
const isCsIntelligence = (data: ReviewData | null | undefined) => typeof data?.schema === "string" && data.schema.startsWith("cs_literature_intelligence_v");
const csTabs: Array<{ view: ReviewTab; label: string }> = [
  { view: "progress", label: "Tiến trình" }, { view: "overview", label: "Tổng quan" },
  { view: "findings", label: "Khẳng định" }, { view: "gaps", label: "Khoảng trống nghiên cứu" },
  { view: "evidence", label: "Ma trận bằng chứng" }, { view: "visualize", label: "Bản đồ trích dẫn" },
  { view: "methodology", label: "Truy vấn & sàng lọc" }, { view: "diagnostics", label: "Chất lượng" },
  { view: "report", label: "Báo cáo" }, { view: "export", label: "Tệp kết quả" },
];
const sourceFiles: SourceFile[] = ["review.json", "references.bib", "protocol.json"];
const sourceLabels: Record<SourceFile, string> = {
  "review.json": "Evidence",
  "references.bib": "References",
  "protocol.json": "Protocol",
};
function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value);
}
function timestamp(value: number | string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const numeric = Number(value);
  const parsed = Number.isFinite(numeric) ? numeric : Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}
function displayRuntime(start: number, end: number): string {
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours ? `${hours}h ${String(minutes).padStart(2, "0")}m ${String(remainder).padStart(2, "0")}s` : `${String(minutes).padStart(2, "0")}m ${String(remainder).padStart(2, "0")}s`;
}

const initialInput: Input = {
  title: "", objective: "", coreConcepts: "", relatedConcepts: "",
  inclusion: "", exclusion: "", dateStart: "", dateEnd: "", language: "", publicationType: "",
  sources: ["semantic_scholar", "openalex", "arxiv", "openreview", "crossref", "core"], screeningTemplate: "general", auditLogging: "redacted", citationSnowballing: false, extractionDimensions: "", synthesisObjective: "", sourceTextRetention: "keep",
  maxResults: 20,
};

function invoke<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const bridge = (window as TauriWindow).__TAURI__?.core;
  if (!bridge) return Promise.reject(new Error("Open this page in the Axorbis desktop app."));
  return bridge.invoke<T>(name, args);
}

function displayDate(value: number | string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function displayListDate(value: number | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleDateString("vi-VN")} · ${date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
}

function Field({ label, name, value, onChange, placeholder, required, rows, type = "text", min, max }: {
  label: string; name: keyof Input; value: string; onChange: (name: keyof Input, value: string) => void;
  placeholder?: string; required?: boolean; rows?: number; type?: "text" | "date"; min?: string; max?: string;
}) {
  return <label className="field"><span>{label}{required && <b> *</b>}</span>
    {rows ? <textarea value={value} rows={rows} placeholder={placeholder} required={required} onChange={(event) => onChange(name, event.target.value)} />
      : <input type={type} value={value} placeholder={placeholder} required={required} min={min || undefined} max={max || undefined} onChange={(event) => onChange(name, event.target.value)} />}
  </label>;
}

function SourcePreview({ file, content, data, onOpenFolder }: {
  file: SourceFile; content: string; data: ReviewData | null; onOpenFolder: () => void;
}) {
  if (file === "references.bib") return <div className="rw-content-section"><div className="rw-section-head"><h2>References</h2><button className="rw-text-action" type="button" onClick={onOpenFolder}>Show file <ArrowRight size={14} /></button></div><div className="rw-markdown rw-review-report"><pre><code>{content}</code></pre></div></div>;
  if (file === "protocol.json") {
    let protocol: Record<string, unknown> | null = null;
    try { protocol = JSON.parse(content) as Record<string, unknown>; } catch { /* Show raw text below. */ }
    return <div className="rw-content-section"><div className="rw-section-head"><h2>Review protocol</h2><button className="rw-text-action" type="button" onClick={onOpenFolder}>Show file <ArrowRight size={14} /></button></div>{protocol ? <div className="rw-review-facts">{Object.entries(protocol).filter(([, value]) => value !== null && value !== "").map(([name, value]) => <div key={name}><strong>{name.replaceAll("_", " ")}</strong><span>{displayValue(value)}</span></div>)}</div> : <div className="rw-markdown"><pre><code>{content}</code></pre></div>}</div>;
  }
  if (!data) return <div className="rw-soft-empty">Could not read the structured review. Open the file to inspect it.</div>;
  if (isCsIntelligence(data)) return <div className="rw-content-section"><div className="rw-section-head"><h2>Dữ liệu literature intelligence có cấu trúc</h2><button className="rw-text-action" type="button" onClick={onOpenFolder}>Mở review.json <ArrowRight size={14} /></button></div><div className="rw-markdown rw-review-report"><pre><code>{content}</code></pre></div></div>;
  const flow = (data.flow ?? {}) as Record<string, unknown>;
  const articles = (data.included_articles ?? []) as Array<Record<string, unknown>>;
  return <>
    <div className="rw-content-section"><div className="rw-section-head"><h2>Evidence and selection</h2><button className="rw-text-action" type="button" onClick={onOpenFolder}>Show review.json <ArrowRight size={14} /></button></div><p className="rw-review-question">{displayValue(data.research_question) === "—" ? "Research question not recorded." : displayValue(data.research_question)}</p><div className="rw-material-summary"><span><strong>{displayValue(flow.total_identified)}</strong> identified</span><span><strong>{displayValue(flow.screened_title_abstract)}</strong> screened</span><span><strong>{displayValue(flow.included_synthesis)}</strong> upstream included</span></div></div>
    {!!(data.search_queries as unknown[] | undefined)?.length && <div className="rw-content-section"><div className="rw-section-head"><h2>Search queries</h2><span>{(data.search_queries as unknown[]).length}</span></div><ol className="rw-plan-list">{(data.search_queries as unknown[]).map((query, index) => <li key={index}><span className="rw-step-icon">{String(index + 1).padStart(2, "0")}</span><span>{displayValue(query)}</span></li>)}</ol></div>}
    <div className="rw-content-section"><div className="rw-section-head"><h2>Included studies</h2><span>{articles.length}</span></div>{articles.length ? <div className="rw-review-studies">{articles.map((article, index) => <article className="rw-message" key={displayValue(article.doi ?? article.pmid ?? index)}><div><span>Study {index + 1}</span><small>{displayValue(article.year)}</small></div><h3>{displayValue(article.title)}</h3><p>{[displayValue(article.journal), displayValue(article.doi)].filter((value) => value !== "—").join(" · ")}</p>{typeof article.abstract === "string" && article.abstract && <details><summary>Abstract</summary><p>{article.abstract}</p></details>}</article>)}</div> : <div className="rw-soft-empty">No studies were included in this review.</div>}</div>
  </>;
}

function SettingsView({ environment, workspace, onChooseWorkspace, onKeyCountChange, onJevKeyChange }: {
  environment: Environment | null;
  workspace: string;
  onChooseWorkspace: () => void;
  onKeyCountChange: (count: number) => void;
  onJevKeyChange: (available: boolean) => void;
}) {
  const [keys, setKeys] = useState<GoogleKeyInfo[] | null>(null);
  const [newKey, setNewKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<GoogleKeyInfo | null>(null);
  const [jevKey, setJevKey] = useState<GoogleKeyInfo | null>(null);
  const [newJevKey, setNewJevKey] = useState("");
  const [jevError, setJevError] = useState<string | null>(null);
  const [jevBusy, setJevBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void invoke<GoogleKeyInfo[]>("list_google_keys")
      .then((result) => { if (active) setKeys(result); })
      .catch((cause) => { if (active) setKeyError(String(cause)); });
    void invoke<GoogleKeyInfo | null>("jev_key_info")
      .then((result) => { if (active) setJevKey(result); })
      .catch((cause) => { if (active) setJevError(String(cause)); });
    return () => { active = false; };
  }, []);

  async function addKey(event: FormEvent) {
    event.preventDefault();
    if (!newKey.trim() || keyBusy) return;
    setKeyBusy(true);
    setKeyError(null);
    try {
      const result = await invoke<GoogleKeyInfo[]>("add_google_key", { apiKey: newKey });
      setKeys(result);
      setNewKey("");
      onKeyCountChange(result.length);
    } catch (cause) { setKeyError(String(cause)); }
    finally { setKeyBusy(false); }
  }

  async function removeKey() {
    if (!removeTarget?.variable || keyBusy) return;
    setKeyBusy(true);
    setKeyError(null);
    try {
      const result = await invoke<GoogleKeyInfo[]>("remove_google_key", { variable: removeTarget.variable });
      setKeys(result);
      setRemoveTarget(null);
      onKeyCountChange(result.length);
    } catch (cause) { setKeyError(String(cause)); setRemoveTarget(null); }
    finally { setKeyBusy(false); }
  }

  async function saveJevKey(event: FormEvent) {
    event.preventDefault();
    if (!newJevKey.trim() || jevBusy) return;
    setJevBusy(true); setJevError(null);
    try {
      const info = await invoke<GoogleKeyInfo>("save_jev_key", { apiKey: newJevKey });
      setJevKey(info); setNewJevKey(""); onJevKeyChange(true);
    } catch (cause) { setJevError(String(cause)); }
    finally { setJevBusy(false); }
  }

  async function removeJevKey() {
    setJevBusy(true); setJevError(null);
    try {
      await invoke("remove_jev_key");
      setJevKey(null); onJevKeyChange(false);
    } catch (cause) { setJevError(String(cause)); }
    finally { setJevBusy(false); }
  }

  return <div className="rw-page rw-settings-page">
    <div className="rw-page-intro"><span className="rw-kicker">WORKSPACE / SETTINGS</span><div className="rw-page-title-row"><div><h1>Settings</h1><p>Review engine, output folder, and API keys.</p></div></div></div>
    <div className="rw-settings-grid">
      <section className="rw-settings-section"><div className="rw-section-head"><h2>SynthScholar</h2><span>{environment?.installed ? "Ready" : "Setting up"}</span></div><div className="rw-settings-card rw-settings-facts"><div><span>Python</span><strong>{environment?.python || "Checking..."}</strong></div><div><span>Version</span><strong>{environment?.version || "Preparing runtime"}</strong></div>{!environment?.installed && <p>Axorbis downloads a private Python 3.11 runtime when needed, then installs the review engine automatically. No system Python installation is required.</p>}</div></section>
      <section className="rw-settings-section"><div className="rw-section-head"><h2>Review output folder</h2></div><div className="rw-settings-card rw-settings-workspace"><p>{workspace}</p><button className="rw-button" type="button" onClick={onChooseWorkspace}><FolderOpen size={14} /> Choose folder</button></div></section>
      <section className="rw-settings-section rw-settings-keys"><div className="rw-section-head"><h2>Typesafe Jev AI</h2><span>{jevKey ? "Key configured" : "Optional"}</span></div><div className="rw-settings-card"><div className="rw-settings-model"><span>CLASSIFICATION MODE</span><strong>jev-latest</strong><small>When enabled, Jev classifies every paper for core, background, or exclusion. Gemini still plans queries and analyzes evidence.</small></div>{jevKey && <div className="rw-settings-key-row"><span className="rw-settings-key-mark">J</span><span className="rw-settings-key-copy"><strong>Jev AI key</strong><small>{jevKey.variable || jevKey.source} · {jevKey.source}</small></span>{jevKey.manageable ? <button type="button" className="rw-settings-remove-key" onClick={() => void removeJevKey()} disabled={jevBusy} aria-label="Remove Jev key"><Trash2 size={15} /></button> : <span className="rw-settings-readonly">External</span>}</div>}<form className="rw-settings-key-form" onSubmit={(event) => void saveJevKey(event)}><label htmlFor="rw-new-jev-key">{jevKey ? "Replace Jev API key" : "Jev API key"}</label><input id="rw-new-jev-key" type="password" autoComplete="off" spellCheck={false} value={newJevKey} onChange={(event) => setNewJevKey(event.target.value)} placeholder="Paste key" /><small>Stored in the local key file; never included in review outputs.</small><button type="submit" className="rw-button" disabled={jevBusy || !newJevKey.trim()}><Plus size={14} /> {jevKey ? "Replace key" : "Save key"}</button></form>{jevError && <p className="rw-settings-key-error" role="alert">{jevError}</p>}</div></section>
      <section className="rw-settings-section rw-settings-keys"><div className="rw-section-head"><h2>Google Gemini</h2><span>{keys?.length ?? environment?.keyCount ?? 0} keys available</span></div><div className="rw-settings-card"><div className="rw-settings-model"><span>MODEL</span><strong>gemini-3.5-flash-lite</strong><small>Choose one key or automatic rotation when starting a review. Usage is recorded from model responses.</small></div><div className="rw-settings-key-columns"><div className="rw-settings-key-list"><div className="rw-settings-subhead">CONFIGURED KEYS</div>{keys === null ? <p className="rw-settings-key-empty">Loading key sources...</p> : keys.length ? keys.map((key) => <div className="rw-settings-key-row" key={`${key.id}-${key.variable ?? key.source}`}><span className="rw-settings-key-mark">{key.id.replace("Key ", "")}</span><span className="rw-settings-key-copy"><strong>{key.id}</strong><small>{key.variable || key.source} · {key.source}</small></span>{key.manageable ? <button type="button" className="rw-settings-remove-key" onClick={() => setRemoveTarget(key)} aria-label={`Remove ${key.id}`} disabled={keyBusy}><Trash2 size={15} /></button> : <span className="rw-settings-readonly">External</span>}</div>) : <p className="rw-settings-key-empty">No Google keys configured yet.</p>}</div><form className="rw-settings-key-form" onSubmit={(event) => void addKey(event)}><div className="rw-settings-subhead">ADD KEY</div><label htmlFor="rw-new-google-key">Gemini API key</label><input id="rw-new-google-key" type="password" autoComplete="off" spellCheck={false} value={newKey} onChange={(event) => setNewKey(event.target.value)} placeholder="Paste key" aria-describedby="rw-key-storage-note" /><p id="rw-key-storage-note">Saved in <code>~/.axorbis/agent/.env</code>. Key contents are never shown again.</p><button type="submit" className="rw-button" disabled={keyBusy || !newKey.trim()}><Plus size={14} /> Add key</button></form></div><p className="rw-settings-key-note">Keys from the process environment or Axorbis configuration are read only here. Changes to the local key file apply to new reviews.</p></div>{keyError && <p className="rw-settings-key-error" role="alert">{keyError}</p>}</section>
    </div>
    {removeTarget && <div className="rw-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setRemoveTarget(null); }}><div className="rw-dialog rw-confirm-dialog" role="dialog" aria-modal="true" aria-label="Remove API key"><ModalEscape onClose={() => setRemoveTarget(null)} /><div className="rw-dialog-header"><div><span className="rw-kicker">GOOGLE GEMINI</span><h2>Remove {removeTarget.id}?</h2></div><button type="button" className="rw-icon-button" onClick={() => setRemoveTarget(null)} aria-label="Close"><X size={15} /></button></div><p>This removes {removeTarget.variable} from the local key file. Reviews already running continue with their loaded keys.</p><div className="rw-dialog-actions"><button type="button" onClick={() => setRemoveTarget(null)}>Cancel</button><button type="button" className="rw-button rw-danger-button" disabled={keyBusy} onClick={() => void removeKey()}><Trash2 size={14} /> Remove key</button></div></div></div>}
  </div>;
}


export function ReviewApp() {
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [booting, setBooting] = useState(true);
  const [workspace, setWorkspace] = useState(() => localStorage.getItem("axorbis.review.workspace") ?? "");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Review | null>(null);
  const [keySelection, setKeySelection] = useState("auto");
  const [jevEnabled, setJevEnabled] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [input, setInput] = useState<Input>(initialInput);
  const [project, setProject] = useState("Literature reviews");
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<"new" | "edit" | "rerun">("new");
  const [formSourceId, setFormSourceId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Review | null>(null);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [previewContent, setPreviewContent] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [quoteIndex] = useState(() => Math.floor(Math.random() * feynmanQuotes.length));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<"home" | "reviews" | "review" | "settings">("home");
  const [tab, setTab] = useState<ReviewTab>("overview");
  const [sourceFile, setSourceFile] = useState<SourceFile>("review.json");
  const [artifacts, setArtifacts] = useState<Record<string, string>>({});
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark" | "system">(() => (localStorage.getItem("axorbis.theme") as "light" | "dark" | "system") || "system");
  const [sidebar, setSidebar] = useState<"open" | "closed">("open");
  const [mobileNav, setMobileNav] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [clockNow, setClockNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    if (!environment) return;
    const list = await invoke<Review[]>("list_reviews", { workspace: workspace || undefined });
    setReviews(list);
  }, [environment, workspace]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [detected] = await Promise.all([
          invoke<Environment>("review_environment"),
          new Promise((resolve) => window.setTimeout(resolve, 2500)),
        ]);
        if (!active) return;
        let value = detected;
        if (!value.installed) {
          try {
            value = await invoke<Environment>("install_review_environment");
          } catch (cause) {
            if (active) setError(`Automatic SynthScholar setup failed: ${String(cause)}`);
          }
        }
        if (!active) return;
        setEnvironment(value);
        const folder = localStorage.getItem("axorbis.review.workspace") || value.defaultWorkspace;
        setWorkspace(folder);
        setReviews(await invoke<Review[]>("list_reviews", { workspace: folder }));
      } catch (cause) { if (active) setError(String(cause)); }
      finally { if (active) setBooting(false); }
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!environment) return;
    void refresh().catch((cause) => setError(String(cause)));
    const interval = window.setInterval(() => void refresh().catch(() => {}), 2500);
    return () => window.clearInterval(interval);
  }, [environment, refresh]);
  useEffect(() => {
    if (selected?.state !== "running") return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [selected?.id, selected?.state]);
  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    let active = true;
    const load = () => invoke<Review>("read_review", { workspace: workspace || undefined, id: selectedId })
      .then((review) => { if (active) setSelected(review); }).catch((cause) => { if (active) setError(String(cause)); });
    void load();
    const interval = window.setInterval(() => void load(), selected?.state === "running" ? 750 : 2500);
    return () => { active = false; window.clearInterval(interval); };
  }, [selected?.state, selectedId, workspace]);
  useEffect(() => {
    if (resultReady(selected?.state)) setTab("progress");
  }, [selected?.state]);
  useEffect(() => {
    if (!selectedId || resultReady(selected?.state)) return;
    const key = `${workspace}/${selectedId}/protocol.json`;
    if (artifacts[key] !== undefined) return;
    let active = true;
    void invoke<string>("read_review_artifact", { workspace: workspace || undefined, id: selectedId, filename: "protocol.json" })
      .then((content) => { if (active) setArtifacts((current) => ({ ...current, [key]: content })); })
      .catch(() => {});
    return () => { active = false; };
  }, [artifacts, selected?.state, selectedId, workspace]);
  useEffect(() => {
    if (!selectedId || !resultReady(selected?.state) || (tab !== "report" && tab !== "sources" && tab !== "export" && tab !== "overview" && tab !== "findings" && tab !== "gaps" && tab !== "evidence" && tab !== "methodology" && tab !== "diagnostics" && tab !== "visualize")) return;
    const file = tab === "report" ? "review.md" : tab === "sources" ? sourceFile : "review.json";
    const key = `${workspace}/${selectedId}/${file}`;
    if (artifacts[key] !== undefined) return;
    let active = true;
    setArtifactError(null);
    void invoke<string>("read_review_artifact", { workspace: workspace || undefined, id: selectedId, filename: file })
      .then((content) => { if (active) setArtifacts((current) => ({ ...current, [key]: content })); })
      .catch((cause) => { if (active) setArtifactError(String(cause)); });
    return () => { active = false; };
  }, [artifacts, selected?.state, selectedId, sourceFile, tab, workspace]);

  function change(name: keyof Input, value: string) { setInput((current) => ({ ...current, [name]: value })); }
  const projects = useMemo(() => [...new Set(["Literature reviews", ...reviews.map((review) => review.project || "Literature reviews")])], [reviews]);
  function newReview(projectName = "Literature reviews") {
    setInput(initialInput); setProject(projectName); setKeySelection("auto"); setJevEnabled(false); setFormMode("new"); setFormSourceId(null); setShowForm(true);
  }
  async function openReviewForm(review: Review, mode: "edit" | "rerun") {
    setBusy(true); setError(null);
    try {
      const saved = await invoke<Input>("review_input", { workspace, id: review.id });
      setInput({ ...initialInput, ...saved, sources: saved.sources?.length ? saved.sources : initialInput.sources,
        screeningTemplate: saved.screeningTemplate || "temporal_kg", auditLogging: saved.auditLogging || "redacted",
        sourceTextRetention: saved.sourceTextRetention || "keep" }); setProject(review.project || "Literature reviews"); setKeySelection("auto"); setJevEnabled(review.classificationMode === "jev");
      setFormMode(mode); setFormSourceId(review.id); setShowForm(true);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  async function chooseWorkspace() {
    try {
      const chosen = await invoke<string | null>("choose_workspace");
      if (chosen) {
        localStorage.setItem("axorbis.review.workspace", chosen);
        setWorkspace(chosen);
        setSelectedId(null);
      }
    } catch (cause) { setError(String(cause)); }
  }
  async function start(event: FormEvent) {
    event.preventDefault();
    if (formMode !== "edit" && (environment?.keyCount ?? 0) === 0) {
      setError("Cần ít nhất một Gemini API key để phân loại bài báo. Hệ thống không còn dùng regex fallback.");
      return;
    }
    if (formMode !== "edit" && jevEnabled && !environment?.jevKeyAvailable) {
      setError("Cần cấu hình Jev AI key trong Settings trước khi bật chế độ phân loại Jev.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (formMode === "edit") {
        const updated = await invoke<Review>("update_review", { workspace, id: formSourceId, input, project });
        setSelected(updated); setShowForm(false); await refresh(); return;
      }
      const source = reviews.find((review) => review.id === formSourceId);
      const review = await invoke<Review>("start_review", { workspace, input, keySelection, classificationMode: jevEnabled ? "jev" : "gemini", project, sourceReviewId: formSourceId,
        resumeCheckpoint: Boolean(source && !resultReady(source.state)) });
      setShowForm(false);
      setSelected(review);
      setSelectedId(review.id);
      setPage("review");
      setTab("overview");
      await refresh();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!selected) return;
    setBusy(true);
    try {
      await invoke<void>("cancel_review", { id: selected.id });
      await refresh();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  async function adjudicate(articleId: string, decision: "include" | "exclude") {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      const updated = await invoke<Review>("adjudicate_review", { workspace, id: selected.id, articleId, decision });
      setSelected(updated);
      const prefix = `${workspace}/${selected.id}/`;
      setArtifacts((current) => Object.fromEntries(Object.entries(current).filter(([key]) =>
        !key.startsWith(prefix) || !["review.json", "review.md", "references.bib", "status.json"].some((file) => key.endsWith(`/${file}`)))));
      await refresh();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  async function removeReview() {
    if (!deleteTarget) return;
    setBusy(true); setError(null);
    try {
      await invoke<void>("delete_review", { workspace, id: deleteTarget.id });
      if (selectedId === deleteTarget.id) { setSelected(null); setSelectedId(null); setPage("reviews"); }
      setDeleteTarget(null); await refresh();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  async function openOutput() {
    if (!selected) return;
    try { await invoke<void>("open_review_output", { workspace, id: selected.id }); }
    catch (cause) { setError(String(cause)); }
  }
  async function preview(file: PreviewFile) {
    if (!selectedId) return;
    setPreviewFile(file); setPreviewContent(""); setPreviewError(null);
    try { setPreviewContent(await invoke<string>("read_review_artifact", { workspace, id: selectedId, filename: file })); }
    catch (cause) { setPreviewError(String(cause)); }
  }
  function openReview(id: string) {
    setSelected(null);
    setSelectedId(id);
    setPage("review");
    setTab("overview");
    setSourceFile("review.json");
    setMobileNav(false);
    setPaletteOpen(false);
  }
  function changeTheme() {
    const next = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(next);
    localStorage.setItem("axorbis.theme", next);
  }
  function showHome() {
    setPage("home");
    setMobileNav(false);
  }

  const running = reviews.some((review) => review.state === "running");
  const startedAt = selected ? timestamp(selected.startedAt) ?? timestamp(/-(\d{13})$/.exec(selected.id)?.[1]) : null;
  const completedAt = timestamp(selected?.completedAt);
  const runtime = startedAt === null ? null : displayRuntime(startedAt, completedAt ?? (selected?.state === "running" ? clockNow : timestamp(selected?.updatedAt) ?? clockNow));
  const filtered = reviews.filter((review) => review.title.toLowerCase().includes(paletteQuery.toLowerCase()));
  const quote = feynmanQuotes[quoteIndex];
  const artifactKey = `${workspace}/${selectedId}/${sourceFile}`;
  const artifactContent = artifacts[artifactKey];
  const jsonContent = artifacts[`${workspace}/${selectedId}/review.json`];
  const protocolContent = artifacts[`${workspace}/${selectedId}/protocol.json`];
  const reportContent = artifacts[`${workspace}/${selectedId}/review.md`];
  const reviewData = useMemo<ReviewData | null>(() => {
    if (!jsonContent) return null;
    try { return JSON.parse(jsonContent) as ReviewData; }
    catch { return null; }
  }, [jsonContent]);
  const resultTabs: Array<{ view: ReviewTab; label: string }> = isCsIntelligence(reviewData) ? csTabs : [
    { view: "progress", label: "Tiến trình" }, { view: "overview", label: "Tổng quan" },
    { view: "findings", label: "Kết quả chính" }, { view: "gaps", label: "Khoảng trống nghiên cứu" },
    { view: "evidence", label: "Bằng chứng / Nghiên cứu" }, { view: "visualize", label: "Trực quan hóa" },
    { view: "methodology", label: "Phương pháp" }, { view: "diagnostics", label: "Chẩn đoán" },
    { view: "report", label: "Báo cáo" }, { view: "export", label: "Xuất dữ liệu" },
  ];
  const protocolData = useMemo<Record<string, unknown> | null>(() => { try { return protocolContent ? JSON.parse(protocolContent) as Record<string, unknown> : null; } catch { return null; } }, [protocolContent]);
  function showOutput(file: "review.md" | SourceFile) {
    if (file === "review.md") setTab("report");
    else { setSourceFile(file); setTab("sources"); }
  }

  if (booting) return <div className="rw-app rw-boot" data-theme={theme}><main className="rw-boot-view" aria-live="polite"><img src="/axorbis-loading.svg" alt="" className="rw-boot-mark" /><div className="rw-boot-intro"><h1>{quote.en}</h1><p>{quote.vi}</p><small>{quote.source}</small></div><div className="rw-boot-feedback"><span className="rw-boot-spinner" role="status" aria-label="Đang tải" /></div></main></div>;

  return <div className="rw-app" data-theme={theme}>
    <header className="rw-topbar">
      <div className="rw-brand">
        <button className="rw-icon-button rw-mobile-menu" type="button" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={16} /></button>
        <span className="rw-brand-icon">A</span><strong>AXORBIS</strong><span className="rw-brand-subtitle">Research workspace</span>
      </div>
      <button className="rw-search-button" type="button" onClick={() => setPaletteOpen(true)}><Search size={14} /><span>Search anything</span><kbd>⌘ K</kbd></button>
      <div className="rw-topbar-end"><span className="rw-local-indicator"><i /> Local workspace</span>
        <button className="rw-icon-button" type="button" aria-label="Change theme" onClick={changeTheme}>{theme === "dark" ? <Moon size={15} /> : <Sun size={15} />}</button>
      </div>
    </header>
    <div className={"rw-body " + (sidebar === "closed" ? "rw-sidebar-collapsed" : "")}>
      {mobileNav && <button className="rw-mobile-scrim" type="button" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <aside className={"rw-sidebar " + (mobileNav ? "rw-mobile-open" : "")} aria-label="Primary navigation">
        <div className="rw-sidebar-heading"><span>WORKSPACE</span><button className="rw-icon-button" type="button" aria-label="Toggle sidebar" onClick={() => setSidebar(sidebar === "open" ? "closed" : "open")}>{sidebar === "open" ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}</button></div>
        <nav>
          <button type="button" className={page === "home" ? "active" : ""} onClick={showHome}><Home size={15} /><span>Home</span></button>
          <button type="button" className={page === "reviews" || page === "review" ? "active" : ""} onClick={() => { setActiveProject(null); setPage("reviews"); setMobileNav(false); }}><FolderOpen size={15} /><span>Reviews</span></button>
          <button type="button" className={page === "settings" ? "active" : ""} onClick={() => { setPage("settings"); setMobileNav(false); }}><Settings size={15} /><span>Settings</span></button>
        </nav>
        {page !== "review" && <><div className="rw-sidebar-section"><span>PROJECTS</span></div><div className="rw-sidebar-projects">{projects.map((name) => <button type="button" key={name} className={page === "reviews" && activeProject === name ? "active" : ""} onClick={() => { setActiveProject(name); setPage("reviews"); setProject(name); setMobileNav(false); }} title={name}><span className="rw-project-initial"><FolderOpen size={13} /></span><span>{name}</span></button>)}</div></>}
        <div className="rw-sidebar-footer"><span className="rw-sidebar-footer-dot" /> Axorbis local</div>
      </aside>
      <main className="rw-main" id="main-content">
        {error && <div className="rw-alert" role="alert"><span>{error}</span><button className="rw-icon-button" type="button" aria-label="Dismiss error" onClick={() => setError(null)}><X size={14} /></button></div>}
        {page === "home" && <div className="rw-page rw-home">
          <div className="rw-page-intro"><span className="rw-kicker">YOUR WORKSPACE</span>
            <div className="rw-page-title-row rw-home-hero-row"><blockquote className="rw-home-hero-quote" aria-live="polite"><h1>{quote.en}</h1><p>{quote.vi}</p><footer>{quote.source}</footer></blockquote><button className="rw-button" type="button" onClick={() => newReview()}><Plus size={15} /> New review</button></div>
          </div>
          {!environment?.installed && <div className="rw-setup-note"><span className="rw-setup-symbol">!</span><span><strong>SynthScholar setup needed</strong> · Python 3.11+ and the review engine are required.</span><button className="rw-text-action" type="button" onClick={() => setPage("settings")}>Open settings <ArrowRight size={14} /></button></div>}
          <UsageSection reviews={reviews} />
          <div className="rw-home-columns"><section><div className="rw-section-head"><h2>Continue researching</h2><span>{reviews.length} reviews</span></div>
            {reviews.length ? <div className="rw-row-list">{reviews.slice(0, 7).map((review) => <button type="button" className="rw-work-row" key={review.id} onClick={() => openReview(review.id)}><span className="rw-row-mark"><BookOpen size={15} /></span><span className="rw-row-copy"><strong>{review.title}</strong><small>{review.state} · Updated {displayDate(review.updatedAt)}</small></span><ChevronRight size={15} /></button>)}</div>
              : <button type="button" className="rw-empty rw-empty-clickable" onClick={() => newReview()}><span className="rw-empty-mark"><Plus size={14} /></span><h3>Start with a review</h3><p>Create a literature review from a focused research question.</p><span className="rw-text-action">Create review <ArrowRight size={14} /></span></button>}
          </section><aside><div className="rw-section-head"><h2>Workspace</h2><button className="rw-text-action" type="button" onClick={() => setPage("settings")}>View settings <ArrowRight size={14} /></button></div>
            <div className="rw-quick-projects"><button type="button" onClick={() => void chooseWorkspace()}><span className="rw-project-initial"><FolderOpen size={14} /></span><span>{workspace || "Choose output folder"}</span><ArrowRight size={14} /></button><button type="button" onClick={() => setPage("settings")}><span className="rw-project-initial">S</span><span>SynthScholar {environment?.version || "setup needed"}</span><ArrowRight size={14} /></button></div>
          </aside></div>
        </div>}
        {page === "reviews" && <div className="rw-page rw-reviews-page"><div className="rw-page-intro"><span className="rw-kicker">WORKSPACE / REVIEWS</span><div className="rw-page-title-row"><div><h1>Reviews</h1><p>Research questions grouped by project.</p></div><button className="rw-button" type="button" onClick={() => newReview()}><Plus size={15} /> New review</button></div></div>
          {reviews.length ? projects.filter((name) => (!activeProject || activeProject === name) && reviews.some((review) => (review.project || "Literature reviews") === name)).map((name) => <section className="rw-project-group" key={name}><div className="rw-section-head"><h2><FolderOpen size={17} /> {name}</h2><button type="button" className="rw-text-action" onClick={() => newReview(name)}><Plus size={14} /> Add question</button></div><div className="rw-project-table"><div className="rw-table-labels"><span>QUESTION</span><span>STATUS</span><span>STUDIES</span><span>UPDATED</span><span aria-hidden="true" /></div>{reviews.filter((review) => (review.project || "Literature reviews") === name).map((review) => <div className="rw-project-item" key={review.id}><button type="button" className="rw-project-row" onClick={() => openReview(review.id)}><span className="rw-project-name"><span className="rw-project-initial"><BookOpen size={15} /></span><span><strong>{review.title}</strong><small title={review.directory}>{review.directory}</small></span></span><span className={`rw-project-status ${review.state}`}><i />{review.state === "running" ? "Running" : review.state === "insufficient_evidence" ? "Insufficient evidence" : resultReady(review.state) ? "Mapped" : review.state === "failed" ? "Failed" : "Stopped"}</span><span>{review.includedArticles ?? "—"}</span><span>{displayListDate(review.updatedAt)}</span></button><button type="button" className="rw-project-delete" aria-label={`Delete review: ${review.title}`} title="Delete review" disabled={busy || review.state === "running"} onClick={() => setDeleteTarget(review)}><Trash2 size={15} /></button></div>)}</div></section>)
            : <div className="rw-empty"><span className="rw-empty-mark"><Plus size={14} /></span><h3>No literature maps yet</h3><p>Start with a Computer Science topic to build a traceable literature map.</p><button className="rw-button" type="button" onClick={() => newReview()}>New review</button></div>}
        </div>}
        {page === "settings" && <SettingsView environment={environment} workspace={workspace} onChooseWorkspace={() => void chooseWorkspace()} onKeyCountChange={(count) => { setEnvironment((current) => current ? { ...current, keyCount: count } : current); setKeySelection("auto"); }} onJevKeyChange={(available) => { setEnvironment((current) => current ? { ...current, jevKeyAvailable: available } : current); if (!available) setJevEnabled(false); }} />}
        {page === "review" && <div className="rw-question-page rw-running-page"><div className="rw-question-toolbar"><div className="rw-breadcrumb"><button type="button" onClick={() => setPage("reviews")}>Reviews</button><ChevronRight size={13} /><span>{selected?.title || "Opening review"}</span></div><button className="rw-icon-button" type="button" aria-label="Open review files" onClick={() => void openOutput()}><FolderOpen size={15} /></button></div>
          <div className="rw-workspace">
            <div className="rw-workspace-center rw-run-mode">{selected ? <><div className="rw-question-heading"><div className="rw-heading-copy">{!resultReady(selected.state) && <div className="rw-heading-meta"><span className={`rw-review-status-badge ${selected.state}`}><i />{selected.state === "running" ? "Đang chạy" : selected.state === "failed" ? "Có lỗi" : "Đã dừng"}</span></div>}<div className="rw-heading-title-row"><h1>{selected.title}</h1></div>{!resultReady(selected.state) && typeof protocolData?.objective === "string" && protocolData.objective.trim() && protocolData.objective.trim().toLocaleLowerCase() !== selected.title.trim().toLocaleLowerCase() && <p className="rw-review-objective">{protocolData.objective}</p>}<div className="rw-question-details"><span className="rw-red-dot" />{selected.state === "running" ? "Đang thực hiện" : selected.state === "insufficient_evidence" ? "Thiếu bằng chứng" : resultReady(selected.state) ? "Đã lập bản đồ" : selected.state === "failed" ? "Có lỗi" : "Đã dừng"}<span className="rw-detail-separator">/</span>{selected.includedArticles ?? "—"} tài liệu được chọn{resultReady(selected.state) && selected.tokenUsage && <><span className="rw-detail-separator">/</span>{new Intl.NumberFormat("vi-VN").format(selected.tokenUsage.total)} token</>}<span className="rw-detail-separator">/</span>Cập nhật {displayDate(selected.updatedAt)}</div></div><div className="rw-question-actions"><button type="button" onClick={() => void openOutput()}><FolderOpen size={14} /> Mở thư mục</button>{selected.state === "running" ? <button type="button" className="rw-question-delete" disabled={busy} onClick={() => void cancel()}><Square size={14} /> Dừng</button> : <><button type="button" disabled={busy} onClick={() => void openReviewForm(selected, "edit")}><Pencil size={14} /> Sửa</button><button type="button" disabled={busy || running} onClick={() => void openReviewForm(selected, "rerun")}><RotateCcw size={14} /> {resultReady(selected.state) ? "Chạy lại" : "Tiếp tục"}</button><button type="button" className="rw-question-delete" disabled={busy} onClick={() => setDeleteTarget(selected)}><Trash2 size={14} /> Xóa</button></>}</div></div>
                {resultReady(selected.state) ? <><div className="rw-tabbar" role="tablist" aria-label="Các phần của kết quả review">{resultTabs.map(({ view, label }) => <button type="button" role="tab" aria-selected={tab === view} className={tab === view ? "active" : ""} key={view} onClick={() => { setTab(view); setSourceFile("review.json"); }}>{label}</button>)}</div>
                <div className={`rw-workspace-content rv-content${tab === "progress" ? " rw-progress-content" : ""}${tab === "visualize" ? " rw-visualize-content" : ""}`}>
                  {tab === "progress" && <ReviewRun review={selected} runtime={runtime} onOpenLog={() => void preview("runner.log")} onOpenGeminiLog={() => void preview("gemini-calls.jsonl")} />}
                  {tab === "visualize" && <ReferenceGraph data={reviewData} articles={selected.articles} reviewId={selected.id} workspace={workspace} />}
                  {resultReady(selected.state) && !reviewData && artifactError && tab !== "progress" && tab !== "report" && tab !== "sources" && <div className="rv-warning">Structured review data could not be loaded. Open Export to inspect the saved files.</div>}
                  {(["overview", "findings", "gaps", "evidence", "methodology", "diagnostics"] as const).includes(tab as "overview") && (isCsIntelligence(reviewData) ? <CSReviewOutput view={tab as ReviewView} data={reviewData!} onView={setTab} onOpenFolder={() => void openOutput()} onAdjudicate={(articleId, decision) => void adjudicate(articleId, decision)} adjudicationBusy={busy} /> : <ReviewOutput view={tab as ReviewView} data={reviewData} status={selected as unknown as Record<string, unknown>} protocol={protocolData} onView={setTab} onOpenFolder={() => void openOutput()} />)}
                  {tab === "report" && (reportContent ? <><div className="rw-section-head rw-review-reader-head"><h2>Báo cáo tổng hợp</h2><button className="rw-text-action" type="button" onClick={() => void openOutput()}>Mở review.md <ArrowRight size={14} /></button></div><MarkdownContent content={reportContent} className="rw-markdown rw-review-report" /></> : <div className="rw-soft-empty">{artifactError || (resultReady(selected.state) ? "Đang tải báo cáo..." : "Báo cáo sẽ xuất hiện khi review hoàn tất.")}</div>)}
                  {tab === "export" && <ExportFiles files={["review.md", ...sourceFiles, "status.json", "execution-state.json", "run-manifest.json", "runtime-manifest.json", "search-checkpoint.json", "runner.log", "gemini-calls.jsonl"]} onSelect={(file) => void preview(file as PreviewFile)} />}
                  {tab === "sources" && <><button className="rv-link" type="button" onClick={() => setTab("export")}>← Back to Export</button><div className="rw-source-switch" role="tablist" aria-label="Review source files">{sourceFiles.map((file) => <button type="button" role="tab" aria-selected={sourceFile === file} className={sourceFile === file ? "active" : ""} key={file} onClick={() => setSourceFile(file)}>{sourceLabels[file]}</button>)}</div>{artifactError ? <div className="rw-soft-empty" role="alert">{artifactError}</div> : artifactContent === undefined ? <div className="rw-soft-empty">Loading {sourceFile}...</div> : <SourcePreview file={sourceFile} content={artifactContent} data={reviewData} onOpenFolder={() => void openOutput()} />}</>}
                </div></> : <ReviewRun review={selected} runtime={runtime} onOpenLog={() => void preview("runner.log")} onOpenGeminiLog={() => void preview("gemini-calls.jsonl")} />}</> : <div className="rw-loading">Opening review...</div>}</div>
          </div>
        </div>}
      </main>
    </div>
    {paletteOpen && <div className="rw-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaletteOpen(false); }}><div className="rw-palette" role="dialog" aria-modal="true" aria-label="Search reviews"><ModalEscape onClose={() => setPaletteOpen(false)} /><div className="rw-palette-input"><Search size={16} /><input autoFocus value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && filtered[0]) openReview(filtered[0].id); }} placeholder="Search reviews..." /><kbd>ESC</kbd></div><div className="rw-palette-results">{filtered.map((review) => <button type="button" key={review.id} onClick={() => openReview(review.id)}><span>{review.title}</span><small>{review.state}</small></button>)}{!filtered.length && <p>No results</p>}</div><footer>Search to navigate · Enter opens the first result</footer></div></div>}
    {showForm && <div className="rw-overlay rw-review-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowForm(false); }}><form className="rw-dialog rw-review-dialog" role="dialog" aria-modal="true" aria-label={formMode === "edit" ? "Edit research question" : "Literature review"} onSubmit={(event) => void start(event)}><ModalEscape onClose={() => setShowForm(false)} /><div className="rw-dialog-header"><div><span className="rw-kicker">{formMode === "edit" ? "EDIT" : formMode === "rerun" ? "RESUME / RERUN" : "CREATE"}</span><h2>{formMode === "edit" ? "Edit research question" : formMode === "rerun" ? "Run saved question" : "New literature review"}</h2></div><button className="rw-icon-button" type="button" aria-label="Close" onClick={() => setShowForm(false)}><X size={15} /></button></div><div className="rw-review-scroll">
      {formMode === "rerun" && <p className="rw-form-note">{resultReady(reviews.find((review) => review.id === formSourceId)?.state) ? "This starts a fresh run from the saved protocol." : "A new run starts from the saved protocol. Completed search queries may be reused when a matching checkpoint exists."} The original run stays available.</p>}
      {formMode === "edit" && <p className="rw-form-note">Changes update the saved question for future runs. Existing reports remain snapshots of their original run.</p>}
      <div className="rw-review-fields"><Field label="Research topic" name="title" value={input.title} onChange={change} required placeholder="e.g. Inductive reasoning in temporal knowledge graphs" /><Field label="Research question / objective" name="objective" value={input.objective} onChange={change} placeholder="What should the map investigate?" /><Field label="Core concepts (comma separated)" name="coreConcepts" value={input.coreConcepts} onChange={change} placeholder="temporal knowledge graph, inductive reasoning" /><Field label="Related terms (comma separated)" name="relatedConcepts" value={input.relatedConcepts} onChange={change} placeholder="unseen entities, zero-shot" />
        <Field label="Inclusion criteria" name="inclusion" value={input.inclusion} onChange={change} placeholder="Studies that directly address the research question" />
        <Field label="Exclusion criteria" name="exclusion" value={input.exclusion} onChange={change} placeholder="Surveys, duplicate versions, or out-of-scope settings" />
        <Field label="Start date" name="dateStart" type="date" value={input.dateStart} onChange={change} max={input.dateEnd} />
        <Field label="End date" name="dateEnd" type="date" value={input.dateEnd} onChange={change} min={input.dateStart} />
        <small className="rw-date-note">You can type a date or choose one from the calendar. Search metadata currently provides publication years, so screening compares years when applying this range.</small>
        <Field label="Language" name="language" value={input.language} onChange={change} placeholder="Optional, e.g. English" />
        <Field label="Publication type" name="publicationType" value={input.publicationType} onChange={change} placeholder="Optional, e.g. conference paper" />
        <Field label="Extraction dimensions (comma separated)" name="extractionDimensions" value={input.extractionDimensions} onChange={change} placeholder="e.g. model robustness, deployment cost" />
        <Field label="Synthesis objective" name="synthesisObjective" value={input.synthesisObjective} onChange={change} placeholder="Which comparisons should the review emphasize?" />
        <label className="field"><span>Screening template</span><select value={input.screeningTemplate} onChange={(event) => setInput((current) => ({ ...current, screeningTemplate: event.target.value }))}><option value="general">General protocol</option><option value="temporal_kg">Temporal KG / inductive</option></select><small>Choose the specialized template only for temporal knowledge graph reviews.</small></label>
        <label className="field"><span>Gemini audit log</span><select value={input.auditLogging} onChange={(event) => setInput((current) => ({ ...current, auditLogging: event.target.value }))}><option value="redacted">Metadata + hashes</option><option value="full">Full request + response</option><option value="off">Off</option></select><small>Full audit includes paper text. Choose source-text retention separately below.</small></label>
        <label className="field"><span>Source text retention</span><select value={input.sourceTextRetention} onChange={(event) => setInput((current) => ({ ...current, sourceTextRetention: event.target.value }))}><option value="keep">Keep source text for traceability</option><option value="delete_after_review">Delete after final report</option></select><small>Deleting source text keeps selected spans in JSON, but their offsets cannot be checked against the original local text later.</small></label>
        <fieldset className="field rw-source-field"><legend>Search sources</legend><div className="rw-source-options">{([['semantic_scholar', 'Semantic Scholar'], ['openalex', 'OpenAlex'], ['arxiv', 'arXiv'], ['openreview', 'OpenReview'], ['crossref', 'Crossref'], ['core', 'CORE']] as const).map(([source, name]) => <label key={source}><input type="checkbox" checked={input.sources.includes(source)} onChange={(event) => setInput((current) => ({ ...current, sources: event.target.checked ? [...current.sources, source] : current.sources.filter((value) => value !== source) }))} /><span>{name}</span></label>)}</div></fieldset>
        <label className="field rw-citation-field"><span className="rw-checkbox-line"><input type="checkbox" checked={input.citationSnowballing} onChange={(event) => setInput((current) => ({ ...current, citationSnowballing: event.target.checked }))} /> Expand backward and forward citations</span><small>One bounded hop from up to five seed papers. New records enter screening and evidence analysis.</small></label>
        <label className="field rw-project-field"><span>Project</span><input required maxLength={100} list="rw-project-names" value={project} onChange={(event) => setProject(event.target.value)} placeholder="Choose or enter a project" /><datalist id="rw-project-names">{projects.map((name) => <option value={name} key={name} />)}</datalist><small>Use an existing project name or type a new one.</small></label>
        <label className="field"><span>Maximum results per query</span><input type="number" min="1" max="100" value={input.maxResults} onChange={(event) => setInput((current) => ({ ...current, maxResults: Number(event.target.value) }))} /></label>
        {formMode !== "edit" && <label className="field"><span>Chế độ phân loại bài báo</span><select value={jevEnabled ? "jev" : "gemini"} onChange={(event) => setJevEnabled(event.target.value === "jev")}><option value="gemini">Gemini (mặc định)</option><option value="jev" disabled={!environment?.jevKeyAvailable}>Jev AI — toàn bộ bài báo</option></select><small>{environment?.jevKeyAvailable ? "Jev phân loại core/background/exclude; Gemini vẫn phân tích bằng chứng." : "Cấu hình Jev AI key trong Settings để bật chế độ này."}</small></label>}
        {formMode !== "edit" && <label className="field rw-key-select"><span>Gemini API key <b>*</b></span><div className="rw-key-control"><select value={keySelection} onChange={(event) => setKeySelection(event.target.value)}><option value="auto">Rotate automatically ({environment?.keyCount ?? 0} keys)</option>{Array.from({ length: environment?.keyCount ?? 0 }, (_, index) => <option value={`key-${index + 1}`} key={index}>Key {index + 1}</option>)}</select><ChevronDown size={15} aria-hidden="true" /></div><small>Gemini lập kế hoạch và chọn bằng chứng{jevEnabled ? "; Jev phân loại toàn bộ bài báo." : ", đồng thời phân loại bài báo."} Review cần Gemini key ở cả hai chế độ.</small></label>}
      </div></div><div className="rw-dialog-actions"><button type="button" onClick={() => setShowForm(false)}>Cancel</button><button className="rw-button" type="submit" disabled={busy || (formMode !== "edit" && (running || !environment?.installed || (environment?.keyCount ?? 0) === 0))}>{busy ? "Saving..." : formMode === "edit" ? "Save question" : formMode === "rerun" ? "Start new run" : "Start review"}<ArrowRight size={14} /></button></div></form></div>}
    {deleteTarget && <div className="rw-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteTarget(null); }}><div className="rw-dialog rw-confirm-dialog" role="dialog" aria-modal="true" aria-label="Delete review"><ModalEscape onClose={() => setDeleteTarget(null)} /><div className="rw-dialog-header"><div><span className="rw-kicker">DELETE</span><h2>Delete this question?</h2></div><button type="button" className="rw-icon-button" onClick={() => setDeleteTarget(null)} aria-label="Close"><X size={15} /></button></div><p>“{deleteTarget.title}” and all files in its review folder will be permanently deleted.</p><div className="rw-dialog-actions"><button type="button" onClick={() => setDeleteTarget(null)}>Cancel</button><button type="button" className="rw-button rw-danger-button" disabled={busy} onClick={() => void removeReview()}><Trash2 size={14} /> Delete</button></div></div></div>}
    {previewFile && <div className="run-log-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewFile(null); }}><section className="run-log-detail rw-file-preview" role="dialog" aria-modal="true" aria-label={`Preview ${previewFile}`}><ModalEscape onClose={() => setPreviewFile(null)} /><header><div><span className="run-eyebrow">GENERATED FILE</span><h2>{previewFile}</h2></div><button type="button" onClick={() => setPreviewFile(null)} aria-label="Close file"><X size={17} /></button></header><div className="run-log-detail-body">{previewError ? <p role="alert">{previewError}</p> : previewContent ? previewFile === "review.md" ? <MarkdownContent content={previewContent} className="rw-markdown rw-review-report" /> : <pre><code>{previewContent}</code></pre> : <p>Loading file...</p>}</div></section></div>}
  </div>;
}
