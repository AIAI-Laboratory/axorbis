import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Activity, ArrowRight, Check, ChevronRight, Circle, Clock3, Cpu, ExternalLink, FileCheck2, FolderSearch, Layers3, Search, Sparkles, Users, X, Zap } from "lucide-react";
import { ModalEscape } from "./modal-escape";
import { useCountUp } from "./use-count-up";

type Article = { pmid: string; title: string; abstract?: string; year?: string; source?: string; doi?: string; state: string; scope?: string; text_status?: string; reason?: string; stage?: string };
type CrossrefMetadata = { title: string; authors: unknown[]; date: string; journal: string; publisher: string; type: string; volume: string; issue: string; page: string; doi: string; url: string; abstract: string; citationCount: number | null };
type CrossrefResult = { found: boolean; metadata?: CrossrefMetadata; error?: string; loading?: boolean };
type KeyUsage = { id: string; state: string; active: boolean; requests: number; tokens: number };
type RunReview = {
  title: string;
  state: "running" | "failed" | "cancelled" | "interrupted" | "completed" | "search_complete" | "screening_complete" | "evidence_mapping_complete" | "study_profiling_complete" | "mapping_complete" | "candidate_gaps_found" | "gap_verification_complete" | "synthesis_complete" | "insufficient_evidence";
  progress: string[];
  error: string | null;
  updatedAt: number | string;
  parallelLimit?: number;
  pipelineStatus?: string;
  qualityGate?: { included_papers: number; full_text_available: number; studies_with_grounded_evidence: number; basic_evidence_coverage: number; deep_evidence_coverage: number; evidence_coverage: number; candidate_gap_count?: number };
  gapVerification?: { status?: string; reason?: string; searched_sources?: string[] };
  keyUsage?: KeyUsage[];
  keyCount?: number;
  tokenUsage?: { input: number; output: number; total: number; requests: number };
  articles?: Article[];
  stageEvent?: { stage: string; state: string; message: string; timestamp: string };
};
type Detail = { type: "all" } | { type: "entry"; message: string; number: number } | { type: "stage"; index: number } | { type: "error"; message: string };

const stages = [
  { title: "Lập kế hoạch truy vấn", detail: "Tách chủ đề thành khái niệm bắt buộc, tác vụ và chiều tổng quát hóa", icon: Sparkles, match: /query_understanding|Profiling research concepts/i },
  { title: "Tìm kiếm & khử trùng lặp", detail: "Tìm đa nguồn và hợp nhất DOI, arXiv ID, tiêu đề, tác giả và năm", icon: FolderSearch, match: /records|Search complete|Searching Computer Science/i },
  { title: "Sàng lọc phạm vi", detail: "Phân loại core, background hoặc exclude theo từng tiêu chí", icon: Layers3, match: /Screened|screening/i },
  { title: "Làm giàu nguồn", detail: "Bổ sung abstract và tìm toàn văn hợp lệ mà không loại bài paywall", icon: Users, match: /Abstract (?:enriched|not found)|Full text/i },
  { title: "Ánh xạ bằng chứng", detail: "LLM chọn EvidenceSpan có nghĩa đầy đủ và liên kết về đúng nguyên văn", icon: Activity, match: /Grounded spans|evidence_extraction/i },
  { title: "Hồ sơ nghiên cứu", detail: "Lập StudyProfile và ma trận YES/NO/UNKNOWN/N/A từ bằng chứng đã chọn", icon: Users, match: /study_profiling/i },
  { title: "Phân tích liên bài", detail: "Phân tích quan hệ giữa các chiều thay vì chỉ đếm từng trường", icon: FileCheck2, match: /cross_paper_analysis/i },
  { title: "Phát hiện khoảng trống", detail: "Sinh gap ứng viên từ các tổ hợp thưa nhưng vẫn giữ UNKNOWN là chưa biết", icon: Layers3, match: /candidate_gaps|no_candidate_gaps|gap_analysis/i },
  { title: "Xác minh gap", detail: "Tìm kiếm bổ sung có mục tiêu để tìm bằng chứng phản bác gap ứng viên", icon: Search, match: /counter-search|gap_verification/i },
];

