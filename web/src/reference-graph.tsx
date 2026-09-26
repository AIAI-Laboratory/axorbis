import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { Crosshair, ExternalLink, Minus, PanelLeftClose, PanelLeftOpen, Plus, Search, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

type RecordValue = Record<string, unknown>;
type GraphNode = { id: string; label: string; kind: "paper" | "reference"; state?: string; x: number; y: number; degree: number; year?: string; authors?: string; journal?: string; abstract?: string; doi?: string; source?: string };
type GraphEdge = { id: string; source: string; target: string; kind: "citation" | "shared" };
type CitationMetadata = { source: string; queried: number; failed: number; papers: Array<{ doi: string; references: Array<{ doi: string; title?: string }> }> };
type ReferenceGraphProps = { data: Record<string, unknown> | null; articles?: unknown; reviewId: string; workspace: string };

class ReferenceGraphBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Reference graph failed", error, info);
  }

  componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (this.state.failed) return <section className="rw-reference-graph rw-graph-recovery" role="alert"><div><strong>Không thể hiển thị bản đồ tài liệu.</strong><span>Dữ liệu review vẫn an toàn. Tải lại bản đồ để tiếp tục.</span><button type="button" onClick={() => this.setState({ failed: false })}>Tải lại bản đồ</button></div></section>;
    return this.props.children;
  }
}

function object(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/^pmid:\s*/, "");
}

function doiUrl(value: string): string {
  return `https://doi.org/${normalize(value)}`;
}

function articleIdentity(article: RecordValue, index: number): { id: string; keys: string[]; label: string } {
  const pmid = text(article.pmid ?? article.PMID);
  const doi = text(article.doi ?? article.DOI);
  const title = text(article.title ?? article.name);
  const id = pmid ? `pmid:${normalize(pmid)}` : doi ? `doi:${normalize(doi)}` : `paper:${index}`;
  return { id, keys: [pmid && `pmid:${normalize(pmid)}`, doi && `doi:${normalize(doi)}`, title && `title:${normalize(title)}`].filter(Boolean), label: title || pmid || doi || `Study ${index + 1}` };
}

