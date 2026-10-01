import { Fragment } from "react";
import { CircleMinus } from "lucide-react";
import type { ReviewData, ReviewView } from "./review-output";

type Row = Record<string, unknown>;
const obj = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const list = (value: unknown): Row[] => Array.isArray(value) ? value.map(obj) : [];
const str = (value: unknown): string => typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
const ids = (value: unknown): string[] => Array.isArray(value) ? value.map(str).filter(Boolean) : [];
const percent = (value: unknown): string => `${Math.round(Number(value || 0) * 100)}%`;
const label = (value: unknown): string => str(value).replaceAll("_", " ");
const sourceLevel = (span?: Row): string => str(span?.source_level) || "full_text";
const sourceStrength = (span?: Row): string => str(span?.confidence) || str(span?.evidence_strength) || "không xác định";
const scopeLabel = (value: unknown): string => value === "core" ? "Core" : value === "background" ? "Background" : value === "exclude" ? "Loại trừ" : label(value);
const gapStatus = (value: unknown): string => ({
  candidate: "Ứng viên", abstract_supported: "Có hỗ trợ từ abstract", fulltext_supported: "Có hỗ trợ toàn văn",
  challenged: "Bị thách thức", verified_within_search_scope: "Đã xác minh trong phạm vi tìm kiếm", rejected: "Đã bác bỏ",
  verified: "Đã xác minh trong phạm vi tìm kiếm", candidate_gap: "Ứng viên khoảng trống",
  verified_gap: "Khoảng trống đã xác minh", already_addressed: "Đã được giải quyết",
  no_counterevidence_found: "Chưa tìm thấy bằng chứng phản bác trong phạm vi truy vấn",
  partially_addressed: "Đã được giải quyết một phần", emerging: "Đang hình thành", sparse: "Thưa",
  underexplored: "Ít được khám phá", inconclusive: "Chưa đủ bằng chứng",
}[str(value)] ?? (label(value) || "Chưa xác định"));

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rv-empty">{children}</div>;
}

function Metrics({ rows }: { rows: Array<[string, unknown]> }) {
  return <div className="rv-funnel">{rows.map(([name, value]) => <div className="rv-funnel-step" key={name}><strong>{String(value ?? "—")}</strong><span>{name}</span></div>)}</div>;
}