const terminalStates = new Set(["completed", "mapping_complete", "candidate_gaps_found", "gap_verification_complete", "synthesis_complete", "insufficient_evidence"]);
const articleScope = (article: Article) => article.scope || (article.state === "include" ? "core" : article.state === "manual_review" ? "background" : article.state);

function activeStage(progress: string[]): number {
  let current = 0;
  for (const message of progress) stages.forEach((item, index) => { if (item.match.test(message)) current = index; });
  return current;
}

function articleForLog(message: string, articles: Article[]): number {
  const text = message.toLowerCase();
  return articles.findIndex((article) => {
    const pmid = article.pmid?.trim();
    const doi = article.doi?.trim().toLowerCase();
    const title = article.title?.trim().toLowerCase();
    return (pmid && /^\d{5,12}$/.test(pmid) && new RegExp(`(^|\\D)${pmid}(\\D|$)`).test(text))
      || (doi && text.includes(doi))
      || (title && title.length >= 18 && text.includes(title));
  });
}

function keyStateLabel(key: KeyUsage): string {
  if (key.active) return "Đang gọi";
  if (key.state === "rate-limited") return "Giới hạn 429";
  if (key.state === "error") return "Lỗi";
  return key.requests ? "Đã dùng" : "Chưa dùng";
}

function verificationReasonLabel(reason: string | undefined, candidateCount: number): string {
  if (!reason) return candidateCount === 0
    ? "Không phát hiện gap ứng viên nào đáp ứng quy tắc bằng chứng cấu trúc."
    : "Gap ứng viên chưa có đủ bằng chứng toàn văn từ ít nhất hai nghiên cứu độc lập.";
  if (/no candidate gap/i.test(reason)) return "Không phát hiện gap ứng viên nào đáp ứng quy tắc bằng chứng cấu trúc.";
  if (/lacks two independently supported full-text studies|insufficient full-text evidence/i.test(reason)) return "Gap ứng viên chưa có bằng chứng toàn văn từ ít nhất hai nghiên cứu độc lập.";
  if (/require a completed targeted counter-search/i.test(reason)) return "Đã phát hiện gap ứng viên nhưng tìm kiếm bổ sung chưa được thực hiện hoàn tất.";
  return reason;
}

function crossrefArticleKey(article: Article): string {
  return article.doi?.trim().toLowerCase() || article.pmid?.trim() || article.title;
}

