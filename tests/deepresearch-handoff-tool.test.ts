import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDeepResearchHandoffTool } from "../extensions/research-tools/deepresearch-handoff.js";

test("Deep Research handoff tool validates a BM25 claim without returning evidence text", async () => {
	const root = mkdtempSync(join(tmpdir(), "deepresearch-handoff-"));
	try {
		mkdirSync(join(root, ".drafts"));
		const record = { claim_id: "C1", source_id: "T1-S1", url: "https://example.org/bm25", location: "Methods", support_excerpt: "BM25 uses term frequency and document length.", verification_status: "fetched" };
		const summary = { schema_version: 1, lane: "T1", claims: [{ claim_id: "C1", claim: "BM25 uses term frequency and document length.", confidence: "high", sources: [{ source_id: record.source_id, url: record.url, location: record.location, support_excerpt: record.support_excerpt, verification_status: record.verification_status, evidence_line: 1 }] }] };
		const verified = { ...summary, claims: [{ ...summary.claims[0], status: "supported", check: "Compared claim with Methods excerpt." }] };
		writeFileSync(join(root, ".drafts", "bm25-evidence-T1.jsonl"), `${JSON.stringify(record)}\n`);
		writeFileSync(join(root, ".drafts", "bm25-summary-T1.json"), JSON.stringify(summary));
		writeFileSync(join(root, ".drafts", "bm25-verified-T1.json"), JSON.stringify(verified));
		let tool: any;
		registerDeepResearchHandoffTool({ registerTool: (value: unknown) => { tool = value; } } as unknown as ExtensionAPI);
		const result = await tool.execute("call", { kind: "researcher", fullPath: ".drafts/bm25-evidence-T1.jsonl", summaryPath: ".drafts/bm25-summary-T1.json", verifiedPath: ".drafts/bm25-verified-T1.json" }, undefined, undefined, { cwd: root });
		assert.equal(result.details.claims, 1);
		assert.doesNotMatch(JSON.stringify(result), /example\.org|Methods|term frequency/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