function referenceRecords(article: RecordValue): Array<{ keys: string[]; label: string }> {
  const records: Array<{ keys: string[]; label: string }> = [];
  const referenceKeys = new Set(["references", "reference_list", "cited_references", "citations", "cited_papers", "cited_by", "citedby"]);
  const visited = new Set<object>();
  const toReference = (value: unknown) => {
    const raw = typeof value === "string" || typeof value === "number" ? text(value) : "";
    const item = object(value);
    const pmid = text(item.pmid ?? item.PMID);
    const doi = text(item.doi ?? item.DOI);
    const title = text(item.title ?? item.name ?? item.label);
    const id = text(item.id ?? item.reference_id ?? item.paper_id ?? item.paperId);
    const keys = [
      pmid && `pmid:${normalize(pmid)}`,
      doi && `doi:${normalize(doi)}`,
      title && `title:${normalize(title)}`,
      id && `id:${normalize(id)}`,
      raw && (/^10\./i.test(raw) || /doi\.org\//i.test(raw) ? `doi:${normalize(raw)}` : /^\d{5,12}$/.test(raw) ? `pmid:${normalize(raw)}` : `title:${normalize(raw)}`),
    ].filter(Boolean) as string[];
    if (keys.length) records.push({ keys: [...new Set(keys)], label: title || pmid || doi || id || raw });
  };
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) { value.forEach(visit); return; }
    for (const [key, child] of Object.entries(value as RecordValue)) {
      if (referenceKeys.has(key.toLowerCase().replace(/[- ]/g, "_")) && Array.isArray(child)) child.forEach(toReference);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(article);
  return records;
}

function graphData(raw: unknown, statusArticles: unknown, metadata: CitationMetadata | null): { nodes: GraphNode[]; edges: GraphEdge[]; paperCount: number; linkedPapers: number; sharedCount: number; hasReferenceData: boolean } {
  const statusRecords = Array.isArray(statusArticles) ? statusArticles.map(object).filter((article) => article.state === "include") : [];
  const structuredRecords = Array.isArray(raw) ? raw.map(object) : [];
  const articles = [...statusRecords];
  const known = new Map<string, number>();
  articles.forEach((article, index) => articleIdentity(article, index).keys.forEach((key) => known.set(key, index)));
  structuredRecords.forEach((article, index) => {
    const identity = articleIdentity(article, index);
    const existing = identity.keys.map((key) => known.get(key)).find((match) => match !== undefined);
    if (existing === undefined) {
      const next = articles.length;
      articles.push(article);
      identity.keys.forEach((key) => known.set(key, next));
    } else {
      articles[existing] = { ...articles[existing], ...article };
      identity.keys.forEach((key) => known.set(key, existing));
    }
  });
  const externalByDoi = new Map((metadata?.papers ?? []).map((paper) => [normalize(paper.doi), paper.references]));
  articles.forEach((article, index) => {
    const references = externalByDoi.get(normalize(text(article.doi ?? article.DOI)));
    if (references?.length) articles[index] = { ...article, references: [...(Array.isArray(article.references) ? article.references : []), ...references] };
  });
  const papers = articles.map(articleIdentity);
  const articleByKey = new Map<string, string>();
  papers.forEach((paper) => paper.keys.forEach((key) => articleByKey.set(key, paper.id)));
  const nodes = new Map<string, Omit<GraphNode, "x" | "y">>();
  const edges = new Map<string, GraphEdge>();
  papers.forEach((paper, index) => nodes.set(paper.id, { ...paper, kind: "paper", state: text(articles[index].state), degree: 0,
    year: text(articles[index].year), authors: text(articles[index].authors), journal: text(articles[index].journal),
    abstract: text(articles[index].abstract), doi: text(articles[index].doi), source: text(articles[index].source) }));
  const sharedByReference = new Map<string, Set<string>>();
  let hasReferenceData = false;

  papers.forEach((paper, index) => {
    const references = referenceRecords(articles[index]);
    if (references.length) hasReferenceData = true;
    references.forEach((reference, referenceIndex) => {
      const target = reference.keys.map((key) => articleByKey.get(key)).find(Boolean);
      if (target && target !== paper.id) {
        const id = `${paper.id}->${target}`;
        edges.set(id, { id, source: paper.id, target, kind: "citation" });
      } else if (!target) {
        const key = reference.keys[0] || `reference:${index}:${referenceIndex}`;
        const id = `reference:${key}`;
        sharedByReference.set(id, new Set([...(sharedByReference.get(id) ?? []), paper.id]));
        if (!nodes.has(id)) nodes.set(id, { id, label: reference.label || "Unlabeled reference", kind: "reference", degree: 0 });
      }
    });
  });
  const topShared = new Set([...sharedByReference.entries()].filter(([, citing]) => citing.size >= 2)
    .sort((a, b) => b[1].size - a[1].size).slice(0, 30).map(([id]) => id));
  for (const [referenceId, citingPapers] of sharedByReference) {
    if (!topShared.has(referenceId)) { nodes.delete(referenceId); continue; }
    for (const paperId of citingPapers) {
      const id = `${paperId}--${referenceId}`;
      edges.set(id, { id, source: paperId, target: referenceId, kind: "shared" });
    }
  }

  const rawNodes = [...nodes.values()];
  const degree = new Map<string, number>();
  edges.forEach((edge) => { degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1); degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1); });
  const paperNodes = rawNodes.filter((node) => node.kind === "paper");
  const referenceNodes = rawNodes.filter((node) => node.kind === "reference");
  const positions = new Map<string, { x: number; y: number }>();
  const width = 1000, height = 620;
  const center = { x: width / 2, y: height / 2 };
  const connectedPapers = paperNodes.filter((node) => (degree.get(node.id) ?? 0) > 0);
  const isolatedPapers = paperNodes.filter((node) => (degree.get(node.id) ?? 0) === 0);
  connectedPapers.forEach((node, index) => {
    const angle = index / Math.max(1, connectedPapers.length) * Math.PI * 2 - Math.PI / 2;
    const radius = Math.min(180, 65 + connectedPapers.length * 3);
    positions.set(node.id, { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius * .78 });
  });
  isolatedPapers.forEach((node, index) => {
    const angle = index / Math.max(1, isolatedPapers.length) * Math.PI * 2 - Math.PI / 2;
    positions.set(node.id, { x: center.x + Math.cos(angle) * 355, y: center.y + Math.sin(angle) * 250 });
  });
  referenceNodes.forEach((node, index) => {
    const connected = [...edges.values()].filter((edge) => edge.target === node.id).map((edge) => positions.get(edge.source)).filter((point): point is { x: number; y: number } => Boolean(point));
    const x = connected.reduce((sum, point) => sum + point.x, 0) / Math.max(1, connected.length);
    const y = connected.reduce((sum, point) => sum + point.y, 0) / Math.max(1, connected.length);
    const angle = index * 2.399;
    const spread = 25 + (index % 5) * 5;
    positions.set(node.id, { x: x + Math.cos(angle) * spread, y: y + Math.sin(angle) * spread });
  });
  const activeNodes = rawNodes.filter((node) => (degree.get(node.id) ?? 0) > 0);
  const activeEdges = [...edges.values()].filter((edge) => positions.has(edge.source) && positions.has(edge.target));
  for (let iteration = 0; iteration < 90; iteration++) {
    const forces = new Map(activeNodes.map((node) => [node.id, { x: 0, y: 0 }]));
    for (let i = 0; i < activeNodes.length; i++) for (let j = i + 1; j < activeNodes.length; j++) {
      const a = positions.get(activeNodes[i].id)!, b = positions.get(activeNodes[j].id)!;
      const dx = a.x - b.x || .01, dy = a.y - b.y || .01;
      const distance = Math.max(12, Math.hypot(dx, dy));
      const power = Math.min(3, 1400 / (distance * distance));
      forces.get(activeNodes[i].id)!.x += dx / distance * power;
      forces.get(activeNodes[i].id)!.y += dy / distance * power;
      forces.get(activeNodes[j].id)!.x -= dx / distance * power;
      forces.get(activeNodes[j].id)!.y -= dy / distance * power;
    }
    for (const edge of activeEdges) {
      const a = positions.get(edge.source)!, b = positions.get(edge.target)!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const power = (distance - (edge.kind === "citation" ? 105 : 80)) * .014;
      forces.get(edge.source)!.x += dx / distance * power;
      forces.get(edge.source)!.y += dy / distance * power;
      forces.get(edge.target)!.x -= dx / distance * power;
      forces.get(edge.target)!.y -= dy / distance * power;
    }
    for (const node of activeNodes) {
      const point = positions.get(node.id)!, force = forces.get(node.id)!;
      point.x = Math.max(65, Math.min(935, point.x + Math.max(-5, Math.min(5, force.x + (center.x - point.x) * .002))));
      point.y = Math.max(55, Math.min(565, point.y + Math.max(-5, Math.min(5, force.y + (center.y - point.y) * .002))));
    }
  }
  const resultNodes = rawNodes.map((node) => ({ ...node, ...(positions.get(node.id) ?? center), degree: degree.get(node.id) ?? 0 }));
  const resultEdges = [...edges.values()];
  const linkedPapers = new Set(resultEdges.flatMap((edge) => [edge.source, edge.target]).filter((id) => nodes.get(id)?.kind === "paper")).size;
  return { nodes: resultNodes, edges: resultEdges, paperCount: paperNodes.length, linkedPapers, sharedCount: referenceNodes.length, hasReferenceData };
}

