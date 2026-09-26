import { useMemo, useState } from "react";
import { ArrowRight, ChevronDown, FileText } from "lucide-react";

type RecordValue = Record<string, unknown>;
export type ReviewData = RecordValue;
export type ReviewView = "overview" | "findings" | "gaps" | "evidence" | "methodology" | "diagnostics" | "report" | "export";
export type Statement = {
  type: "finding" | "gap" | "hypothesis" | "recommendation";
  text: string; evidence_count: number; study_ids: string[];
  confidence: string; source: string; category?: string;
  known?: string; missing?: string; dataset?: string; model?: string;
};
const object = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown): string => typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const first = (...values: unknown[]): string => values.map(string).find(Boolean) ?? "";
const countLabel = (value: number | null) => value === null ? "—" : value.toLocaleString();
const categories = ["Architecture", "Generalization", "Temporal Modeling", "Scalability", "Evaluation", "Benchmarking", "Continual Learning"];
const statusNames = ["Discovered", "Screened", "Eligible", "Full text", "Evidence extracted", "Synthesized"];
function studyId(study: RecordValue): string { return first(study.pmid, study.doi, study.source_id, study.id); }
function confidence(value: unknown): string {
  const label = string(value).toLowerCase();
  if (["high", "strong"].includes(label)) return "High";
  if (["moderate", "medium"].includes(label)) return "Moderate";
  if (["low", "weak", "very low", "very_low"].includes(label)) return "Low";
  return "Not assessed";
}
function ids(value: unknown): string[] { return array(value).map(string).filter(Boolean); }
function statement(raw: RecordValue, type: Statement["type"], source: string): Statement | null {
  const text = first(raw.text, raw.claim, raw.finding, raw.gap, raw.description);
  if (!text) return null;
  const study_ids = ids(raw.study_ids ?? raw.supporting_studies ?? raw.pmids);
  const evidence_count = study_ids.length;
  return { type, text, study_ids, evidence_count, confidence: confidence(raw.confidence ?? raw.strength), source: first(raw.source, source), category: categories.includes(string(raw.category)) ? string(raw.category) : "Unclassified", known: string(raw.what_is_known ?? raw.known), missing: string(raw.what_is_missing ?? raw.missing), dataset: string(raw.dataset), model: string(raw.model) };
}
function statements(data: ReviewData, type: Statement["type"]): Statement[] {
  const explicit = array(object(data.statements)[type === "finding" ? "findings" : type === "gap" ? "gaps" : `${type}s`]);
  const direct = array(data[type === "finding" ? "findings" : type === "gap" ? "research_gaps" : `${type}s`]);
  const source = explicit.length ? explicit : direct;
  if (source.length) return source.map((item) => statement(object(item), type, explicit.length ? "review.json / statements" : "review.json")).filter((item): item is Statement => !!item);
  if (type !== "finding") return [];
  const articles = array(data.included_articles).map(object);
  const resolve = (reference: string) => { const article = articles.find((row) => [row.pmid, row.doi, row.title].some((value) => string(value).toLowerCase() === reference.toLowerCase())); return article ? studyId(article) : ""; };
  const themes = array(object(object(data.prisma_review).results).themes);
  return themes.flatMap((theme, themeIndex) => {
    const row = object(theme);
    const related = [...new Set(ids(row.supporting_studies).map(resolve).filter(Boolean))];
    return array(row.key_findings).map((finding) => statement({ text: finding, study_ids: related, confidence: "not assessed", dataset: "", model: "" }, "finding", `prisma_review.results.themes[${themeIndex}]`)).filter((item): item is Statement => !!item);
  });
}
function studyStatus(article: RecordValue, spanIds: Set<string>, synthesisIds: Set<string>): number {
  const id = studyId(article);
  if (id && synthesisIds.has(id)) return 5;
  if ((id && spanIds.has(id)) || array(object(article.extracted_data).key_findings).length > 0) return 4;
  if (string(article.full_text)) return 3;
  if (string(article.inclusion_status) === "included") return 2;
  return 0;
}
function Notice({ children }: { children: React.ReactNode }) { return <div className="rv-empty">{children}</div>; }
function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) { return <span className={`rv-badge rv-${tone}`}>{children}</span>; }
function StatementCard({ item, onEvidence, gap = false }: { item: Statement; onEvidence: () => void; gap?: boolean }) {
  const weak = item.confidence === "Low" || item.confidence === "Not assessed" || item.evidence_count === 0;
  return <article className="rv-card">
    <div className="rv-card-top"><Badge tone={gap ? "violet" : "blue"}>{gap ? "AI-inferred research gap" : item.evidence_count ? "Study-linked finding" : "Unlinked finding"}</Badge>{gap && <Badge>{item.category}</Badge>}<Badge tone={weak ? "amber" : "green"}>{item.confidence} confidence</Badge></div>
    <h3>{gap ? "" : item.evidence_count === 0 ? "Unverified statement: " : weak ? "Evidence suggests: " : ""}{item.text}</h3>
    {gap && <div className="rv-gap-grid"><div><small>WHAT IS KNOWN</small><p>{item.known || "Not specified in structured output."}</p></div><div><small>WHAT IS MISSING</small><p>{item.missing || "Not specified in structured output."}</p></div></div>}
    {!gap && <p className="rv-context">Dataset: {item.dataset || "Not reported"} <span>·</span> Model: {item.model || "Not reported"}</p>}
    <div className="rv-card-foot"><button type="button" onClick={onEvidence}>{item.evidence_count} supporting {item.evidence_count === 1 ? "study" : "studies"} <ArrowRight size={13} /></button><span>Source: {item.source}</span></div>
    <details><summary>Statement metadata <ChevronDown size={13} /></summary><dl><dt>Type</dt><dd>{item.type}</dd><dt>Evidence count</dt><dd>{item.evidence_count}</dd><dt>Study IDs</dt><dd>{item.study_ids.join(", ") || "None linked"}</dd><dt>Confidence</dt><dd>{item.confidence}</dd><dt>Source</dt><dd>{item.source}</dd></dl></details>
  </article>;
}
export function ReviewOutput({ view, data, status, protocol, onView, onOpenFolder }: { view: ReviewView; data: ReviewData | null; status: RecordValue; protocol: RecordValue | null; onView: (view: ReviewView) => void; onOpenFolder: () => void }) {
  const [filters, setFilters] = useState({ relevance: "", year: "", task: "", model: "", dataset: "", status: "" });
  const [selectedStudy, setSelectedStudy] = useState<string | null>(null);
  const [gapCategory, setGapCategory] = useState("All");
  const [evidenceFocus, setEvidenceFocus] = useState<string[] | null>(null);
  const drillToEvidence = (item: Statement) => { setEvidenceFocus(item.study_ids); onView("evidence"); };
  const findings = useMemo(() => data ? statements(data, "finding") : [], [data]);
  const gaps = useMemo(() => data ? statements(data, "gap") : [], [data]);
  const flow = object(data?.flow ?? status.counts);
  const included = array(data?.included_articles).map(object);
  const spans = array(data?.evidence_spans).map(object);
  const spanIds = new Set(spans.map((span) => string(span.paper_pmid)).filter(Boolean));
  const extractedIds = new Set([...spanIds, ...included.filter((article) => array(object(article.extracted_data).key_findings).length > 0).map(studyId).filter(Boolean)]);
  const synthesisIds = new Set(findings.flatMap((item) => item.study_ids));
  const screening = array(data?.screening_log).map(object);
  const studies = new Map<string, RecordValue>();
  screening.forEach((entry, index) => { const id = first(entry.pmid, `screening-${index}`); studies.set(id, { ...entry, id, evidence_status: string(entry.stage) === "full_text" ? 3 : 1 }); });
  included.forEach((article, index) => { const id = first(studyId(article), `included-${index}`); const relevance = spans.filter((span) => string(span.paper_pmid) === id).map((span) => number(span.relevance_score)).filter((value): value is number => value !== null); studies.set(id, { ...studies.get(id), ...article, id, relevance: relevance.length ? Math.max(...relevance) : null, evidence_status: studyStatus(article, spanIds, synthesisIds) }); });
  const studyRows = [...studies.values()];
  const eligible = number(flow.assessed_eligibility) !== null && number(flow.excluded_eligibility) !== null ? Math.max(0, number(flow.assessed_eligibility)! - number(flow.excluded_eligibility)!) : null;
  const synthesized = synthesisIds.size ? synthesisIds.size : null;
  const counts: [string, number | null][] = [
    ["Discovered", number(flow.total_identified)], ["Screened", number(flow.screened_title_abstract)],
    ["Eligible", eligible], ["Full text retrieved", number(flow.assessed_eligibility) ?? (number(flow.sought_fulltext) !== null && number(flow.not_retrieved) !== null ? Math.max(0, number(flow.sought_fulltext)! - number(flow.not_retrieved)!) : null)],
    ["Evidence extracted", extractedIds.size ? extractedIds.size : null], ["Synthesized", synthesized],
  ];
  const grade = Object.values(object(data?.grade_assessments)).map((value) => confidence(object(value).overall_certainty));
  const quality = grade.length ? [...new Set(grade)].join(" / ") : "Not assessed";
  const gapWarning = eligible !== null && eligible > 0 && synthesized !== null && synthesized < eligible / 2;
  const unverifiedCoverage = eligible !== null && eligible > 0 && synthesized === null;
  const matching = studyRows.filter((study) => {
    const rubric = array(data?.data_charting_rubrics).map(object).find((row) => (string(row.doi) && string(row.doi) === string(study.doi)) || (string(row.title) && string(row.title).toLowerCase() === string(study.title).toLowerCase())) ?? {};
    const text = (key: string) => first(study[key], rubric[key]).toLowerCase();
    return (!evidenceFocus || evidenceFocus.includes(string(study.id))) && (!filters.year || text("year").includes(filters.year.toLowerCase())) && (!filters.task || text("task_type").includes(filters.task.toLowerCase())) && (!filters.model || first(study.model, rubric.specific_algorithms, rubric.model_category).toLowerCase().includes(filters.model.toLowerCase())) && (!filters.dataset || first(study.dataset, rubric.new_dataset_contributed, rubric.data_types).toLowerCase().includes(filters.dataset.toLowerCase())) && (!filters.relevance || string(study.relevance).includes(filters.relevance)) && (!filters.status || statusNames[Number(study.evidence_status)] === filters.status);
  });
  if (view === "overview") return <div className="rv-stack rv-overview"><section className="rv-hero"><span className="rv-eyebrow">REVIEW AT A GLANCE</span><h2>{first(data?.research_question, object(data?.protocol).objective, protocol?.objective, status.title) || "Research question not recorded"}</h2><p>{data ? "Evidence summary from structured review data" : first(status.state) === "running" ? `Review running · ${string(array(status.progress).at(-1)) || "Preparing search"}` : "The structured review will appear when the run completes."}</p></section>
    <section className="rv-panel"><div className="rv-section-head"><div><span className="rv-eyebrow">SELECTION & SYNTHESIS</span><h2>Search funnel</h2></div><span className="rv-subtle">Each step is counted separately</span></div><div className="rv-funnel">{counts.map(([label, value], index) => <div className="rv-funnel-step" key={label}><small>{String(index + 1).padStart(2, "0")}</small><strong>{countLabel(value)}</strong><span>{label}</span></div>)}</div><p className="rv-note">“Eligible” is calculated after full-text eligibility exclusions. “Synthesized” counts distinct study IDs linked to structured findings; neither is inferred from the upstream “included_synthesis” label.</p>{unverifiedCoverage && <div className="rv-warning"><strong>Synthesis coverage cannot be verified.</strong> {eligible} eligible studies are recorded, but no study IDs are linked to structured findings.</div>}{gapWarning && <div className="rv-warning"><strong>Evidence coverage is limited.</strong> {eligible} eligible studies, but only {synthesized} {synthesized === 1 ? "study is" : "studies are"} linked to structured synthesis statements.</div>}</section>
    <section className="rv-overview-grid"><div className="rv-panel"><span className="rv-eyebrow">EVIDENCE QUALITY</span><h2>{quality}</h2><p>{grade.length ? `${grade.length} GRADE assessment${grade.length === 1 ? "" : "s"} recorded` : "No GRADE certainty assessment is recorded."}</p></div><div className="rv-panel"><span className="rv-eyebrow">QUICK READ</span><div className="rv-big-stats"><button type="button" onClick={() => onView("findings")}><strong>{findings.length}</strong><span>Key findings <ArrowRight size={13} /></span></button><button type="button" onClick={() => onView("gaps")}><strong>{gaps.length}</strong><span>Research gaps <ArrowRight size={13} /></span></button><button type="button" onClick={() => onView("evidence")}><strong>{studyRows.length}</strong><span>Study records <ArrowRight size={13} /></span></button></div></div></section>
    <section className="rv-panel"><div className="rv-section-head"><div><span className="rv-eyebrow">SUMMARY</span><h2>Key findings</h2></div><button className="rv-link" type="button" onClick={() => onView("findings")}>View all <ArrowRight size={14} /></button></div>{findings.length ? <div className="rv-card-grid">{findings.slice(0, 1).map((item, index) => <StatementCard key={index} item={item} onEvidence={() => drillToEvidence(item)} />)}</div> : <Notice>No study-linked findings are available in structured output.</Notice>}</section>
    <section className="rv-panel"><div className="rv-section-head"><div><span className="rv-eyebrow">OPEN QUESTIONS</span><h2>Research gaps</h2></div><button className="rv-link" type="button" onClick={() => onView("gaps")}>View all <ArrowRight size={14} /></button></div>{gaps.length ? <div className="rv-card-grid">{gaps.slice(0, 1).map((item, index) => <StatementCard key={index} item={item} gap onEvidence={() => drillToEvidence(item)} />)}</div> : <Notice>No structured, study-linked research gaps were provided. The full report may contain narrative discussion.</Notice>}</section></div>;
  if (view === "findings" || view === "gaps") { const items = view === "findings" ? findings : gaps.filter((item) => gapCategory === "All" || item.category === gapCategory); return <div className="rv-stack"><div className="rv-view-intro"><span className="rv-eyebrow">{view === "findings" ? "OBSERVED EVIDENCE" : "AI-INFERRED"}</span><h2>{view === "findings" ? "Key Findings" : "Research Gaps"}</h2><p>{view === "findings" ? "Claims stay linked to supporting studies and evidence quality." : "These are proposed gaps, not observed study results. Check the source studies before treating them as established."}</p></div>{view === "gaps" && <div className="rv-category-filters" aria-label="Research gap categories">{["All", ...categories, "Unclassified"].map((category) => <button key={category} type="button" className={gapCategory === category ? "active" : ""} onClick={() => setGapCategory(category)}>{category}</button>)}</div>}{items.length ? <div className="rv-card-grid">{items.map((item, index) => <StatementCard key={index} item={item} gap={view === "gaps"} onEvidence={() => drillToEvidence(item)} />)}</div> : <Notice>{view === "findings" ? "No structured findings are available." : "No structured research gaps are available."}</Notice>}</div>; }
  if (view === "evidence") return <div className="rv-stack"><div className="rv-view-intro"><span className="rv-eyebrow">SOURCE RECORDS</span><h2>Evidence / Studies</h2><p>{studyRows.length} study records in structured output. Discovery totals may exceed this list because SynthScholar does not export every discovered paper.</p></div>{evidenceFocus && <div className="rv-focus">Showing studies linked to the selected statement ({evidenceFocus.length}). <button type="button" onClick={() => setEvidenceFocus(null)}>Show all studies</button></div>}<div className="rv-filters"><label>Relevance<input value={filters.relevance} onChange={(event) => setFilters({ ...filters, relevance: event.target.value })} placeholder="Score" /></label><label>Year<input value={filters.year} onChange={(event) => setFilters({ ...filters, year: event.target.value })} placeholder="Year" /></label><label>Task<input value={filters.task} onChange={(event) => setFilters({ ...filters, task: event.target.value })} placeholder="Task" /></label><label>Model<input value={filters.model} onChange={(event) => setFilters({ ...filters, model: event.target.value })} placeholder="Model" /></label><label>Dataset<input value={filters.dataset} onChange={(event) => setFilters({ ...filters, dataset: event.target.value })} placeholder="Dataset" /></label><label>Status<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">All statuses</option>{statusNames.map((name) => <option key={name}>{name}</option>)}</select></label></div>{matching.length ? <div className="rv-table-wrap"><table className="rv-table"><thead><tr><th>Study</th><th>Year</th><th>Relevance</th><th>Evidence status</th><th></th></tr></thead><tbody>{matching.map((study) => <tr key={string(study.id)}><td><strong>{first(study.title, study.pmid, study.id)}</strong><small>{first(study.authors, study.source)}</small></td><td>{first(study.year) || "—"}</td><td>{string(study.relevance) || "—"}</td><td><Badge tone={Number(study.evidence_status) >= 4 ? "green" : "neutral"}>{statusNames[Number(study.evidence_status)]}</Badge></td><td><button type="button" className="rv-link" onClick={() => setSelectedStudy(selectedStudy === string(study.id) ? null : string(study.id))}>{selectedStudy === string(study.id) ? "Close" : "Details"}</button></td></tr>)}</tbody></table></div> : <Notice>No study records match these filters.</Notice>}{selectedStudy && (() => { const study = studyRows.find((row) => string(row.id) === selectedStudy); if (!study) return null; return <article className="rv-study-detail"><div className="rv-section-head"><h3>{first(study.title, study.id)}</h3><button type="button" className="rv-link" onClick={() => setSelectedStudy(null)}>Close</button></div><p>{first(study.authors)} · {first(study.journal)} · {first(study.year)}</p><dl><dt>Study ID</dt><dd>{selectedStudy}</dd><dt>DOI</dt><dd>{first(study.doi) || "Not recorded"}</dd><dt>Screening decision</dt><dd>{first(study.decision, study.inclusion_status) || "Not recorded"}</dd><dt>Evidence status</dt><dd>{statusNames[Number(study.evidence_status)]}</dd><dt>Abstract</dt><dd>{first(study.abstract) || "Not available"}</dd><dt>Extracted findings</dt><dd>{array(object(study.extracted_data).key_findings).map(string).join("; ") || "Not available"}</dd></dl></article>; })()}</div>;
  if (view === "methodology") return <div className="rv-stack"><div className="rv-view-intro"><span className="rv-eyebrow">REPRODUCIBILITY</span><h2>Methodology</h2><p>Search strategy, selection criteria and PRISMA counts.</p></div><section className="rv-panel"><h3>Search queries</h3>{array(data?.search_queries).length ? <ol className="rv-list">{array(data?.search_queries).map((query, index) => <li key={index}>{string(query)}</li>)}</ol> : <Notice>No search queries recorded.</Notice>}</section><section className="rv-panel"><h3>Protocol</h3><dl className="rv-facts"><dt>Databases</dt><dd>{array(object(data?.protocol).databases ?? protocol?.databases).map(string).join(", ") || "Not recorded"}</dd><dt>Inclusion criteria</dt><dd>{first(object(data?.protocol).inclusion_criteria, protocol?.inclusion_criteria) || "Not recorded"}</dd><dt>Exclusion criteria</dt><dd>{first(object(data?.protocol).exclusion_criteria, protocol?.exclusion_criteria) || "Not recorded"}</dd></dl></section><section className="rv-panel"><h3>PRISMA flow</h3><dl className="rv-facts">{Object.entries(flow).filter(([, value]) => typeof value === "number").map(([key, value]) => <><dt key={`${key}-label`}>{key.replaceAll("_", " ")}</dt><dd key={key}>{string(value)}</dd></>)}</dl></section></div>;
  if (view === "diagnostics") { const missing = included.filter((article) => !string(article.full_text)).length; const activity = array(status.progress).map(string); const extractionFailures = activity.filter((message) => /extract(?:ion|ing)?.*(?:fail|error)|(?:fail|error).*extract/i.test(message)).length; const apiFailures = activity.filter((message) => /rate.limit|\b429\b|api.*(?:fail|error)|(?:fail|error).*api/i.test(message)).length; const extracted = included.filter((article) => spanIds.has(studyId(article)) || array(object(article.extracted_data).key_findings).length > 0).length; return <div className="rv-stack"><div className="rv-view-intro"><span className="rv-eyebrow">ADVANCED</span><h2>Diagnostics</h2><p>Pipeline health and data availability. Raw runtime details remain in runner.log.</p></div><div className="rv-diagnostic-grid"><div className="rv-panel"><small>PIPELINE HEALTH</small><strong>{first(status.state) || "Unknown"}</strong></div><div className="rv-panel"><small>MISSING FULL TEXT</small><strong>{missing}</strong><span>among exported included studies</span></div><div className="rv-panel"><small>WITHOUT EXTRACTED EVIDENCE</small><strong>{Math.max(0, included.length - extracted)}</strong><span>among exported included studies</span></div><div className="rv-panel"><small>EXTRACTION FAILURES</small><strong>{extractionFailures || "Not reported"}</strong></div><div className="rv-panel"><small>API / RATE LIMIT FAILURES</small><strong>{apiFailures || "Not reported"}</strong><span>detected in progress messages</span></div></div><section className="rv-panel"><h3>Recent pipeline activity</h3><ol className="rv-list">{array(status.progress).slice(-20).map((item, index) => <li key={index}>{string(item)}</li>)}</ol>{!array(status.progress).length && <Notice>No activity recorded.</Notice>}</section>{Boolean(status.error) && <section className="rv-panel"><h3>Run error</h3><p>{string(status.error)}</p></section>}<button type="button" className="rv-link" onClick={onOpenFolder}>Open output folder for runner.log <ArrowRight size={13} /></button></div>; }
  return null;
}
export function ExportFiles({ files, onSelect }: { files: string[]; onSelect: (file: string) => void }) { return <div className="rv-stack"><div className="rv-view-intro"><span className="rv-eyebrow">FILES</span><h2>Export</h2><p>Open the complete report and machine-readable outputs.</p></div><div className="rv-export-list">{files.map((file) => <button key={file} type="button" onClick={() => onSelect(file)}><FileText size={17} /><span>{file}</span><ArrowRight size={14} /></button>)}</div></div>; }
