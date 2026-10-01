import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { ArrowRight, Crosshair, ExternalLink, Minus, PanelLeftClose, PanelLeftOpen, Plus, Search, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ModalEscape } from "./modal-escape";

type RecordValue = Record<string, unknown>;
type GraphNode = { id: string; label: string; kind: "paper" | "reference"; state?: string; x: number; y: number; degree: number; year?: string; authors?: string; journal?: string; abstract?: string; doi?: string; source?: string; openreviewUrl?: string; pdfUrl?: string; lookupStatus?: string; referenceSource?: string };
type GraphEdge = { id: string; source: string; target: string; kind: "citation" | "shared" };
export type CitationMetadata = { version: number; source: string; queried: number; failed: number; papers: Array<{ doi: string; title?: string; arxiv_id?: string; lookup_status?: string; reference_source?: string; references: Array<{ doi: string; title?: string; authors?: string; year?: string; journal?: string }>; openreview?: { title?: string; authors?: string; year?: string; abstract?: string; journal?: string; url?: string; pdf_url?: string } }> };
type ReferenceGraphProps = {
  data: Record<string, unknown> | null;
  articles?: unknown;
  reviewId?: string;
  workspace?: string;
  graphKey?: string;
  lookup?: { metadata: CitationMetadata | null; loading: boolean; error: string; onRetry: () => void };
};

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