function ReferenceGraphView({ data, articles, reviewId, workspace }: ReferenceGraphProps) {
  const [metadata, setMetadata] = useState<CitationMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number; paperId: string | null; moved: boolean } | null>(null);
  const dragFrame = useRef<number | null>(null);
  const pendingViewport = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => { setSelectedId(null); setHoveredId(null); }, [reviewId]);
  useEffect(() => () => {
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
  }, []);
  useEffect(() => {
    let active = true;
    setMetadata(null);
    setLoading(true);
    setLookupError("");
    const bridge = (window as Window & { __TAURI__?: { core: { invoke: <T>(name: string, args: Record<string, unknown>) => Promise<T> } } }).__TAURI__?.core;
    if (!bridge) { setLoading(false); setLookupError("Chỉ có thể tra Crossref trong ứng dụng desktop."); return; }
    void bridge.invoke<CitationMetadata>("reference_graph", { workspace, id: reviewId, refresh: retry > 0 })
      .then((value) => { if (active) setMetadata(value); })
      .catch((error) => { if (active) setLookupError(String(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reviewId, workspace, retry]);
  const graph = useMemo(() => {
    const csSchema = typeof data?.schema === "string" && data.schema.startsWith("cs_literature_intelligence_v");
    const structuredArticles = csSchema && Array.isArray(data?.articles)
      ? data.articles.filter((article) => object(article).scope === "core" || (!object(article).scope && object(article).screening_decision === "include"))
      : data?.included_articles;
    return graphData(structuredArticles, articles, metadata);
  }, [articles, data, metadata]);
  const papers = useMemo(() => graph.nodes.filter((node) => node.kind === "paper"), [graph.nodes]);
  const byId = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const activeId = hoveredId;
  const relatedEdges = activeId ? graph.edges.filter((edge) => edge.source === activeId || edge.target === activeId) : [];
  const highlightedEdges = new Set(relatedEdges.map((edge) => edge.id));
  const highlightedNodes = new Set([activeId, ...relatedEdges.flatMap((edge) => [edge.source, edge.target])]);
  const visiblePapers = papers.filter((node) => `${node.label} ${node.authors ?? ""} ${node.doi ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const years = papers.map((paper) => Number(paper.year)).filter((year) => Number.isFinite(year) && year > 1800);
  const firstYear = years.length ? Math.min(...years) : 0;
  const lastYear = years.length ? Math.max(...years) : 0;
  const yearColor = (year: string | undefined) => {
    if (!year || !Number.isFinite(Number(year))) return "#5e918e";
    const ratio = firstYear === lastYear ? .5 : Math.max(0, Math.min(1, (Number(year) - firstYear) / (lastYear - firstYear)));
    return `hsl(178 25% ${68 - ratio * 35}%)`;
  };
  const selectedEdges = selected ? graph.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id) : [];
  const neighbors = selectedEdges.map((edge) => byId.get(edge.source === selected?.id ? edge.target : edge.source)).filter((node): node is GraphNode => node?.kind === "paper").slice(0, 8);
  const nodeCaption = (node: GraphNode) => node.kind === "reference" ? (node.label.length > 23 ? `${node.label.slice(0, 20)}…` : node.label) : `${(node.authors || node.label).split(/[ ,]+/)[0]}, ${node.year || "—"}`;
  const zoom = (factor: number) => setViewport((value) => ({ ...value, scale: Math.max(.65, Math.min(2.8, value.scale * factor)) }));
  const onWheel = (event: WheelEvent<SVGSVGElement>) => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12); };
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    suppressClick.current = false;
    const paperId = event.target instanceof Element ? event.target.closest<SVGGElement>("g[data-paper-id]")?.dataset.paperId ?? null : null;
    drag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: viewport.x, y: viewport.y, paperId, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const currentDrag = drag.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - currentDrag.clientX, event.clientY - currentDrag.clientY) > 4) currentDrag.moved = true;
    if (!currentDrag.moved) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(.1, Math.min(bounds.width / 1000, bounds.height / 620) || 1);
    const nextX = currentDrag.x + (event.clientX - currentDrag.clientX) / ratio;
    const nextY = currentDrag.y + (event.clientY - currentDrag.clientY) / ratio;
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return;
    pendingViewport.current = { x: Math.max(-2000, Math.min(2000, nextX)), y: Math.max(-1400, Math.min(1400, nextY)) };
    if (dragFrame.current !== null) return;
    dragFrame.current = requestAnimationFrame(() => {
      dragFrame.current = null;
      const next = pendingViewport.current;
      pendingViewport.current = null;
      if (next) setViewport((value) => ({ ...value, ...next }));
    });
  };
  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const { moved, paperId } = drag.current;
    suppressClick.current = moved;
    drag.current = null;
    if (!moved && paperId) setSelectedId(paperId);
  };
  return <section className="rw-reference-graph" aria-label="Bản đồ liên kết tài liệu">
    <header className="rw-reference-graph-head"><div><span className="rw-kicker">BẢN ĐỒ TÀI LIỆU</span><h2>Liên kết tham chiếu</h2></div><div className="rw-reference-graph-stats"><span><b>{graph.paperCount}</b> bài báo</span><span><b>{graph.linkedPapers}</b> có liên kết</span><span><b>{graph.edges.length}</b> cạnh</span></div></header>
    <div className={`rw-reference-graph-layout${listOpen ? "" : " list-hidden"}${selected ? " detail-open" : ""}`}>
      {listOpen && <aside className="rw-graph-list" aria-label="Danh sách bài báo"><div className="rw-graph-pane-head"><strong>Bài trong review <span>{papers.length}</span></strong><button type="button" onClick={() => setListOpen(false)} aria-label="Ẩn danh sách bài báo" title="Ẩn danh sách"><PanelLeftClose size={16} /></button></div><label className="rw-graph-search"><Search size={14} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm bài báo…" aria-label="Tìm bài báo trong graph" /></label><div className="rw-graph-paper-list">{visiblePapers.map((paper) => <button type="button" key={paper.id} className={`rw-graph-paper-row${selected?.id === paper.id ? " selected" : ""}`} onClick={() => setSelectedId(paper.id)} onMouseEnter={() => setHoveredId(paper.id)} onMouseLeave={() => setHoveredId(null)}><strong>{paper.label}</strong><small>{paper.authors || paper.source || "Tác giả chưa có"}<span>{paper.year || "—"}</span></small></button>)}{!visiblePapers.length && <p className="rw-graph-empty-list">Không tìm thấy bài phù hợp.</p>}</div></aside>}
      <div className="rw-graph-stage"><div className="rw-graph-stage-top"><div className="rw-graph-stage-status">{!listOpen && <button type="button" className="rw-graph-show-list" onClick={() => setListOpen(true)} aria-label="Hiện danh sách bài báo" title="Hiện danh sách"><PanelLeftOpen size={16} /><span>Danh sách</span></button>}<span>{loading ? "Đang tra Crossref…" : metadata ? `Crossref · ${metadata.queried - metadata.failed}/${metadata.queried} DOI đã tra` : lookupError || "Dữ liệu từ review"}</span></div><button type="button" onClick={() => setRetry((value) => value + 1)} disabled={loading}>Tra lại</button></div>
        <div className="rw-graph-canvas">{loading ? <div className="rw-graph-loading" role="status">Đang dựng mạng trích dẫn…</div> : graph.paperCount ? <svg viewBox="0 0 1000 620" role="img" aria-label={`Mạng gồm ${graph.paperCount} bài báo và ${graph.edges.length} cạnh`} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; }} onClickCapture={(event) => { if (suppressClick.current) { event.stopPropagation(); suppressClick.current = false; } }}>
          <g transform={`translate(${viewport.x} ${viewport.y}) translate(500 310) scale(${viewport.scale}) translate(-500 -310)`}><g className="rw-graph-edges">{graph.edges.map((edge) => { const source = byId.get(edge.source), target = byId.get(edge.target); if (!source || !target) return null; return <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} className={`${edge.kind}${activeId && !highlightedEdges.has(edge.id) ? " faded" : ""}`} />; })}</g>
          <g className="rw-graph-nodes">{graph.nodes.map((node) => <g key={node.id} data-paper-id={node.kind === "paper" ? node.id : undefined} className={`node ${node.kind}${activeId && !highlightedNodes.has(node.id) ? " faded" : ""}${selected?.id === node.id ? " selected" : ""}`} transform={`translate(${node.x} ${node.y})`} tabIndex={node.kind === "paper" ? 0 : -1} role={node.kind === "paper" ? "button" : undefined} aria-label={node.label} onClick={() => { if (node.kind === "paper") setSelectedId(node.id); }} onKeyDown={(event) => { if (node.kind === "paper" && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setSelectedId(node.id); } }} onMouseEnter={() => setHoveredId(node.id)} onMouseLeave={() => setHoveredId(null)} onFocus={() => setHoveredId(node.id)} onBlur={() => setHoveredId(null)}><circle r={node.kind === "reference" ? Math.min(11, 4 + node.degree * .7) : Math.min(17, 6 + node.degree * .9)} style={node.kind === "paper" ? { fill: yearColor(node.year) } : undefined} />{node.kind === "paper" || activeId === node.id || selected?.id === node.id ? <text y={-Math.min(17, 6 + node.degree * .9) - 7} textAnchor="middle">{nodeCaption(node)}</text> : null}<title>{node.label}</title></g>)}</g></g>
        </svg> : <div className="rw-graph-loading">Chưa có bài báo để vẽ graph.</div>}{!loading && !graph.edges.length && graph.paperCount > 0 && <p className="rw-graph-no-links">Chưa tìm thấy liên kết DOI trong tập bài này.</p>}</div>
        <div className="rw-graph-stage-bottom"><span>● Bài báo&nbsp;&nbsp; ◌ Reference chung</span>{firstYear > 0 && <div className="rw-graph-year-scale"><i /><span>{firstYear}</span><span>{lastYear}</span></div>}<div className="rw-graph-zoom"><button type="button" aria-label="Thu nhỏ graph" onClick={() => zoom(1 / 1.2)}><Minus size={15} /></button><button type="button" aria-label="Đặt lại khung nhìn" onClick={() => setViewport({ scale: 1, x: 0, y: 0 })}><Crosshair size={15} /></button><button type="button" aria-label="Phóng to graph" onClick={() => zoom(1.2)}><Plus size={15} /></button></div></div>
      </div>
      {selected && <aside className="rw-graph-detail" aria-label="Chi tiết bài báo"><div className="rw-graph-detail-scroll"><div className="rw-graph-detail-head"><span className="rw-graph-detail-kicker">BÀI BÁO ĐƯỢC CHỌN</span><button type="button" onClick={() => setSelectedId(null)} aria-label="Ẩn chi tiết bài báo" title="Ẩn chi tiết"><X size={16} /></button></div><h3>{selected.label}</h3>{selected.authors && <p className="rw-graph-authors">{selected.authors}</p>}<p className="rw-graph-publication">{[selected.year, selected.journal || selected.source].filter(Boolean).join(" · ")}</p><div className="rw-graph-detail-metrics"><span>{selectedEdges.length} liên kết trong graph</span>{selected.doi && <button type="button" className="rw-graph-doi-link" onClick={() => void openUrl(doiUrl(selected.doi!))}>Mở DOI <ExternalLink size={13} /></button>}</div>{selected.abstract && <section className="rw-graph-abstract"><h4>Tóm tắt</h4><p>{selected.abstract}</p></section>}{!selected.abstract && <p className="rw-graph-missing-abstract">Chưa có tóm tắt cho tài liệu này.</p>}{neighbors.length > 0 && <section className="rw-graph-neighbors"><h4>Bài liên quan trong bản đồ</h4>{neighbors.map((node) => <button type="button" key={node.id} onClick={() => setSelectedId(node.id)}>{node.label}</button>)}</section>}</div></aside>}
    </div>
  </section>;
}

export function ReferenceGraph(props: ReferenceGraphProps) {
  return <ReferenceGraphBoundary resetKey={props.reviewId}><ReferenceGraphView {...props} /></ReferenceGraphBoundary>;
}