function displayAuthors(values: unknown[]): string[] {
  const names: string[] = [];
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const author = value as Record<string, unknown>;
      const direct = author.fullname ?? author.full_name ?? author.name;
      const combined = [author.given, author.family].filter((part) => typeof part === "string" && part.trim()).join(" ");
      const name = typeof direct === "string" ? direct.trim() : combined;
      if (name) names.push(name);
      continue;
    }
    if (typeof value !== "string") continue;
    const embedded = [...value.matchAll(/["']fullname["']\s*:\s*["']([^"']+)["']/g)].map((match) => match[1].trim());
    if (embedded.length) names.push(...embedded);
    else if (value.trim() && !/^https?:\/\//.test(value.trim())) names.push(value.trim());
  }
  return [...new Set(names)];
}

function ArticleDetailDialog({ article, result, onClose }: { article: Article; result: CrossrefResult | null; onClose: () => void }) {
  const metadata = result?.metadata;
  const authorNames = displayAuthors(metadata?.authors ?? []);
  const publicationDetails = metadata
    ? [metadata.volume && `Tập ${metadata.volume}`, metadata.issue && `Số ${metadata.issue}`, metadata.page && `Trang ${metadata.page}`].filter(Boolean).join(" · ")
    : "";
  return <div className="run-log-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="run-log-detail rw-article-detail" role="dialog" aria-modal="true" aria-label="Chi tiết tài liệu">
      <ModalEscape onClose={onClose} />
      <header>
        <div>
          <span className="run-eyebrow">{articleScope(article) === "core" ? "NGHIÊN CỨU CỐT LÕI" : articleScope(article) === "background" ? "TÀI LIỆU BỐI CẢNH" : articleScope(article) === "exclude" ? "LOẠI TRỪ" : "CHỜ XỬ LÝ"}</span>
          <div className="rw-article-title-row">
            <h2>{metadata?.title || article.title || article.pmid}</h2>
            {metadata?.url && <a className="rw-article-title-link" href={metadata.url} target="_blank" rel="noreferrer" aria-label="Mở trang bài báo"><ExternalLink size={15} /></a>}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Đóng"><X size={17} /></button>
      </header>
      <div className="run-log-detail-body">
        {result?.loading && <p className="rw-crossref-status">Đang tải thông tin Crossref…</p>}
        {result && !result.loading && !result.found && <p className="rw-crossref-status">{result.error || "Không tìm thấy bản ghi Crossref."}</p>}
        <p className="rw-article-source">{[article.source, article.pmid && `ID: ${article.pmid}`].filter(Boolean).join(" · ")}</p>
        {article.reason && <p><strong>Lý do sàng lọc:</strong> {article.reason}</p>}
        {metadata && <section className="rw-crossref-section">
          <h3>Xuất bản <span>Crossref</span></h3>
          <dl className="rw-crossref-grid">
            {authorNames.length > 0 && <div className="wide"><dt>Tác giả</dt><dd>{authorNames.join(", ")}</dd></div>}
            <div><dt>Tạp chí</dt><dd>{metadata.journal || "—"}</dd></div>
            <div><dt>Năm</dt><dd>{metadata.date || article.year || "—"}</dd></div>
            <div><dt>Nhà xuất bản</dt><dd>{metadata.publisher || "—"}</dd></div>
            {publicationDetails && <div><dt>Tập / trang</dt><dd>{publicationDetails}</dd></div>}
            <div><dt>DOI</dt><dd>{metadata.doi || article.doi || "—"}</dd></div>
            {metadata.citationCount !== null && <div><dt>Trích dẫn</dt><dd>{metadata.citationCount}</dd></div>}
          </dl>
        </section>}
        <section className="rw-crossref-section rw-crossref-abstract">
          <h3>Tóm tắt</h3>
          <p>{metadata?.abstract || article.abstract || "Crossref và kết quả tìm kiếm không cung cấp tóm tắt."}</p>
        </section>
      </div>
    </section>
  </div>;
}

export function ReviewRun({ review, runtime, onOpenLog, onOpenGeminiLog }: { review: RunReview; runtime: string | null; onOpenLog: () => void; onOpenGeminiLog: () => void }) {
  const running = review.state === "running";
  const progress = review.progress ?? [];
  const stageIndex = { QUERY_PLANNING: 0, SEARCH: 1, SCREENING: 2, SOURCE_ENRICHMENT: 3,
    EVIDENCE_MAPPING: 4, STUDY_PROFILING: 5, CROSS_PAPER_ANALYSIS: 6, GAP_DETECTION: 7,
    GAP_VERIFICATION: 8 } as Record<string, number>;
  const stage = stageIndex[review.stageEvent?.stage || ""] ?? activeStage(progress);
  const usage = review.tokenUsage;
  const keys = review.keyUsage?.length ? review.keyUsage : Array.from({ length: review.keyCount ?? 0 }, (_, index) => ({ id: `Key ${index + 1}`, state: "idle", active: false, requests: 0, tokens: 0 }));
  const keyRequests = keys.reduce((sum, key) => sum + key.requests, 0);
  // Keep each configured key in a stable slot and color. Sorting by live
  // request count made the labels jump between positions while a run updated.
  const visibleKeys = keys.slice(0, 4);
  const hiddenKeys = keys.slice(4);
  const hiddenRequests = hiddenKeys.reduce((sum, key) => sum + key.requests, 0);
  const articles = review.articles ?? [];
  const number = new Intl.NumberFormat("vi-VN");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [articleDetail, setArticleDetail] = useState<Article | null>(null);
  const [crossrefResults, setCrossrefResults] = useState<Record<string, CrossrefResult>>({});
  const [keyDetail, setKeyDetail] = useState(false);
  const [articleQuery, setArticleQuery] = useState("");
  const [articleFilter, setArticleFilter] = useState("all");
  const [followLog, setFollowLog] = useState(true);
  const [highlightedArticleIndex, setHighlightedArticleIndex] = useState<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const lastLogScrollTop = useRef(0);
  const lastProgressLength = useRef(progress.length);
  const articleRefs = useRef(new Map<number, HTMLButtonElement>());
  const crossrefRequested = useRef(new Set<string>());
  const crossrefQueue = useRef<Article[]>([]);
  const crossrefActive = useRef(0);
  const totalTokens = useCountUp(usage?.total ?? null);
  const modelCalls = useCountUp(usage?.requests ?? null);

  const requestCrossref = useCallback((article: Article) => {
    const key = crossrefArticleKey(article);
    if (crossrefRequested.current.has(key)) return;
    crossrefRequested.current.add(key);
    setCrossrefResults((current) => ({ ...current, [key]: { found: false, loading: true } }));
    crossrefQueue.current.push(article);
    const startQueued = () => {
      while (crossrefActive.current < 4 && crossrefQueue.current.length) {
        const next = crossrefQueue.current.shift()!;
        const nextKey = crossrefArticleKey(next);
        crossrefActive.current += 1;
        void invoke<CrossrefResult>("crossref_article", { doi: next.doi ?? "", title: next.title ?? "" })
          .then((result) => setCrossrefResults((current) => ({ ...current, [nextKey]: result })))
          .catch((error) => setCrossrefResults((current) => ({ ...current, [nextKey]: { found: false, error: String(error) } })))
          .finally(() => { crossrefActive.current -= 1; startQueued(); });
      }
    };
    startQueued();
  }, []);

  useEffect(() => {
    articles.filter((article) => articleScope(article) === "core").forEach(requestCrossref);
  }, [articles, requestCrossref]);

  const crossrefResult = articleDetail ? crossrefResults[crossrefArticleKey(articleDetail)] ?? null : null;

  useLayoutEffect(() => {
    const node = logRef.current;
    if (!followLog || !node) return;
    const isNewEntry = progress.length > lastProgressLength.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollTo({ top: node.scrollHeight, behavior: isNewEntry && !reducedMotion ? "smooth" : "auto" });
    lastLogScrollTop.current = node.scrollHeight;
    lastProgressLength.current = progress.length;
  }, [progress.length, progress[progress.length - 1], review.updatedAt, followLog]);
  useEffect(() => {
    if (highlightedArticleIndex !== null) articleRefs.current.get(highlightedArticleIndex)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlightedArticleIndex, articleFilter, articleQuery]);

  const openLogEntry = (message: string, index: number) => {
    const articleIndex = articleForLog(message, articles);
    setDetail({ type: "entry", message, number: index });
    if (articleIndex < 0) {
      setHighlightedArticleIndex(null);
      return;
    }
    setHighlightedArticleIndex(articleIndex);
    setArticleFilter("all");
    setArticleQuery("");
  };
  const openArticle = (article: Article) => {
    requestCrossref(article);
    setArticleDetail(article);
  };
  const visibleArticles = articles.filter((article) => (articleFilter === "all" || articleScope(article) === articleFilter) && `${article.title} ${article.pmid} ${article.doi}`.toLowerCase().includes(articleQuery.toLowerCase()));
  const coreCount = articles.filter((article) => articleScope(article) === "core").length;
  const backgroundCount = articles.filter((article) => articleScope(article) === "background").length;
  const excludedCount = articles.filter((article) => articleScope(article) === "exclude").length;
  const pendingCount = articles.filter((article) => articleScope(article) === "pending").length;
  const screenedCount = articles.filter((article) => article.state !== "pending").length;
  const articleTabs = [
    { value: "all", label: "Tài liệu", count: articles.length },
    { value: "core", label: "Core", count: coreCount },
    { value: "background", label: "Background", count: backgroundCount },
    { value: "exclude", label: "Loại trừ", count: excludedCount },
    { value: "pending", label: "Chờ xử lý", count: pendingCount },
  ];
  const verificationRan = review.state === "gap_verification_complete"
    || Boolean(review.gapVerification?.searched_sources?.length)
    || progress.some((message) => /counter-search|gap_verification:.*records/i.test(message));
  const verificationSkipped = !running && terminalStates.has(review.state) && !verificationRan;
  const verificationSkipReason = verificationReasonLabel(review.gapVerification?.reason, review.qualityGate?.candidate_gap_count ?? 0);
  const flowStatus = review.state === "insufficient_evidence" ? "Thiếu bằng chứng" : running ? `Bước ${stage + 1} / ${stages.length}` : review.state === "failed" ? "Có lỗi" : terminalStates.has(review.state) ? review.state === "gap_verification_complete" ? "Đã xác minh khoảng trống" : "Đã lập bản đồ" : "Đã dừng";

  return <div className="run-monitor">
    <section className="run-control-bar" aria-label="Tình trạng lần chạy">
      <div className="run-control-overview" aria-label="Chỉ số sử dụng">
        <button type="button" className={`run-control-status ${running ? "running" : ""}`} onClick={() => setDetail(review.error ? { type: "error", message: review.error } : { type: "all" })}><Activity size={15} /><span>{running ? "Đang thực hiện" : review.state === "insufficient_evidence" ? "Thiếu bằng chứng" : review.state === "gap_verification_complete" ? "Đã xác minh khoảng trống" : terminalStates.has(review.state) ? "Đã lập bản đồ" : review.state === "failed" ? "Có lỗi" : "Đã dừng"}</span><ChevronRight size={13} /></button>
        <span className="run-control-metric" title={usage ? `${number.format(usage.input)} token vào · ${number.format(usage.output)} token ra` : "Chưa có dữ liệu token"}><Zap size={15} /><strong className="rw-count-up">{usage ? number.format(totalTokens) : "—"}</strong><span>Token</span></span>
        <span className="run-control-metric"><Cpu size={15} /><strong className="rw-count-up">{usage ? number.format(modelCalls) : "—"}</strong><span>Lượt gọi</span></span>
        <span className="run-control-metric"><Users size={15} /><strong>{review.parallelLimit ?? review.keyCount ?? "—"}</strong><span>Agent</span></span>
      </div>
      <button type="button" className="run-control-keys" onClick={() => setKeyDetail(true)} aria-haspopup="dialog" aria-label={`Xem chi tiết ${keys.length} khóa API`}>
        <strong>Khóa API</strong>
        <span className="run-key-summary">
          <span className="run-key-summary-track" aria-hidden="true">{visibleKeys.map((key) => <i key={key.id} className={`run-key-tone-${keys.indexOf(key) % 4} ${key.state} ${key.active ? "active" : ""}`} style={{ flexGrow: key.requests }} />)}{hiddenRequests > 0 && <i className="run-key-summary-other" style={{ flexGrow: hiddenRequests }} />}</span>
          <span className="run-key-summary-top">{visibleKeys.length ? <>{visibleKeys.map((key) => <span className={`run-key-tone-${keys.indexOf(key) % 4} ${key.state}`} key={key.id}><i />{key.id} <b>{keyRequests ? Math.round(key.requests / keyRequests * 100) : 0}%</b></span>)}{hiddenKeys.length > 0 && <span className="run-key-summary-more"><i />+{hiddenKeys.length}</span>}</> : <span className="run-key-summary-empty">Chưa có key được nạp</span>}</span>
        </span>
        <ChevronRight size={14} aria-hidden="true" />
      </button>
    </section>

    <section className="run-flow" aria-label="Quy trình thực hiện">
      <div className="run-flow-heading"><span>Các bước thực hiện</span><small>{flowStatus}{runtime !== null && <span className={`run-flow-runtime${running ? " active" : ""}`}><Clock3 aria-hidden="true" />{runtime}</span>}</small></div>
      <div className="run-flow-steps">{stages.map((item, index) => {
        const doneThrough = review.state === "gap_verification_complete" || review.state === "synthesis_complete" || (review.state === "completed" && verificationRan) ? 8
          : review.state === "candidate_gaps_found" || review.state === "mapping_complete" || review.state === "insufficient_evidence" || (review.state === "completed" && !verificationRan) ? 7 : -1;
        const state = index === 8 && verificationSkipped ? "skipped" : index <= doneThrough || index < stage ? "done" : index === stage && review.state === "failed" ? "failed" : index === stage && running ? "active" : "waiting";
        const Icon = item.icon;
        const noCandidateGaps = verificationSkipped && (review.qualityGate?.candidate_gap_count ?? 0) === 0;
        const caption = index === 7 && noCandidateGaps ? "Không tìm thấy"
          : index === 8 && verificationSkipped ? "Không thực hiện"
          : state === "done" ? "Hoàn thành" : state === "failed" ? "Có lỗi"
          : state === "active" && index === 2 && articles.length ? `${number.format(screenedCount)} / ${number.format(articles.length)} đã sàng lọc`
          : state === "active" ? "Đang thực hiện" : "Chờ";
        return <button type="button" key={item.title} className={`run-flow-step ${state}`} onClick={() => setDetail({ type: "stage", index })} aria-current={state === "active" ? "step" : undefined} aria-label={`Xem bước ${index + 1}: ${item.title}. ${caption}`}><span className="run-flow-mark">{state === "done" ? <Check size={16} /> : <Icon size={16} />}</span><span className="run-flow-copy"><strong>{item.title}</strong><small>{caption}</small></span></button>;
      })}</div>
    </section>

    <div className="run-monitor-content">
      <section className="run-timeline-panel" aria-label="Nhật ký thực thi"><div className="run-timeline-heading"><div><strong>Nhật ký trực tiếp</strong><span>{progress.length} sự kiện</span></div><button type="button" onClick={() => setDetail({ type: "all" })}>Xem tất cả <ArrowRight size={14} /></button></div>
        <div className="run-timeline-list" ref={logRef} role="log" aria-live="polite" aria-relevant="additions" onScroll={(event) => { const node = event.currentTarget; const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight; if (distanceFromBottom <= 30) setFollowLog(true); else if (node.scrollTop < lastLogScrollTop.current - 2) setFollowLog(false); lastLogScrollTop.current = node.scrollTop; }}>
          {progress.length ? progress.map((message, position) => {
            const index = position + 1;
            const articleIndex = articleForLog(message, articles);
            return <button type="button" className={`run-timeline-event ${index === progress.length ? "newest" : ""} ${/fail|error|429|quota|exception/i.test(message) ? "error" : ""} ${articleIndex >= 0 && articleIndex === highlightedArticleIndex ? "linked" : ""}`} key={`${index}-${message}`} onClick={() => openLogEntry(message, index)} aria-label={`Đọc chi tiết sự kiện ${index}: ${message}`}><span className="run-timeline-index">{String(index).padStart(2, "0")}</span><span className="run-timeline-dot" /><span className="run-timeline-message"><strong>{message}</strong></span></button>;
          }) : <p className="run-paper-empty">{progress.length ? "Không có sự kiện phù hợp." : "Đang đợi sự kiện đầu tiên..."}</p>}
        </div><div className="run-timeline-footer"><span><Circle size={7} />{running ? "Đang theo dõi" : terminalStates.has(review.state) ? "Nhật ký đã lưu" : "Nhật ký đã dừng"}</span><button type="button" onClick={() => { setFollowLog(true); if (logRef.current) { logRef.current.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }); lastLogScrollTop.current = logRef.current.scrollHeight; } }}>{followLog ? "Mới nhất" : "Theo dõi mới"}</button><button type="button" onClick={onOpenGeminiLog}>Gemini I/O</button><button type="button" onClick={onOpenLog}>runner.log</button></div>
      </section>

      <section className="run-paper-panel" aria-label="Danh sách tài liệu tìm thấy">
        <div className="run-paper-toolbar"><div className="run-paper-tabs" role="tablist" aria-label="Lọc tài liệu">{articleTabs.map((tab) => <button type="button" role="tab" aria-selected={articleFilter === tab.value} className={`${tab.value} ${articleFilter === tab.value ? "active" : ""}`} key={tab.value} onClick={() => setArticleFilter(tab.value)}>{tab.label} <span>{tab.count}</span></button>)}</div><label className="run-paper-search"><Search size={16} /><input type="search" value={articleQuery} onChange={(event) => setArticleQuery(event.target.value)} placeholder="Tìm tiêu đề, PMID, DOI..." aria-label="Tìm tài liệu" /></label></div>
        <div className="run-paper-table-head"><span>#</span><span>Tiêu đề & nguồn</span><span>Năm</span><span>Trạng thái</span><span /></div>
        <div className="run-paper-list">{visibleArticles.length ? visibleArticles.map((article) => {
          const articleIndex = articles.indexOf(article);
          const scope = articleScope(article);
          return <button type="button" className={`run-paper-row ${articleIndex === highlightedArticleIndex ? "linked" : ""}`} key={article.pmid || article.doi || article.title} ref={(node) => { if (node) articleRefs.current.set(articleIndex, node); else articleRefs.current.delete(articleIndex); }} onClick={() => openArticle(article)}><span className="run-paper-number">{articleIndex + 1}</span><span className="run-paper-title"><strong>{article.title || article.pmid}</strong><small>{[article.source, article.text_status?.replaceAll("_", " "), article.pmid && `PMID: ${article.pmid}`, article.doi && `DOI: ${article.doi}`].filter(Boolean).join(" · ")}</small></span><span className="run-paper-year">{article.year || "—"}</span><span className={`run-paper-state ${scope}`}><i />{scope === "core" ? "Core" : scope === "background" ? "Background" : scope === "exclude" ? "Loại trừ" : "Chờ xử lý"}</span><ChevronRight size={16} /></button>;
        }) : <div className="run-paper-empty">{articles.length ? "Không có tài liệu phù hợp bộ lọc." : "Danh sách tài liệu sẽ xuất hiện sau khi tìm kiếm và gộp kết quả."}</div>}</div>
      </section>
    </div>

    {detail && <div className="run-log-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetail(null); }}><section className="run-log-detail" role="dialog" aria-modal="true" aria-label="Chi tiết nhật ký"><ModalEscape onClose={() => setDetail(null)} /><header><div><span className="run-eyebrow">NHẬT KÝ THỰC THI</span><h2>{detail.type === "all" ? `Toàn bộ ${progress.length} sự kiện` : detail.type === "stage" ? stages[detail.index].title : detail.type === "error" ? "Chi tiết lỗi" : `Sự kiện ${detail.number}`}</h2></div><button type="button" onClick={() => setDetail(null)} aria-label="Đóng"><X size={17} /></button></header><div className="run-log-detail-body">{detail.type === "all" ? progress.map((message, index) => <article key={`${index}-${message}`}><span>{String(index + 1).padStart(2, "0")}</span><p>{message}</p></article>) : detail.type === "stage" ? <><p>{stages[detail.index].detail}</p>{detail.index === 8 && verificationSkipped && <p className="run-log-full-message"><strong>Không thực hiện.</strong> {verificationSkipReason}</p>}{progress.filter((message) => stages[detail.index].match.test(message)).map((message, index) => <article key={`${index}-${message}`}><span>{String(index + 1).padStart(2, "0")}</span><p>{message}</p></article>)}{!progress.some((message) => stages[detail.index].match.test(message)) && !(detail.index === 8 && verificationSkipped) && <p>Chưa có sự kiện cho bước này.</p>}</> : <p className="run-log-full-message">{detail.message}</p>}</div></section></div>}
    {keyDetail && <div className="run-log-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setKeyDetail(false); }}><section className="run-log-detail run-key-detail" role="dialog" aria-modal="true" aria-label="Chi tiết khóa API"><ModalEscape onClose={() => setKeyDetail(false)} /><header><div><span className="run-eyebrow">SỬ DỤNG KHÓA API</span><h2>{keys.length} key trong pool</h2></div><button type="button" onClick={() => setKeyDetail(false)} aria-label="Đóng"><X size={17} /></button></header><div className="run-log-detail-body"><p className="run-key-detail-note">Tỷ lệ thể hiện phần lượt gọi của mỗi key trong lần chạy này, không phải quota Google.</p>{keys.length ? <div className="run-key-detail-list">{keys.map((key) => { const share = keyRequests ? Math.round(key.requests / keyRequests * 100) : 0; return <div className="run-key-detail-row" key={key.id}><div className="run-key-detail-heading"><strong>{key.id}</strong><span className={`run-key-detail-state ${key.state} ${key.active ? "active" : ""}`}>{keyStateLabel(key)}</span></div><div className="run-key-detail-metrics"><span>{number.format(key.requests)} lượt gọi</span><span>{number.format(key.tokens)} token</span><strong>{share}%</strong></div><div className="run-key-detail-track"><i className={`${key.state} ${key.active ? "active" : ""}`} style={{ width: `${share}%` }} /></div></div>; })}</div> : <p>Chưa có dữ liệu key.</p>}</div></section></div>}
    {articleDetail && <ArticleDetailDialog article={articleDetail} result={crossrefResult} onClose={() => setArticleDetail(null)} />}
  </div>;
}