function authorsText(value: unknown): string {
  if (Array.isArray(value)) return value.map(authorsText).filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    const author = value as RecordValue;
    return text(author.fullname ?? author.full_name ?? author.name) || [text(author.given), text(author.family)].filter(Boolean).join(" ");
  }
  const raw = text(value);
  const embedded = [...raw.matchAll(/["']fullname["']\s*:\s*["']([^"']+)["']/g)].map((match) => match[1]);
  return embedded.length ? embedded.join(", ") : raw;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/^pmid:\s*/, "");
}

function titleKey(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function doiUrl(value: string): string {
  return `https://doi.org/${normalize(value)}`;
}

function nodeByline(node: GraphNode): string {
  const firstAuthor = (node.authors || "").split(/[,;]/)[0].trim().split(/\s+/)[0];
  return [firstAuthor, node.year].filter(Boolean).join(", ");
}

function graphNodeLabel(node: GraphNode): string {
  const byline = nodeByline(node);
  if (node.kind === "paper" || node.authors) return byline;
  return node.label.length > 24 ? `${node.label.slice(0, 23)}…` : node.label || byline;
}

function NodeLink({ node, onSelect }: { node: GraphNode; onSelect: (id: string) => void }) {
  const byline = nodeByline(node);
  return <button type="button" onClick={() => onSelect(node.id)}>{byline && <strong>{byline}</strong>}<span>{node.label}</span></button>;
}

function articleIdentity(article: RecordValue, index: number): { id: string; keys: string[]; label: string } {
  const pmid = text(article.pmid ?? article.PMID);
  const doi = text(article.doi ?? article.DOI);
  const title = text(article.title ?? article.name);
  const id = pmid ? `pmid:${normalize(pmid)}` : doi ? `doi:${normalize(doi)}` : `paper:${index}`;
  return { id, keys: [pmid && `pmid:${normalize(pmid)}`, doi && `doi:${normalize(doi)}`, title && `title:${titleKey(title)}`].filter(Boolean), label: title || pmid || doi || `Study ${index + 1}` };
}

function referenceRecords(article: RecordValue): Array<{ keys: string[]; label: string; doi: string; authors: string; year: string; journal: string }> {
  const records: Array<{ keys: string[]; label: string; doi: string; authors: string; year: string; journal: string }> = [];
  const referenceKeys = new Set(["references", "reference_list", "cited_references", "citations", "cited_papers"]);
  const visited = new Set<object>();
  const toReference = (value: unknown) => {
    const raw = typeof value === "string" || typeof value === "number" ? text(value) : "";
    const item = object(value);
    const pmid = text(item.pmid ?? item.PMID);
    const doi = text(item.doi ?? item.DOI);
    const title = text(item.title ?? item["article-title"] ?? item.name ?? item.label ?? item.unstructured);
    const id = text(item.id ?? item.reference_id ?? item.paper_id ?? item.paperId);
    const keys = [
      pmid && `pmid:${normalize(pmid)}`,
      doi && `doi:${normalize(doi)}`,
      title && `title:${titleKey(title)}`,
      id && `id:${normalize(id)}`,
      raw && (/^10\./i.test(raw) || /doi\.org\//i.test(raw) ? `doi:${normalize(raw)}` : /^\d{5,12}$/.test(raw) ? `pmid:${normalize(raw)}` : `title:${titleKey(raw)}`),
    ].filter(Boolean) as string[];
    if (keys.length) records.push({ keys: [...new Set(keys)], label: title || pmid || doi || id || raw, doi,
      authors: authorsText(item.authors ?? item.author), year: text(item.year), journal: text(item.journal ?? item["journal-title"]) });
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

function graphData(raw: unknown, statusArticles: unknown, metadata: CitationMetadata | null): { nodes: GraphNode[]; edges: GraphEdge[]; paperCount: number; linkedPapers: number; referenceCount: number; hasReferenceData: boolean } {
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
  const externalByDoi = new Map((metadata?.papers ?? []).filter((paper) => paper.doi).map((paper) => [normalize(paper.doi), paper]));
  const externalByTitle = new Map((metadata?.papers ?? []).filter((paper) => paper.title).map((paper) => [titleKey(paper.title || ""), paper]));
  const externalByArxiv = new Map((metadata?.papers ?? []).filter((paper) => paper.arxiv_id).map((paper) => [normalize(paper.arxiv_id || ""), paper]));
  articles.forEach((article, index) => {
    const match = externalByDoi.get(normalize(text(article.doi ?? article.DOI))) ?? externalByTitle.get(titleKey(text(article.title ?? article.name))) ?? externalByArxiv.get(normalize(text(article.arxiv_id)));
    if (!match) return;
    const found = match.openreview;
    articles[index] = { ...article,
      authors: authorsText(article.authors) || found?.authors, year: text(article.year) || found?.year,
      abstract: text(article.abstract) || found?.abstract, journal: text(article.journal ?? article.venue) || found?.journal,
      openreview_url: found?.url, openreview_pdf_url: found?.pdf_url,
      reference_lookup_status: match.lookup_status, reference_source: match.reference_source,
      references: [...(Array.isArray(article.references) ? article.references : []), ...match.references] };
  });
  const papers = articles.map(articleIdentity);
  const articleByKey = new Map<string, string>();
  papers.forEach((paper) => paper.keys.forEach((key) => articleByKey.set(key, paper.id)));
  const nodes = new Map<string, Omit<GraphNode, "x" | "y">>();
  const edges = new Map<string, GraphEdge>();
  papers.forEach((paper, index) => nodes.set(paper.id, { ...paper, kind: "paper", state: text(articles[index].state), degree: 0,
    year: text(articles[index].year), authors: authorsText(articles[index].authors), journal: text(articles[index].journal),
    abstract: text(articles[index].abstract), doi: text(articles[index].doi), source: text(articles[index].source),
    openreviewUrl: text(articles[index].openreview_url), pdfUrl: text(articles[index].openreview_pdf_url),
    lookupStatus: text(articles[index].reference_lookup_status), referenceSource: text(articles[index].reference_source) }));
  const referenceByKey = new Map<string, string>();
  const citingByReference = new Map<string, Set<string>>();
  let hasReferenceData = false;

  papers.forEach((paper, index) => {
    const references = referenceRecords(articles[index]);
    if (references.length) hasReferenceData = true;
    references.forEach((reference) => {
      const target = reference.keys.map((key) => articleByKey.get(key)).find(Boolean);
      if (target && target !== paper.id) {
        const id = `${paper.id}->${target}`;
        edges.set(id, { id, source: paper.id, target, kind: "citation" });
        const existing = nodes.get(target);
        if (existing) nodes.set(target, { ...existing, authors: existing.authors || reference.authors,
          year: existing.year || reference.year, journal: existing.journal || reference.journal });
      } else if (!target) {
        const id = reference.keys.map((key) => referenceByKey.get(key)).find(Boolean) || `reference:${reference.keys[0]}`;
        reference.keys.forEach((key) => referenceByKey.set(key, id));
        citingByReference.set(id, new Set([...(citingByReference.get(id) ?? []), paper.id]));
        const existing = nodes.get(id);
        if (!existing) nodes.set(id, { id, label: reference.label, kind: "reference", degree: 0, doi: reference.doi,
          authors: reference.authors, year: reference.year, journal: reference.journal });
        else nodes.set(id, { ...existing, doi: existing.doi || reference.doi,
          label: existing.label === existing.doi && reference.label !== reference.doi ? reference.label : existing.label,
          authors: existing.authors || reference.authors, year: existing.year || reference.year, journal: existing.journal || reference.journal });
        const edgeId = `${paper.id}->${id}`;
        edges.set(edgeId, { id: edgeId, source: paper.id, target: id, kind: "shared" });
      }
    });
  });

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
    positions.set(node.id, { x: center.x + Math.cos(angle) * 265, y: center.y + Math.sin(angle) * 185 });
  });
  isolatedPapers.forEach((node, index) => {
    const angle = (index + .5) / Math.max(1, isolatedPapers.length) * Math.PI * 2 - Math.PI / 2;
    positions.set(node.id, { x: center.x + Math.cos(angle) * 390, y: center.y + Math.sin(angle) * 245 });
  });
  referenceNodes.filter((node) => (citingByReference.get(node.id)?.size ?? 0) > 1)
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id))
    .forEach((node, index) => {
      if (index < 12) {
        positions.set(node.id, { x: center.x + (index % 2 ? 110 : -110), y: center.y - 125 + Math.floor(index / 2) * 50 });
      } else {
        const angle = index * 2.39996;
        const radius = 135 + Math.sqrt(index - 12) * 14;
        positions.set(node.id, { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius * .8 });
      }
    });
  const uniqueReferenceIndex = new Map<string, number>();
  referenceNodes.filter((node) => (citingByReference.get(node.id)?.size ?? 0) === 1).forEach((node) => {
    const citingPaper = [...(citingByReference.get(node.id) ?? [])][0];
    const origin = positions.get(citingPaper) ?? center;
    const index = uniqueReferenceIndex.get(citingPaper) ?? 0;
    uniqueReferenceIndex.set(citingPaper, index + 1);
    const inward = Math.atan2(center.y - origin.y, center.x - origin.x);
    const angle = inward + Math.sin(index * 2.39996) * .9;
    const radius = 42 + Math.sqrt(index) * 15;
    positions.set(node.id, {
      x: Math.max(20, Math.min(980, origin.x + Math.cos(angle) * radius)),
      y: Math.max(20, Math.min(600, origin.y + Math.sin(angle) * radius)),
    });
  });
  const resultNodes = rawNodes.map((node) => ({ ...node, ...(positions.get(node.id) ?? center), degree: degree.get(node.id) ?? 0 }));
  const resultEdges = [...edges.values()];
  const linkedPapers = new Set(resultEdges.flatMap((edge) => [edge.source, edge.target]).filter((id) => nodes.get(id)?.kind === "paper")).size;
  return { nodes: resultNodes, edges: resultEdges, paperCount: paperNodes.length, linkedPapers, referenceCount: referenceNodes.length, hasReferenceData };
}

function ReferenceGraphView({ data, articles, reviewId, workspace, lookup }: ReferenceGraphProps) {
  const [metadata, setMetadata] = useState<CitationMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(true);
  const [showAllReferences, setShowAllReferences] = useState(false);
  const [focusedPaperId, setFocusedPaperId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [citationListOpen, setCitationListOpen] = useState(false);
  const [viewport, setViewport] = useState({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number; nodeId: string | null; moved: boolean } | null>(null);
  const dragFrame = useRef<number | null>(null);
  const pendingViewport = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const lastPaperClick = useRef<{ id: string; time: number; x: number; y: number } | null>(null);
  useEffect(() => { setSelectedId(null); setFocusedPaperId(null); setHoveredId(null); setShowAllReferences(false); setCitationListOpen(false); lastPaperClick.current = null; }, [reviewId, lookup?.metadata]);
  useEffect(() => () => {
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
  }, []);
  useEffect(() => {
    if (lookup) return;
    let active = true;
    setMetadata(null);
    setLoading(true);
    setLookupError("");
    const bridge = (window as Window & { __TAURI__?: { core: { invoke: <T>(name: string, args: Record<string, unknown>) => Promise<T> } } }).__TAURI__?.core;
    if (!reviewId) { setLoading(false); setLookupError("Thiếu mã review để tra cứu bản đồ."); return; }
    if (!bridge) { setLoading(false); setLookupError("Chỉ có thể tra Crossref trong ứng dụng desktop."); return; }
    void bridge.invoke<CitationMetadata>("reference_graph", { workspace, id: reviewId, refresh: retry > 0 })
      .then((value) => { if (active) setMetadata(value); })
      .catch((error) => { if (active) setLookupError(String(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [Boolean(lookup), reviewId, workspace, retry]);
  const resolvedMetadata = lookup ? lookup.metadata : metadata;
  const resolvedLoading = lookup ? lookup.loading : loading;
  const resolvedError = lookup ? lookup.error : lookupError;
  const graph = useMemo(() => {
    const csSchema = typeof data?.schema === "string" && data.schema.startsWith("cs_literature_intelligence_v");
    const structuredArticles = csSchema && Array.isArray(data?.articles)
      ? data.articles.filter((article) => object(article).scope === "core" || (!object(article).scope && object(article).screening_decision === "include"))
      : data?.included_articles;
    return graphData(structuredArticles, articles, resolvedMetadata);
  }, [articles, data, resolvedMetadata]);
  const papers = useMemo(() => graph.nodes.filter((node) => node.kind === "paper"), [graph.nodes]);
  const byId = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const activeId = hoveredId || selected?.id || null;
  const selectNode = (id: string) => {
    setCitationListOpen(false);
    setSelectedId(id);
    if (focusedPaperId && byId.get(id)?.kind === "paper" && id !== focusedPaperId) {
      setFocusedPaperId(null);
      setViewport({ scale: 1, x: 0, y: 0 });
    }
  };
  const openSubgraph = (id: string) => {
    if (byId.get(id)?.kind !== "paper") return;
    lastPaperClick.current = null;
    setSelectedId(id);
    setFocusedPaperId(id);
    setShowAllReferences(false);
    setViewport({ scale: 1, x: 0, y: 0 });
  };
  const closeDetail = () => { lastPaperClick.current = null; setCitationListOpen(false); setSelectedId(null); setFocusedPaperId(null); setViewport({ scale: 1, x: 0, y: 0 }); };
  const toggleAllReferences = () => {
    if (showAllReferences) {
      setShowAllReferences(false);
      closeDetail();
    } else {
      setShowAllReferences(true);
      setViewport({ scale: 1, x: 0, y: 0 });
    }
  };
  const shown = useMemo(() => {
    if (!showAllReferences && focusedPaperId) {
      const paper = graph.nodes.find((node) => node.id === focusedPaperId);
      const edges = graph.edges.filter((edge) => edge.source === focusedPaperId);
      const targetIds = [...new Set(edges.map((edge) => edge.target))];
      const targets = targetIds.map((id) => graph.nodes.find((node) => node.id === id))
        .filter((node): node is GraphNode => Boolean(node))
        .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
      const positions = new Map<string, { x: number; y: number }>([[focusedPaperId, { x: 500, y: 310 }]]);
      for (let start = 0, ring = 0; start < targets.length; ring++) {
        const group = targets.slice(start, start + 10 + ring * 6);
        const radiusX = Math.min(410, 155 + ring * 85);
        const radiusY = Math.min(240, 105 + ring * 45);
        group.forEach((node, index) => {
          const angle = (index + (ring % 2) * .5) / group.length * Math.PI * 2 - Math.PI / 2;
          positions.set(node.id, { x: 500 + Math.cos(angle) * radiusX, y: 310 + Math.sin(angle) * radiusY });
        });
        start += group.length;
      }
      return {
        nodes: [paper, ...targets].filter((node): node is GraphNode => Boolean(node))
          .map((node) => ({ ...node, ...(positions.get(node.id) ?? { x: 500, y: 310 }) })),
        edges,
      };
    }
    if (graph.paperCount === 1) {
      const paper = graph.nodes.find((node) => node.kind === "paper");
      const rankedReferences = graph.nodes.filter((node) => node.kind === "reference")
        .sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
      const references = showAllReferences ? rankedReferences : rankedReferences.slice(0, 12);
      if (selected?.kind === "reference" && !references.some((node) => node.id === selected.id)) references.push(selected);
      const positions = new Map<string, { x: number; y: number }>();
      if (paper) positions.set(paper.id, { x: 500, y: 310 });
      for (let start = 0, ring = 0; start < references.length; ring++) {
        const capacity = showAllReferences ? 12 + ring * 6 : references.length;
        const group = references.slice(start, start + capacity);
        const radiusX = showAllReferences ? Math.min(405, 170 + ring * 110) : 300;
        const radiusY = showAllReferences ? Math.min(255, 105 + ring * 72) : 195;
        group.forEach((node, index) => {
          const angle = (index + (ring % 2) * .5) / group.length * Math.PI * 2 - Math.PI / 2;
          positions.set(node.id, { x: 500 + Math.cos(angle) * radiusX, y: 310 + Math.sin(angle) * radiusY });
        });
        start += group.length;
      }
      const visibleIds = new Set([paper?.id, ...references.map((node) => node.id)].filter((id): id is string => Boolean(id)));
      return {
        nodes: [paper, ...references].filter((node): node is GraphNode => Boolean(node))
          .map((node) => ({ ...node, ...(positions.get(node.id) ?? { x: 500, y: 310 }) })),
        edges: graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
      };
    }
    const referenceNodes = graph.nodes.filter((node) => node.kind === "reference")
      .sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
    const sharedReferences = referenceNodes.filter((node) => node.degree > 1).slice(0, 8);
    const previewReferences = graph.paperCount === 1 ? referenceNodes.slice(0, 12) : sharedReferences;
    const prominentReferences = new Set(previewReferences.map((node) => node.id));
    const visibleIds = new Set(graph.nodes.filter((node) => node.kind === "paper" || showAllReferences).map((node) => node.id));
    if (!showAllReferences) {
      prominentReferences.forEach((id) => visibleIds.add(id));
    }
    if (selected?.kind === "reference") visibleIds.add(selected.id);
    return {
      nodes: graph.nodes.filter((node) => visibleIds.has(node.id)),
      edges: graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
    };
  }, [graph.nodes, graph.edges, graph.paperCount, selected?.id, selected?.kind, focusedPaperId, showAllReferences]);
  const shownById = useMemo(() => new Map(shown.nodes.map((node) => [node.id, node])), [shown.nodes]);
  const visibleReferenceCount = shown.nodes.filter((node) => node.kind === "reference").length;
  const visibleLabels = useMemo(() => {
    const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    const visible = new Set<string>();
    const priority = [...shown.nodes]
      .sort((a, b) => Number(b.id === activeId) - Number(a.id === activeId) || Number(b.kind === "paper") - Number(a.kind === "paper") || b.degree - a.degree);
    for (const node of priority) {
      const label = graphNodeLabel(node);
      if (!label) continue;
      const radius = node.kind === "reference" ? Math.min(11, 4 + node.degree * .7) : Math.min(17, 6 + node.degree * .9);
      const width = label.length * 6 + 8;
      const bounds = node.kind === "reference"
        ? { left: node.x - width / 2, right: node.x + width / 2, top: node.y + radius + 2, bottom: node.y + radius + 20 }
        : { left: node.x - width / 2, right: node.x + width / 2, top: node.y - radius - 21, bottom: node.y - radius - 4 };
      if (node.id !== activeId && occupied.some((other) => bounds.left < other.right && bounds.right > other.left && bounds.top < other.bottom && bounds.bottom > other.top)) continue;
      occupied.push(bounds);
      visible.add(node.id);
    }
    return visible;
  }, [shown.nodes, activeId]);
  const relatedEdges = activeId ? graph.edges.filter((edge) => edge.source === activeId || edge.target === activeId) : [];
  const highlightedEdges = new Set(relatedEdges.map((edge) => edge.id));
  const highlightedNodes = new Set([activeId, ...relatedEdges.flatMap((edge) => [edge.source, edge.target])]);
  const visiblePapers = papers.filter((node) => `${node.label} ${node.authors ?? ""} ${node.doi ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const years = papers.map((paper) => Number(paper.year)).filter((year) => Number.isFinite(year) && year > 1800);
  const firstYear = years.length ? Math.min(...years) : 0;
  const lastYear = years.length ? Math.max(...years) : 0;
  const yearColor = (year: string | undefined) => {
    if (!year || !Number.isFinite(Number(year))) return "color-mix(in srgb, var(--red) 58%, var(--muted))";
    const ratio = firstYear === lastYear ? .5 : Math.max(0, Math.min(1, (Number(year) - firstYear) / (lastYear - firstYear)));
    return `color-mix(in srgb, var(--red) ${38 + Math.round(ratio * 62)}%, var(--surface))`;
  };
  const selectedEdges = selected ? graph.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id) : [];
  const citedWorks = selected?.kind === "paper" ? selectedEdges.filter((edge) => edge.source === selected.id).map((edge) => byId.get(edge.target)).filter((node): node is GraphNode => Boolean(node)) : [];
  const citingPapers = selected ? selectedEdges.filter((edge) => edge.target === selected.id).map((edge) => byId.get(edge.source)).filter((node): node is GraphNode => node?.kind === "paper") : [];
  const zoom = (factor: number) => setViewport((value) => ({ ...value, scale: Math.max(.65, Math.min(2.8, value.scale * factor)) }));
  const onWheel = (event: WheelEvent<SVGSVGElement>) => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12); };
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    suppressClick.current = false;
    const nodeId = event.target instanceof Element ? event.target.closest<SVGGElement>("g[data-node-id]")?.dataset.nodeId ?? null : null;
    drag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: viewport.x, y: viewport.y, nodeId, moved: false };
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
    const { moved, nodeId } = drag.current;
    suppressClick.current = moved;
    drag.current = null;
    if (moved) { lastPaperClick.current = null; return; }
    const previous = lastPaperClick.current;
    if (previous && event.timeStamp - previous.time < 500
      && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 28) {
      suppressClick.current = true;
      openSubgraph(previous.id);
      return;
    }
    lastPaperClick.current = nodeId && byId.get(nodeId)?.kind === "paper"
      ? { id: nodeId, time: event.timeStamp, x: event.clientX, y: event.clientY } : null;
    if (nodeId) selectNode(nodeId);
  };
  return <><section className="rw-reference-graph" aria-label="Bản đồ liên kết tài liệu">
    <header className="rw-reference-graph-head"><div><span className="rw-kicker">BẢN ĐỒ TÀI LIỆU</span><h2>Liên kết tham chiếu</h2></div><div className="rw-reference-graph-stats"><span><b>{graph.paperCount}</b> bài báo</span><span><b>{graph.referenceCount}</b> reference duy nhất</span><span><b>{graph.edges.length}</b> liên kết</span><span><b>{graph.paperCount - graph.linkedPapers}</b> bài chưa có liên kết</span></div></header>
    <p>Bản đồ này phục vụ khám phá sau review. Các reference hiển thị ở đây chưa được sàng lọc và không thay đổi corpus hay bằng chứng trong review.json.</p>
    <div className={`rw-reference-graph-layout${listOpen ? "" : " list-hidden"}${selected ? " detail-open" : ""}`}>
      {listOpen && <aside className="rw-graph-list" aria-label="Danh sách bài báo"><div className="rw-graph-pane-head"><strong>Bài trong review <span>{papers.length}</span></strong><button type="button" onClick={() => setListOpen(false)} aria-label="Ẩn danh sách bài báo" title="Ẩn danh sách"><PanelLeftClose size={16} /></button></div><label className="rw-graph-search"><Search size={14} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm bài báo…" aria-label="Tìm bài báo trong graph" /></label><div className="rw-graph-paper-list">{visiblePapers.map((paper) => <button type="button" key={paper.id} className={`rw-graph-paper-row${selected?.id === paper.id ? " selected" : ""}`} onClick={() => selectNode(paper.id)} onDoubleClick={() => openSubgraph(paper.id)} onMouseEnter={() => setHoveredId(paper.id)} onMouseLeave={() => setHoveredId(null)} title="Nhấp đúp để mở subgraph"><strong>{paper.label}</strong><small>{paper.authors || paper.source || "Tác giả chưa có"}<span>{paper.year || "—"}</span></small></button>)}{!visiblePapers.length && <p className="rw-graph-empty-list">Không tìm thấy bài phù hợp.</p>}</div></aside>}
        <div className="rw-graph-stage"><div className="rw-graph-stage-top"><div className="rw-graph-stage-status">{!listOpen && <button className="rw-graph-show-list" onClick={() => setListOpen(true)} aria-label="Hiện danh sách bài báo" title="Hiện danh sách"><PanelLeftOpen size={16} /><span>Danh sách</span></button>}<span>{resolvedLoading ? "Đang tra Crossref, OpenAlex, Semantic Scholar và OpenReview…" : resolvedMetadata ? `Có ref ${resolvedMetadata.papers.filter((paper) => paper.references.length > 0).length}/${resolvedMetadata.queried} bài · OpenReview ${resolvedMetadata.papers.filter((paper) => paper.openreview).length} bài` : resolvedError || "Dữ liệu từ review"}</span></div><div className="rw-graph-stage-actions"><button type="button" className="rw-graph-mode" onClick={toggleAllReferences} aria-pressed={showAllReferences}>{showAllReferences ? "Thu gọn" : `Xem tất cả ${graph.referenceCount} ref`}</button><button type="button" onClick={() => lookup ? lookup.onRetry() : setRetry((value) => value + 1)} disabled={resolvedLoading}>Tra lại</button></div></div>
        <div className="rw-graph-canvas">{resolvedLoading ? <div className="rw-graph-loading" role="status">Đang dựng mạng trích dẫn…</div> : graph.paperCount ? <svg viewBox="0 0 1000 620" role="img" aria-label={`Mạng gồm ${graph.paperCount} bài báo và ${graph.edges.length} cạnh`} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; }} onClickCapture={(event) => { if (suppressClick.current) { event.stopPropagation(); suppressClick.current = false; } }}>
          <g transform={`translate(${viewport.x} ${viewport.y}) translate(500 310) scale(${viewport.scale}) translate(-500 -310)`}><g className="rw-graph-edges">{shown.edges.map((edge) => { const source = shownById.get(edge.source), target = shownById.get(edge.target); if (!source || !target) return null; return <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} className={`${edge.kind}${activeId ? highlightedEdges.has(edge.id) ? " active" : " faded" : ""}`} />; })}</g>
          <g className="rw-graph-nodes">{shown.nodes.map((node) => {
            const radius = node.kind === "reference" ? Math.min(11, 4 + node.degree * .7) : Math.min(17, 6 + node.degree * .9);
            return <g key={node.id} data-node-id={node.id} className={`node ${node.kind}${activeId && !highlightedNodes.has(node.id) ? " faded" : ""}${selected?.id === node.id ? " selected" : ""}`} transform={`translate(${node.x} ${node.y})`} tabIndex={0} role="button" aria-label={[graphNodeLabel(node), node.label, node.kind === "paper" ? "Nhấp đúp hoặc Shift Enter để mở subgraph" : ""].filter(Boolean).join(" · ")} onClick={() => selectNode(node.id)} onDoubleClick={() => openSubgraph(node.id)} onKeyDown={(event) => { if (event.key === "Enter" && event.shiftKey && node.kind === "paper") { event.preventDefault(); openSubgraph(node.id); } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectNode(node.id); } }} onMouseEnter={() => setHoveredId(node.id)} onMouseLeave={() => setHoveredId(null)} onFocus={() => setHoveredId(node.id)} onBlur={() => setHoveredId(null)}>
              <circle r={radius} style={node.kind === "paper" ? { fill: yearColor(node.year) } : undefined} />
              {visibleLabels.has(node.id) && <text y={node.kind === "reference" ? radius + 17 : -radius - 7} textAnchor="middle">{graphNodeLabel(node)}</text>}
              <title>{node.kind === "paper" ? `${node.label} · Nhấp đúp để mở subgraph` : node.label}</title>
            </g>;
          })}</g></g>
        </svg> : <div className="rw-graph-loading">Chưa có bài báo để vẽ graph.</div>}{!resolvedLoading && !graph.edges.length && graph.paperCount > 0 && <p className="rw-graph-no-links">Chưa tìm thấy reference từ Crossref, OpenAlex hoặc Semantic Scholar. Chọn “Tra lại” để thử lại.</p>}</div>
        <div className="rw-graph-stage-bottom"><span>● Bài trong review&nbsp;&nbsp; ◌ {showAllReferences ? `Tất cả ${visibleReferenceCount} ref` : focusedPaperId ? `${visibleReferenceCount} ref trong subgraph` : `${visibleReferenceCount} ref nổi bật · Nhấp đúp bài để mở subgraph`}</span>{firstYear > 0 && <div className="rw-graph-year-scale"><i /><span>{firstYear}</span><span>{lastYear}</span></div>}<div className="rw-graph-zoom"><button type="button" aria-label="Thu nhỏ graph" onClick={() => zoom(1 / 1.2)}><Minus size={15} /></button><button type="button" aria-label="Đặt lại khung nhìn" onClick={() => setViewport({ scale: 1, x: 0, y: 0 })}><Crosshair size={15} /></button><button type="button" aria-label="Phóng to graph" onClick={() => zoom(1.2)}><Plus size={15} /></button></div></div>
      </div>
      {selected && <aside className="rw-graph-detail" aria-label="Chi tiết tài liệu">
        <div className="rw-graph-detail-scroll">
          <div className="rw-graph-detail-head"><span className="rw-graph-detail-kicker">{selected.kind === "paper" ? "BÀI BÁO TRONG REVIEW" : "TÀI LIỆU ĐƯỢC TRÍCH DẪN"}</span><button type="button" onClick={closeDetail} aria-label="Ẩn chi tiết tài liệu" title="Ẩn chi tiết"><X size={16} /></button></div>
          <h3>{selected.label}</h3>
          {selected.authors && <p className="rw-graph-authors">{selected.authors}</p>}
          <p className="rw-graph-publication">{[selected.year, selected.journal || selected.source].filter(Boolean).join(" · ")}</p>
          <div className="rw-graph-detail-metrics"><span>{selectedEdges.length} liên kết trong graph</span>{selected.doi && <button type="button" className="rw-graph-doi-link" onClick={() => void openUrl(doiUrl(selected.doi!))}>Mở DOI <ExternalLink size={13} /></button>}</div>
          {selected.kind === "paper" && selected.referenceSource && <p className="rw-graph-publication">Nguồn reference: {selected.referenceSource}</p>}
          {selected.openreviewUrl && <div className="rw-graph-source-links"><button type="button" onClick={() => void openUrl(selected.openreviewUrl!)}>Mở OpenReview <ExternalLink size={13} /></button>{selected.pdfUrl && <button type="button" onClick={() => void openUrl(selected.pdfUrl!)}>Mở PDF <ExternalLink size={13} /></button>}</div>}
          {selected.abstract && <section className="rw-graph-abstract"><h4>Tóm tắt</h4><p>{selected.abstract}</p></section>}
          {selected.kind === "paper" && !selected.abstract && <p className="rw-graph-missing-abstract">Chưa có tóm tắt cho tài liệu này.</p>}
          {selected.kind === "paper" && selected.lookupStatus === "lookup_failed" && citedWorks.length > 0 && <p className="rw-graph-missing-abstract">Đã lấy được một phần reference, nhưng một nguồn chưa phản hồi. Chọn “Tra lại” để thử bổ sung.</p>}
          {selected.kind === "paper" && !resolvedLoading && !citedWorks.length && <p className="rw-graph-missing-abstract">{selected.lookupStatus === "lookup_failed" ? "Chưa tra xong reference cho bài này vì một nguồn dữ liệu chưa phản hồi. Hãy chọn “Tra lại”." : "Chưa tìm thấy reference cho bài này trên Crossref, OpenAlex hoặc Semantic Scholar. Các nguồn có thể chưa lập chỉ mục bài hoặc chưa có danh sách trích dẫn."}</p>}
          {citedWorks.length > 0 && <section className="rw-graph-neighbors"><h4>Tài liệu bài này trích dẫn ({citedWorks.length})</h4>{citedWorks.slice(0, 5).map((node) => <NodeLink key={node.id} node={node} onSelect={selectNode} />)}{citedWorks.length > 5 && <button type="button" className="rw-graph-view-more" onClick={() => setCitationListOpen(true)}>Xem thêm {citedWorks.length - 5} tài liệu <ArrowRight size={14} /></button>}</section>}
          {citingPapers.length > 0 && <section className="rw-graph-neighbors"><h4>{selected.kind === "paper" ? "Được bài trong review trích dẫn" : "Được trích dẫn bởi"} ({citingPapers.length})</h4>{citingPapers.map((node) => <NodeLink key={node.id} node={node} onSelect={selectNode} />)}</section>}
        </div>
      </aside>}
    </div>
  </section>
    {citationListOpen && selected && <div className="rw-graph-citations-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setCitationListOpen(false); }}><section className="rw-graph-citations-modal" role="dialog" aria-modal="true" aria-label={`Danh sách ${citedWorks.length} tài liệu được trích dẫn`}><ModalEscape onClose={() => setCitationListOpen(false)} /><header><div><span className="rw-graph-detail-kicker">DANH SÁCH TRÍCH DẪN</span><h2>{selected.label}</h2><p>{citedWorks.length} tài liệu được bài báo này trích dẫn</p></div><button type="button" onClick={() => setCitationListOpen(false)} aria-label="Đóng danh sách trích dẫn"><X size={17} /></button></header><div className="rw-graph-citations-list">{citedWorks.map((node, index) => <article key={node.id}><span>{String(index + 1).padStart(2, "0")}</span><NodeLink node={node} onSelect={selectNode} /></article>)}</div></section></div>}
  </>;
}

export function ReferenceGraph(props: ReferenceGraphProps) {
  return <ReferenceGraphBoundary resetKey={props.graphKey ?? props.reviewId ?? "reference-graph"}><ReferenceGraphView {...props} /></ReferenceGraphBoundary>;
}
