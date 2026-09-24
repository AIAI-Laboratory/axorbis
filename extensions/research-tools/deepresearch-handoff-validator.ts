import { isDeepStrictEqual } from "node:util";

type JsonObject = Record<string, any>;
const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** Validate a researcher handoff against its durable JSONL evidence. */
export function validateResearcherHandoff(evidenceText: string, summaryText: string) {
  const evidence = evidenceText.split(/\r?\n/).filter(Boolean).map((line, index) => {
    let record;
    try { record = JSON.parse(line); } catch { throw new Error(`Evidence line ${index + 1} is not JSON`); }
    if (!isObject(record)) throw new Error(`Evidence line ${index + 1} is not an object`);
    return record;
  });
  const summary = JSON.parse(summaryText);
  if (!isObject(summary) || summary.schema_version !== 1 || !nonempty(summary.lane) || !Array.isArray(summary.claims)) {
    throw new Error("Summary must have schema_version=1, lane, and claims array");
  }
  const seen = new Set<string>();
  for (const claim of summary.claims) {
    if (!isObject(claim) || !nonempty(claim.claim_id) || !nonempty(claim.claim) || !["high", "medium", "low"].includes(claim.confidence) || !Array.isArray(claim.sources) || claim.sources.length === 0) {
      throw new Error("Each claim needs claim_id, claim, confidence, and sources");
    }
    if (seen.has(claim.claim_id)) throw new Error(`Duplicate claim ${claim.claim_id}`);
    seen.add(claim.claim_id);
    for (const source of claim.sources) {
      if (!isObject(source) || !Number.isInteger(source.evidence_line) || source.evidence_line < 1 || source.evidence_line > evidence.length) throw new Error(`Invalid evidence_line for ${claim.claim_id}`);
      const record = evidence[source.evidence_line - 1];
      for (const key of ["claim_id", "source_id", "url", "location", "support_excerpt"]) {
        const expected = key === "claim_id" ? claim.claim_id : source[key];
        if (!nonempty(expected) || record[key] !== expected) throw new Error(`Evidence mismatch for ${claim.claim_id}: ${key}`);
      }
      if (source.doi !== undefined && (!nonempty(source.doi) || record.doi !== source.doi)) throw new Error(`DOI mismatch for ${claim.claim_id}`);
      if (source.verification_status !== record.verification_status) throw new Error(`Evidence status mismatch for ${claim.claim_id}`);
    }
  }
  return { lane: summary.lane, claims: summary.claims.length, evidenceLines: evidence.length };
}

/** The verifier must account for every researcher claim, with an explicit outcome. */
export function validateVerifiedHandoff(summaryText: string, verifiedText: string) {
  const summary = JSON.parse(summaryText);
  const verified = JSON.parse(verifiedText);
  if (!isObject(verified) || verified.schema_version !== 1 || verified.lane !== summary.lane || !Array.isArray(verified.claims)) throw new Error("Verified summary header mismatch");
  const sourceIds = new Set<string>(summary.claims.map((claim: JsonObject) => String(claim.claim_id)));
  const verifiedIds = new Set<string>();
  for (const claim of verified.claims) {
    if (!isObject(claim) || !sourceIds.has(claim.claim_id) || verifiedIds.has(claim.claim_id) || !["supported", "conflicted", "unsupported", "inferred", "blocked"].includes(claim.status) || !nonempty(claim.check) || !Array.isArray(claim.sources)) throw new Error("Invalid verified claim");
    verifiedIds.add(claim.claim_id);
    const original = summary.claims.find((item: JsonObject) => item.claim_id === claim.claim_id);
    if (!isDeepStrictEqual(claim.sources, original.sources) || claim.claim !== original.claim || claim.confidence !== original.confidence) throw new Error(`Verified claim altered evidence: ${claim.claim_id}`);
  }
  if (verifiedIds.size !== sourceIds.size) throw new Error("Verifier omitted claims");
  return { lane: summary.lane, claims: verifiedIds.size };
}

export function validateReviewHandoff(reviewText: string, summaryText: string, citedText: string) {
  const summary = JSON.parse(summaryText);
  if (!nonempty(reviewText) || !isObject(summary) || summary.schema_version !== 1 || !Array.isArray(summary.findings)) throw new Error("Invalid review handoff");
  const seen = new Set<string>();
  for (const finding of summary.findings) {
    if (!isObject(finding) || !nonempty(finding.id) || seen.has(finding.id) || !["FATAL", "MAJOR", "MINOR"].includes(finding.severity) || !nonempty(finding.claim_id) || !nonempty(finding.draft_excerpt) || !nonempty(finding.issue) || !nonempty(finding.action) || !Array.isArray(finding.source_ids)) throw new Error("Invalid review finding");
    if (!reviewText.includes(finding.draft_excerpt)) throw new Error(`Review lacks excerpt for ${finding.id}`);
    if (!citedText.includes(finding.draft_excerpt)) throw new Error(`Cited draft lacks excerpt for ${finding.id}`);
    seen.add(finding.id);
  }
  return { findings: summary.findings.length };
}
