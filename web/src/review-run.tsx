import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Activity, ArrowRight, Check, ChevronRight, Circle, Clock3, Cpu, FileCheck2, FolderSearch, Layers3, Search, Sparkles, Users, X, Zap } from "lucide-react";
import { ModalEscape } from "./modal-escape";
import { useCountUp } from "./use-count-up";

type Article = { pmid: string; title: string; abstract?: string; year?: string; source?: string; doi?: string; state: string; reason?: string; stage?: string };
type KeyUsage = { id: string; state: string; active: boolean; requests: number; tokens: number };
type RunReview = {
  title: string;
  state: "running" | "failed" | "cancelled" | "interrupted" | "completed" | "mapping_complete" | "insufficient_evidence";
  progress: string[];
  error: string | null;
  updatedAt: number | string;
  parallelLimit?: number;
  pipelineStatus?: string;
  qualityGate?: { included_papers: number; full_text_available: number; studies_with_grounded_evidence: number; basic_evidence_coverage: number; deep_evidence_coverage: number; evidence_coverage: number };
  keyUsage?: KeyUsage[];
  keyCount?: number;
  tokenUsage?: { input: number; output: number; total: number; requests: number };
  articles?: Article[];
};
type Detail = { type: "all" } | { type: "entry"; message: string; number: number } | { type: "stage"; index: number } | { type: "error"; message: string };

const stages = [
  { title: "Chiến lược tìm kiếm", detail: "Tách chủ đề thành khái niệm và truy vấn theo nguồn", icon: Sparkles, match: /Searching Computer Science|searching/i },
  { title: "Tìm và gộp tài liệu", detail: "Tìm trên arXiv, Semantic Scholar, OpenAlex, Crossref và CORE", icon: FolderSearch, match: /records|Search complete/i },
  { title: "Sàng lọc", detail: "Đánh giá từng khái niệm từ tiêu đề và abstract", icon: Layers3, match: /Screened|screening/i },
  { title: "Lấy abstract và toàn văn", detail: "Bổ sung abstract, sau đó tìm toàn văn hợp lệ", icon: Users, match: /Abstract (?:enriched|not found)|Full text/i },
  { title: "Trích bằng chứng", detail: "Lưu đoạn trích và vị trí trong văn bản gốc", icon: Activity, match: /Grounded spans/i },
  { title: "Quality gate", detail: "Đánh giá độ bao phủ và xuất kết quả", icon: FileCheck2, match: /Evidence gate/i },
];