export function CSReviewOutput({ view, data, onView, onOpenFolder, onAdjudicate, adjudicationBusy }: {
  view: ReviewView; data: ReviewData; onView: (view: ReviewView) => void; onOpenFolder: () => void;
  onAdjudicate?: (articleId: string, decision: "include" | "exclude") => void; adjudicationBusy?: boolean;
}) {
  const quality = obj(data.quality_metrics ?? data.quality_gate);
  const reviewQuality = obj(data.review_quality);
  const articles = list(data.articles);
  const spans = list(data.evidence_spans);
  const claims = list(data.paper_claims).length ? list(data.paper_claims) : list(data.atomic_claims);
  const crossClaims = list(data.cross_paper_claims);
  const profiles = list(data.study_profiles);
  const matrix = list(data.evidence_matrix);
  const screening = list(data.screening_results).length ? list(data.screening_results) : list(data.screening_decisions);
  const provenance = list(data.search_provenance);
  const candidateGaps = list(data.candidate_gaps);
  const verifiedGaps = list(data.bounded_gap_findings).length ? list(data.bounded_gap_findings) : list(data.verified_gaps);
  const gaps = list(data.research_gaps).length ? list(data.research_gaps) : [...candidateGaps, ...verifiedGaps];
  const directions = list(data.research_directions);
  const sparseAreas = list(data.emerging_sparse_areas);
  const areaGroups: Array<{ title: string; description: string; rows: Row[] }> = [
    { title: "Đang hình thành", description: "Hướng mới xuất hiện trong tập bài đã nhận diện", rows: sparseAreas.filter((area) => area.maturity === "emerging") },
    { title: "Bằng chứng thưa", description: "Hướng có ít nghiên cứu trực tiếp trong tập core", rows: sparseAreas.filter((area) => area.maturity === "sparse") },
  ];
  const otherAreas = sparseAreas.filter((area) => area.maturity !== "emerging" && area.maturity !== "sparse");
  if (otherAreas.length) areaGroups.push({ title: "Chưa phân loại", description: "Chưa có nhãn độ trưởng thành rõ ràng", rows: otherAreas });
  const intersections = list(data.underexplored_intersections);
  const matrixDimensions = Object.keys(obj(matrix[0]?.dimensions));
  const articleById = new Map(articles.map((article) => [str(article.id), article]));
  const evidenceById = new Map(spans.map((span) => [str(span.id), span]));
  const paperClaimsByArticle = new Map<string, { articleId: string; rows: Row[] }>();
  claims.forEach((claim, index) => {
    const evidenceId = ids(claim.supporting_evidence_ids)[0];
    const articleId = str(claim.article_id) || ids(claim.supporting_studies)[0] || str(evidenceById.get(evidenceId)?.article_id);
    const groupKey = articleId || `unknown-${index}`;
    if (!paperClaimsByArticle.has(groupKey)) paperClaimsByArticle.set(groupKey, { articleId, rows: [] });
    paperClaimsByArticle.get(groupKey)?.rows.push(claim);
  });
  const core = articles.filter((article) => article.scope === "core" || (!article.scope && article.screening_decision === "include"));
  const background = articles.filter((article) => article.scope === "background");
  const excluded = articles.filter((article) => article.scope === "exclude" || (!article.scope && article.screening_decision === "exclude"));
  const spansByArticle = new Map<string, Row[]>();
  spans.forEach((span) => {
    const articleId = str(span.article_id);
    spansByArticle.set(articleId, [...(spansByArticle.get(articleId) ?? []), span]);
  });

  if (view === "overview") return <div className="rv-stack rv-overview">
    <section className="rv-hero"><span className="rv-eyebrow">COMPUTER SCIENCE LITERATURE INTELLIGENCE</span><h2>{str(obj(data.query_understanding).topic) || "Chủ đề chưa được ghi nhận"}</h2><p>Trạng thái: <strong>{label(data.pipeline_status)}</strong>. Mọi kết luận khoa học đều phải truy ngược được về EvidenceSpan và bài báo nguồn.</p></section>
    <section className="rv-panel"><h2>Phạm vi tài liệu</h2><Metrics rows={[["Kết quả tìm kiếm", quality.search_result_count ?? articles.length], ["Sau khử trùng lặp", quality.deduplicated_count ?? articles.length], ["Core", quality.core_study_count ?? core.length], ["Background", quality.background_study_count ?? background.length], ["Loại trừ", quality.excluded_count ?? excluded.length]]} /><p>Chỉ các nghiên cứu <strong>core</strong> được dùng cho thống kê khoảng trống nghiên cứu. Background cần được xử lý hoặc xem trong sensitivity analysis trước khi coi synthesis là đầy đủ.</p></section>
    <section className="rv-panel"><h2>Giới hạn review</h2><p>Tìm kiếm: {label(reviewQuality.search_completeness) || "chưa đánh giá"} · Sàng lọc: {label(reviewQuality.screening_completeness) || "chưa đánh giá"} · Tổng thể: {label(reviewQuality.overall) || "chưa đánh giá"}. {ids(reviewQuality.needs_adjudication_ids).length} bài cần adjudication.</p></section>
    <section className="rv-panel"><h2>Độ phủ bằng chứng</h2><Metrics rows={[["Basic coverage", percent(quality.basic_evidence_coverage)], ["Deep coverage", percent(quality.deep_evidence_coverage)], ["Study profile", percent(quality.study_profile_coverage)], ["Độ đầy đủ profile", percent(quality.profile_completeness)], ["EvidenceSpan", quality.grounded_evidence_spans ?? spans.length]]} /><p>{Boolean(quality.passed) ? "Đủ điều kiện lập bản đồ bằng chứng theo ngưỡng hiện tại." : "Chưa đủ bằng chứng để tạo tổng hợp liên bài có độ tin cậy cao; dữ liệu tìm kiếm và sàng lọc vẫn được giữ lại."}</p></section>
    <section className="rv-panel"><h2>Hướng nghiên cứu</h2>{directions.length ? <div className="rw-review-facts">{directions.map((direction) => <div key={str(direction.id)}><strong>{str(direction.name)}</strong><span>{str(direction.maturity)} · {String(direction.identified_study_count ?? 0)} bài · {percent(direction.coverage)} deep-review coverage</span></div>)}</div> : <Empty>Chưa có hướng nghiên cứu nào đủ bằng chứng để phân loại.</Empty>}<p>Coverage của mỗi hướng = số nghiên cứu liên quan đã deep-review / số nghiên cứu liên quan đã nhận diện.</p></section>
    <section className="rv-panel"><h2>Kết quả phân tích</h2><Metrics rows={[["Paper claims", quality.paper_claim_count ?? claims.length], ["Cross-paper claims", quality.cross_paper_claim_count ?? crossClaims.length], ["Ứng viên khoảng trống", quality.candidate_gap_count ?? candidateGaps.length], ["Không thấy phản chứng trong phạm vi tìm kiếm", verifiedGaps.length]]} /><button className="rv-link" type="button" onClick={() => onView("evidence")}>Mở ma trận bằng chứng →</button></section>
  </div>;

  if (view === "findings") return <div className="rv-stack">
    <div className="rv-view-intro"><span className="rv-eyebrow">CLAIM → EVIDENCE → ARTICLE</span><h2>Khẳng định có căn cứ</h2><p>Mỗi loại khẳng định dùng yêu cầu bằng chứng phù hợp: một bài cho quan sát cấp bài, nhiều bài cho kết quả lặp lại, và bằng chứng rộng cho xu hướng.</p></div>
    <section className="rv-panel rv-claim-list rv-paper-claim-list"><h2>Khẳng định cấp bài báo</h2>{claims.length ? Array.from(paperClaimsByArticle, ([groupKey, group]) => <article className="rv-article-claims" key={groupKey}>
      <header><div><span>Bài báo nguồn</span><h3>{str(articleById.get(group.articleId)?.title) || group.articleId || "Không rõ bài báo nguồn"}</h3></div><span className="rv-article-claim-count">{group.rows.length} khẳng định</span></header>
      <ol>{group.rows.map((claim, index) => {
        const evidenceIds = ids(claim.supporting_evidence_ids);
        const span = evidenceById.get(evidenceIds[0]);
        return <li key={str(claim.claim_id) || str(claim.id) || index}><div className="rv-article-claim-meta"><span className="rv-evidence-type">{label(claim.claim_type)}</span><span className="rv-source-level">{sourceLevel(span)} · {sourceStrength(span)}</span><code>{str(claim.claim_id) || str(claim.id)}</code></div><p>{str(claim.statement)}</p>{evidenceIds.length > 0 && <div className="rv-article-claim-evidence"><span>Bằng chứng</span><code>{evidenceIds.join(", ")}</code></div>}</li>;
      })}</ol>
    </article>) : <Empty>Không có paper claim nào có EvidenceSpan hợp lệ.</Empty>}</section>
    <section className="rv-panel rv-claim-list"><h2>Khẳng định liên bài</h2>{crossClaims.length ? crossClaims.map((claim) => <article className="rv-evidence-span" key={str(claim.id)}><header><span className="rv-evidence-type">{label(claim.claim_type)}</span><span className="rv-source-level">{str(claim.confidence)}</span><code>{str(claim.id)}</code></header><blockquote>{str(claim.statement)}</blockquote><footer><span>Hỗ trợ / phản chứng</span><strong>{ids(claim.supporting_article_ids).join(", ")} / {ids(claim.contradicting_article_ids).join(", ") || "không có"}</strong></footer><p>Hỗ trợ: {String(claim.support_count ?? ids(claim.supporting_article_ids).length)} · Toàn văn: {String(claim.deep_support_count ?? "—")} · Báo cáo đủ ≥4 chỉ dấu: {String(claim.well_reported_support_count ?? "—")} · Phản bác tường minh: {String(claim.contradicting_count ?? "—")}</p>{ids(claim.qualifying_evidence_ids).length > 0 && <p>Evidence ID giới hạn điều kiện: {ids(claim.qualifying_evidence_ids).join(", ")}</p>}</article>) : <Empty>Chưa có pattern nào đạt ngưỡng hỗ trợ từ nhiều nghiên cứu core.</Empty>}</section>
    <section className="rv-panel rv-area-panel"><div className="rv-section-head"><div><span className="rv-eyebrow">LANDSCAPE SIGNALS</span><h2>Bản đồ tín hiệu nghiên cứu</h2><p>Số bài ít là tín hiệu cần xem xét, chưa đủ để kết luận có khoảng trống nghiên cứu.</p></div></div>{sparseAreas.length ? <div className="rv-area-groups">{areaGroups.map((group) => <section className="rv-area-group" key={group.title}><header><div><h3>{group.title}</h3><p>{group.description}</p></div><strong aria-label={`${group.rows.length} hướng`}>{group.rows.length}</strong></header>{group.rows.length ? <ol>{group.rows.map((area) => <li key={str(area.id)}><span className="rv-area-name">{str(area.name)}</span><span className="rv-area-meta">{String(area.identified_study_count ?? 0)} bài · {String(area.deep_reviewed_study_count ?? 0)} đọc sâu</span></li>)}</ol> : <p className="rv-area-empty">Chưa có hướng nào trong nhóm này.</p>}</section>)}</div> : <Empty>Không có hướng nào hiện được phân loại là mới nổi hoặc thưa.</Empty>}</section>
  </div>;

  if (view === "gaps") return <div className="rv-stack">
    <div className="rv-view-intro"><span className="rv-eyebrow">MATRIX → CANDIDATE → COUNTER-SEARCH</span><h2>Khoảng trống nghiên cứu</h2><p>Kết quả counter-search chỉ có giá trị trong phạm vi provider, truy vấn và thời điểm đã ghi. Không tìm thấy phản chứng không chứng minh rằng nghiên cứu không tồn tại.</p></div>
    <section className="rv-panel"><h2>Giao điểm ít được khám phá</h2>{intersections.length ? intersections.map((area) => <p key={str(area.id)}><strong>{str(area.claim)}</strong> · coverage {percent(area.coverage)} · {str(area.confidence)} confidence</p>) : <Empty>Không có giao điểm nào đạt quy tắc bằng chứng có phạm vi hiện tại.</Empty>}</section>
    {gaps.length ? gaps.map((gap) => <article className="rv-panel" key={str(gap.id)}><span className="rv-eyebrow">{gapStatus(gap.status ?? gap.verification_status)} · {label(gap.category ?? gap.gap_type)}</span><h3>{str(gap.statement)}</h3><dl className="rv-facts"><dt>Nghiên cứu hỗ trợ</dt><dd>{ids(gap.supporting_article_ids).join(", ") || ids(gap.affected_studies).join(", ") || "Chưa có"}</dd><dt>EvidenceSpan hỗ trợ</dt><dd>{ids(gap.supporting_evidence_ids).join(", ") || "Chưa có"}</dd><dt>Bằng chứng phản bác</dt><dd>{ids(gap.counter_evidence_ids).join(", ") || "Chưa tìm thấy"}</dd><dt>Basic coverage cục bộ</dt><dd>{percent(gap.gap_basic_coverage)}</dd><dt>Deep coverage cục bộ</dt><dd>{percent(gap.gap_deep_coverage)}</dd><dt>Chiều còn thiếu</dt><dd>{label(gap.missing_dimension) || "Chưa xác định"}</dd><dt>Câu hỏi nghiên cứu đề xuất</dt><dd>{str(gap.proposed_research_question) || "Chưa đề xuất"}</dd><dt>Độ tin cậy</dt><dd>{str(gap.confidence) || "Chưa đánh giá"}</dd></dl><p>Phản tìm kiếm: {list(gap.counter_queries).map((row) => `${str(row.provider)}: ${str(row.query)}`).join(" · ") || "chưa chạy"}</p></article>) : <Empty>Không có khoảng trống nào đủ bằng chứng cấu trúc để báo cáo.</Empty>}
    {!verifiedGaps.length && <section className="rv-panel"><h2>Counter-search</h2><p>Chưa có candidate nào hoàn tất counter-search mà không thấy phản chứng.</p></section>}
  </div>;

  if (view === "evidence") return <div className="rv-stack">
    <div className="rv-view-intro"><span className="rv-eyebrow">CORE STUDIES ONLY</span><h2>Ma trận bằng chứng</h2><p><CircleMinus size={13} aria-hidden="true" /> UNKNOWN nghĩa là nguồn hiện có không cung cấp thông tin; tuyệt đối không được diễn giải thành NO.</p></div>
    {matrix.length ? <section className="rv-panel rv-evidence-matrix-scroll"><table className="rv-evidence-matrix"><colgroup><col className="rv-evidence-study-col" />{matrixDimensions.map((dimension) => <col key={dimension} className="rv-evidence-dimension-col" />)}</colgroup><thead><tr><th scope="col">Nghiên cứu core</th>{matrixDimensions.map((dimension) => <th scope="col" key={dimension}>{label(dimension)}</th>)}</tr></thead><tbody>{matrix.map((row) => <tr key={str(row.article_id)}><th scope="row">{str(articleById.get(str(row.article_id))?.title) || str(row.article_id)}</th>{matrixDimensions.map((dimension) => { const cell = obj(obj(row.dimensions)[dimension]); const value = str(cell.value); const unknown = value === "UNKNOWN" || value === "not_assessed" || value === "not_reported"; return <td key={dimension} title={ids(cell.evidence_ids).join(", ") || "Không có EvidenceSpan"}>{unknown ? <span className="rv-not-reported" role="img" aria-label="Không rõ từ bằng chứng hiện có"><CircleMinus size={16} strokeWidth={1.7} /></span> : label(value)}</td>; })}</tr>)}</tbody></table></section> : <Empty>Chưa có nghiên cứu core để xây dựng ma trận.</Empty>}
    <section className="rv-panel"><h2>StudyProfile</h2>{profiles.length ? profiles.map((profile) => <details key={str(profile.article_id)}><summary>{str(articleById.get(str(profile.article_id))?.title) || str(profile.article_id)}</summary><dl className="rv-facts"><dt>Tác vụ</dt><dd>{str(profile.task) || "UNKNOWN"}</dd><dt>Họ phương pháp</dt><dd>{str(profile.method_family) || "UNKNOWN"}</dd><dt>Đóng góp chính</dt><dd>{str(profile.main_contribution) || "UNKNOWN"}</dd><dt>Datasets</dt><dd>{ids(profile.datasets).join("; ") || "UNKNOWN"}</dd><dt>Metrics</dt><dd>{ids(profile.metrics).join("; ") || "UNKNOWN"}</dd><dt>Evidence IDs</dt><dd>{ids(profile.evidence_ids).join(", ") || "Không có"}</dd></dl></details>) : <Empty>Chưa có StudyProfile.</Empty>}</section>
    <section className="rv-panel"><h2>Study quality: mức độ báo cáo</h2><p>Các mục này chỉ cho biết có bằng chứng về cách nghiên cứu được báo cáo; không xác nhận tính đầy đủ hay chất lượng phương pháp.</p>{list(data.study_quality_profiles).map((profile) => <details key={str(profile.article_id)}><summary>{str(articleById.get(str(profile.article_id))?.title) || str(profile.article_id)}</summary><dl className="rv-facts">{Object.entries(obj(profile.dimensions)).map(([name, raw]) => { const dimension = obj(raw); return <Fragment key={name}><dt>{label(name)}</dt><dd>{label(dimension.status)} · {ids(dimension.evidence_ids).join(", ") || "không có evidence ID"}</dd></Fragment>; })}</dl></details>)}</section>
    <section className="rv-panel rv-span-section"><div className="rv-span-heading"><div><h2>EvidenceSpan</h2><p>{spans.length} đoạn có căn cứ từ {spansByArticle.size} bài.</p></div></div>{spans.length ? <div className="rv-span-studies">{Array.from(spansByArticle, ([articleId, rows]) => <section className="rv-span-study" key={articleId}><h3>{str(articleById.get(articleId)?.title) || articleId}<span>{rows.length} đoạn</span></h3><div className="rv-span-grid">{rows.map((span, index) => <article className="rv-evidence-span" key={`${str(span.id)}-${sourceLevel(span)}-${index}`}><header><span className="rv-evidence-type">{label(span.evidence_type)}</span><span className="rv-source-level">{sourceLevel(span)} · {sourceStrength(span)}</span><code>{str(span.id)}</code></header><blockquote>{str(span.text) || str(span.exact_text)}</blockquote>{span.context_before || span.context_after ? <p>Ngữ cảnh: {str(span.context_before)} <strong>{str(span.exact_text)}</strong> {str(span.context_after)}</p> : null}<footer><span>Vị trí nguồn</span><strong>{sourceLevel(span) === "abstract" ? `Abstract · ${str(articleById.get(articleId)?.abstract_source) || "search metadata"}` : str(articleById.get(articleId)?.source_text_file)} · {String(span.start_position ?? "?")}–{String(span.end_position ?? "?")}</strong></footer></article>)}</div></section>)}</div> : <Empty>Không có EvidenceSpan nào được trích xuất.</Empty>}</section>
  </div>;

  if (view === "methodology") {
    const understanding = obj(data.query_understanding);
    return <div className="rv-stack"><div className="rv-view-intro"><span className="rv-eyebrow">REPRODUCIBLE SEARCH</span><h2>Truy vấn và sàng lọc</h2><p>Kế hoạch khái niệm, truy vấn theo nhà cung cấp và quyết định theo từng tiêu chí.</p></div>
      <section className="rv-panel"><h2>Kế hoạch khái niệm</h2><dl className="rv-facts"><dt>Bắt buộc</dt><dd>{ids(understanding.required_concepts).join(", ") || "Chưa ghi nhận"}</dd><dt>Tác vụ</dt><dd>{ids(understanding.task_concepts).join(", ") || "Chưa ghi nhận"}</dd><dt>Tổng quát hóa</dt><dd>{ids(understanding.generalization_concepts).join(", ") || "Chưa ghi nhận"}</dd><dt>Liên quan</dt><dd>{ids(understanding.related_concepts).join(", ") || "Chưa ghi nhận"}</dd></dl></section>
      <section className="rv-panel"><h2>Search provenance</h2>{provenance.length ? provenance.map((record, index) => <p key={`${str(record.provider)}-${index}`}><strong>{str(record.provider)}</strong> · {str(record.query)} · {String(record.records ?? 0)} kết quả{record.error ? ` · lỗi: ${str(record.error)}` : ""}{record.query_kind ? ` · ${label(record.query_kind)}` : ""}</p>) : <Empty>Chưa có provenance tìm kiếm.</Empty>}</section>
      <section className="rv-panel"><h2>Cần adjudication</h2>{articles.filter((article) => article.scope === "background").length ? articles.filter((article) => article.scope === "background").map((article) => <div key={str(article.id)}><strong>{str(article.title)}</strong> <span>{str(article.id)}</span> {onAdjudicate && <><button type="button" disabled={adjudicationBusy} onClick={() => onAdjudicate(str(article.id), "include")}>Include</button> <button type="button" disabled={adjudicationBusy} onClick={() => onAdjudicate(str(article.id), "exclude")}>Exclude</button></>}</div>) : <Empty>Không còn bài cần quyết định thủ công.</Empty>}</section>
      <section className="rv-panel"><h2>Kết quả sàng lọc</h2>{screening.length ? screening.map((row, index) => <details key={`${str(row.article_id)}-${index}`}><summary>{str(row.article_id)} · {scopeLabel(row.scope)} · {str(row.workflow_status) || str(row.decision)}</summary><p>{str(row.reason)}</p>{list(row.criteria).map((criterion, criterionIndex) => <p key={criterionIndex}><strong>{label(criterion.criterion)}:</strong> {str(criterion.decision)} — {str(criterion.evidence)}</p>)}</details>) : <Empty>Chưa có kết quả sàng lọc.</Empty>}</section>
    </div>;
  }

  if (view === "diagnostics") return <div className="rv-stack"><div className="rv-view-intro"><span className="rv-eyebrow">PIPELINE HEALTH</span><h2>Chất lượng và chẩn đoán</h2><p>Các chỉ số này phản ánh trực tiếp output có cấu trúc hiện tại.</p></div><section className="rv-panel"><h2>Quality metrics</h2><div className="rw-review-facts">{Object.entries(quality).map(([name, value]) => <div key={name}><strong>{label(name)}</strong><span>{typeof value === "number" && name.includes("coverage") ? percent(value) : String(value)}</span></div>)}</div></section><section className="rv-panel"><h2>Review quality</h2><div className="rw-review-facts">{Object.entries(reviewQuality).filter(([, value]) => !Array.isArray(value)).map(([name, value]) => <div key={name}><strong>{label(name)}</strong><span>{typeof value === "number" && name.includes("coverage") ? percent(value) : String(value)}</span></div>)}</div></section><section className="rv-panel"><h2>Trạng thái pipeline</h2><dl className="rv-facts">{Object.entries(obj(data.stage_statuses)).map(([name, value]) => <Fragment key={name}><dt>{label(name)}</dt><dd>{label(value)}</dd></Fragment>)}</dl><p><strong>Gap verification:</strong> {gapStatus(obj(data.gap_verification).status)}</p><button className="rv-link" type="button" onClick={onOpenFolder}>Mở nguồn, JSON và runtime log →</button></section></div>;

  return null;
}
