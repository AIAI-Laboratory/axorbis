import assert from "node:assert/strict";
import { test } from "node:test";
import { validateResearcherHandoff, validateReviewHandoff, validateVerifiedHandoff } from "../extensions/research-tools/deepresearch-handoff-validator.js";

const record = { claim_id: "C1", source_id: "T1-S1", url: "https://example.org/paper", location: "Results, paragraph 2", support_excerpt: "BM25 ranks documents using term frequency and document length.", verification_status: "fetched" };
const source = { source_id: record.source_id, url: record.url, location: record.location, support_excerpt: record.support_excerpt, verification_status: record.verification_status, evidence_line: 1 };
const summary = { schema_version: 1, lane: "T1", claims: [{ claim_id: "C1", claim: "BM25 uses term frequency and document length.", confidence: "high", sources: [source] }] };

test("researcher handoff traces each source to its full evidence line", () => {
  assert.deepEqual(validateResearcherHandoff(`${JSON.stringify(record)}\n`, JSON.stringify(summary)), { lane: "T1", claims: 1, evidenceLines: 1 });
  assert.throws(() => validateResearcherHandoff(`${JSON.stringify(record)}\n`, JSON.stringify({ ...summary, claims: [{ ...summary.claims[0], sources: [{ ...source, evidence_line: 2 }] }] })), /Invalid evidence_line/);
  assert.throws(() => validateResearcherHandoff(`${JSON.stringify(record)}\n`, JSON.stringify({ ...summary, claims: [{ ...summary.claims[0], sources: [{ ...source, support_excerpt: "Made up." }] }] })), /Evidence mismatch/);
});

test("incremental verifier must account for every claim without changing provenance", () => {
  const verified = { ...summary, claims: [{ ...summary.claims[0], status: "supported", check: "Compared wording with stored Results excerpt." }] };
  assert.deepEqual(validateVerifiedHandoff(JSON.stringify(summary), JSON.stringify(verified)), { lane: "T1", claims: 1 });
  assert.throws(() => validateVerifiedHandoff(JSON.stringify(summary), JSON.stringify({ ...verified, claims: [] })), /omitted claims/);
  assert.throws(() => validateVerifiedHandoff(JSON.stringify(summary), JSON.stringify({ ...verified, claims: [{ ...verified.claims[0], sources: [{ ...source, url: "https://wrong.example" }] }] })), /altered evidence/);
});

test("review summary findings point to exact cited-draft passages", () => {
  const finding = { id: "R1", severity: "MAJOR", claim_id: "C1", draft_excerpt: "BM25 always wins.", issue: "Overstated conclusion.", action: "Narrow the claim.", source_ids: ["T1-S1"] };
  const review = `R1 MAJOR: BM25 always wins. The summary overstates C1.`;
  assert.deepEqual(validateReviewHandoff(review, JSON.stringify({ schema_version: 1, findings: [finding] }), "BM25 always wins. [1]"), { findings: 1 });
  assert.throws(() => validateReviewHandoff(review, JSON.stringify({ schema_version: 1, findings: [finding] }), "BM25 is a baseline. [1]"), /Cited draft lacks excerpt/);
});