function activeStage(progress: string[]): number {
  let current = 0;
  for (const message of progress) stages.forEach((item, index) => { if (item.match.test(message)) current = Math.max(current, index); });
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

export function ReviewRun({ review, runtime, onOpenLog }: { review: RunReview; runtime: string | null; onOpenLog: () => void }) {
  const running = review.state === "running";
  const progress = review.progress ?? [];
  const stage = activeStage(progress);
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
  const [keyDetail, setKeyDetail] = useState(false);
  const [articleQuery, setArticleQuery] = useState("");
  const [articleFilter, setArticleFilter] = useState("all");
  const [followLog, setFollowLog] = useState(true);
  const [highlightedArticleIndex, setHighlightedArticleIndex] = useState<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const lastLogScrollTop = useRef(0);
  const lastProgressLength = useRef(progress.length);
  const articleRefs = useRef(new Map<number, HTMLButtonElement>());
  const totalTokens = useCountUp(usage?.total ?? null);
  const modelCalls = useCountUp(usage?.requests ?? null);

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
  const visibleArticles = articles.filter((article) => (articleFilter === "all" || (articleFilter === "pending" ? article.state !== "include" && article.state !== "exclude" : article.state === articleFilter)) && `${article.title} ${article.pmid} ${article.doi}`.toLowerCase().includes(articleQuery.toLowerCase()));
  const includedCount = articles.filter((article) => article.state === "include").length;
  const excludedCount = articles.filter((article) => article.state === "exclude").length;
  const pendingCount = articles.length - includedCount - excludedCount;
  const screenedCount = articles.filter((article) => article.state !== "pending").length;
  const articleTabs = [
    { value: "all", label: "Tài liệu", count: articles.length },
    { value: "include", label: "Được chọn", count: includedCount },
    { value: "exclude", label: "Loại trừ", count: excludedCount },
    { value: "pending", label: "Chờ xử lý", count: pendingCount },
  ];
  const flowStatus = review.state === "insufficient_evidence" ? "" : running ? `Bước ${stage + 1} / ${stages.length}` : review.state === "failed" ? "Có lỗi" : review.state === "mapping_complete" || review.state === "completed" ? "Đã lập bản đồ" : "Đã dừng";

  return <div className="run-monitor">
    <section className="run-control-bar" aria-label="Tình trạng lần chạy">
      <div className="run-control-overview" aria-label="Chỉ số sử dụng">
        <button type="button" className={`run-control-status ${running ? "running" : ""}`} onClick={() => setDetail(review.error ? { type: "error", message: review.error } : { type: "all" })}><Activity size={15} /><span>{running ? "Đang thực hiện" : review.state === "insufficient_evidence" ? "Thiếu bằng chứng" : review.state === "mapping_complete" || review.state === "completed" ? "Đã lập bản đồ" : review.state === "failed" ? "Có lỗi" : "Đã dừng"}</span><ChevronRight size={13} /></button>
        <span className="run-control-metric" title={usage ? `${number.format(usage.input)} token vào · ${number.format(usage.output)} token ra` : "Chưa có dữ liệu token"}><Zap size={15} /><strong className="rw-count-up">{usage ? number.format(totalTokens) : "—"}</strong><span>Token</span></span>
        <span className="run-control-metric"><Cpu size={15} /><strong className="rw-count-up">{usage ? number.format(modelCalls) : "—"}</strong><span>Lượt gọi</span></span>
        <span className="run-control-metric"><Users size={15} /><strong>{review.parallelLimit ?? "—"}</strong><span>Agent</span></span>
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
        const state = (review.state === "completed" || review.state === "mapping_complete" || review.state === "insufficient_evidence") || index < stage ? "done" : index === stage && review.state === "failed" ? "failed" : index === stage && running ? "active" : "waiting";
        const Icon = item.icon;
        const caption = state === "done" ? "Hoàn thành" : state === "failed" ? "Có lỗi" : state === "active" && index === 2 && articles.length ? `${number.format(screenedCount)} / ${number.format(articles.length)} đã sàng lọc` : state === "active" ? "Đang thực hiện" : "Chờ";
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
        </div><div className="run-timeline-footer"><span><Circle size={7} />{running ? "Đang theo dõi" : review.state === "mapping_complete" || review.state === "insufficient_evidence" || review.state === "completed" ? "Nhật ký đã lưu" : "Nhật ký đã dừng"}</span><button type="button" onClick={() => { setFollowLog(true); if (logRef.current) { logRef.current.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }); lastLogScrollTop.current = logRef.current.scrollHeight; } }}>{followLog ? "Mới nhất" : "Theo dõi mới"}</button><button type="button" onClick={onOpenLog}>runner.log</button></div>
      </section>

      <section className="run-paper-panel" aria-label="Danh sách tài liệu tìm thấy">
        <div className="run-paper-toolbar"><div className="run-paper-tabs" role="tablist" aria-label="Lọc tài liệu">{articleTabs.map((tab) => <button type="button" role="tab" aria-selected={articleFilter === tab.value} className={`${tab.value} ${articleFilter === tab.value ? "active" : ""}`} key={tab.value} onClick={() => setArticleFilter(tab.value)}>{tab.label} <span>{tab.count}</span></button>)}</div><label className="run-paper-search"><Search size={16} /><input type="search" value={articleQuery} onChange={(event) => setArticleQuery(event.target.value)} placeholder="Tìm tiêu đề, PMID, DOI..." aria-label="Tìm tài liệu" /></label></div>
        <div className="run-paper-table-head"><span>#</span><span>Tiêu đề & nguồn</span><span>Năm</span><span>Trạng thái</span><span /></div>
        <div className="run-paper-list">{visibleArticles.length ? visibleArticles.map((article) => {
          const articleIndex = articles.indexOf(article);
          return <button type="button" className={`run-paper-row ${articleIndex === highlightedArticleIndex ? "linked" : ""}`} key={article.pmid} ref={(node) => { if (node) articleRefs.current.set(articleIndex, node); else articleRefs.current.delete(articleIndex); }} onClick={() => setArticleDetail(article)}><span className="run-paper-number">{articleIndex + 1}</span><span className="run-paper-title"><strong>{article.title || article.pmid}</strong><small>{[article.source, article.pmid && `PMID: ${article.pmid}`, article.doi && `DOI: ${article.doi}`].filter(Boolean).join(" · ")}</small></span><span className="run-paper-year">{article.year || "—"}</span><span className={`run-paper-state ${article.state}`}><i />{article.state === "include" ? "Được chọn" : article.state === "exclude" ? "Loại trừ" : "Chờ xử lý"}</span><ChevronRight size={16} /></button>;
        }) : <div className="run-paper-empty">{articles.length ? "Không có tài liệu phù hợp bộ lọc." : "Danh sách tài liệu sẽ xuất hiện sau khi tìm kiếm và gộp kết quả."}</div>}</div>
      </section>
    </div>

    {detail && <div className="run-log-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetail(null); }}><section className="run-log-detail" role="dialog" aria-modal="true" aria-label="Chi tiết nhật ký"><ModalEscape onClose={() => setDetail(null)} /><header><div><span className="run-eyebrow">NHẬT KÝ THỰC THI</span><h2>{detail.type === "all" ? `Toàn bộ ${progress.length} sự kiện` : detail.type === "stage" ? stages[detail.index].title : detail.type === "error" ? "Chi tiết lỗi" : `Sự kiện ${detail.number}`}</h2></div><button type="button" onClick={() => setDetail(null)} aria-label="Đóng"><X size={17} /></button></header><div className="run-log-detail-body">{detail.type === "all" ? progress.map((message, index) => <article key={`${index}-${message}`}><span>{String(index + 1).padStart(2, "0")}</span><p>{message}</p></article>) : detail.type === "stage" ? <><p>{stages[detail.index].detail}</p>{progress.filter((message) => stages[detail.index].match.test(message)).map((message, index) => <article key={`${index}-${message}`}><span>{String(index + 1).padStart(2, "0")}</span><p>{message}</p></article>)}{!progress.some((message) => stages[detail.index].match.test(message)) && <p>Chưa có sự kiện cho bước này.</p>}</> : <p className="run-log-full-message">{detail.message}</p>}</div></section></div>}
    {keyDetail && <div className="run-log-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setKeyDetail(false); }}><section className="run-log-detail run-key-detail" role="dialog" aria-modal="true" aria-label="Chi tiết khóa API"><ModalEscape onClose={() => setKeyDetail(false)} /><header><div><span className="run-eyebrow">SỬ DỤNG KHÓA API</span><h2>{keys.length} key trong pool</h2></div><button type="button" onClick={() => setKeyDetail(false)} aria-label="Đóng"><X size={17} /></button></header><div className="run-log-detail-body"><p className="run-key-detail-note">Tỷ lệ thể hiện phần lượt gọi của mỗi key trong lần chạy này, không phải quota Google.</p>{keys.length ? <div className="run-key-detail-list">{keys.map((key) => { const share = keyRequests ? Math.round(key.requests / keyRequests * 100) : 0; return <div className="run-key-detail-row" key={key.id}><div className="run-key-detail-heading"><strong>{key.id}</strong><span className={`run-key-detail-state ${key.state} ${key.active ? "active" : ""}`}>{keyStateLabel(key)}</span></div><div className="run-key-detail-metrics"><span>{number.format(key.requests)} lượt gọi</span><span>{number.format(key.tokens)} token</span><strong>{share}%</strong></div><div className="run-key-detail-track"><i className={`${key.state} ${key.active ? "active" : ""}`} style={{ width: `${share}%` }} /></div></div>; })}</div> : <p>Chưa có dữ liệu key.</p>}</div></section></div>}
    {articleDetail && <div className="run-log-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setArticleDetail(null); }}><section className="run-log-detail rw-article-detail" role="dialog" aria-modal="true" aria-label="Chi tiết tài liệu"><ModalEscape onClose={() => setArticleDetail(null)} /><header><div><span className="run-eyebrow">{articleDetail.state === "include" ? "ĐƯỢC CHỌN" : articleDetail.state === "exclude" ? "LOẠI TRỪ" : "CHỜ XỬ LÝ"}</span><h2>{articleDetail.title || articleDetail.pmid}</h2></div><button type="button" onClick={() => setArticleDetail(null)} aria-label="Đóng"><X size={17} /></button></header><div className="run-log-detail-body"><p><strong>PMID:</strong> {articleDetail.pmid}</p><p><strong>Nguồn:</strong> {articleDetail.source || "—"} · <strong>Năm:</strong> {articleDetail.year || "—"}</p>{articleDetail.doi && <p><strong>DOI:</strong> {articleDetail.doi}</p>}{articleDetail.reason && <p><strong>Lý do:</strong> {articleDetail.reason}</p>}<h3>Tóm tắt</h3><p>{articleDetail.abstract || "Chưa có tóm tắt."}</p></div></section></div>}
  </div>;
}
