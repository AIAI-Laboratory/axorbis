import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { buildDeepResearchMetrics } from "../extensions/research-tools/deepresearch-metrics.js";

function assistant(id: string, usage: Record<string, number>, content: unknown[]) {
	return { type: "message", id, message: { role: "assistant", usage, content } };
}

function toolResult(id: string, toolCallId: string, toolName: string, details?: unknown) {
	return { type: "message", id, message: { role: "toolResult", toolCallId, toolName, isError: false, details, content: [] } };
}

test("deep research metrics separate token classes and attribute child stages", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-deepresearch-metrics-"));
	try {
		const childDir = join(root, "subagent-artifacts");
		mkdirSync(childDir, { recursive: true });
		const evidencePath = join(root, "evidence.jsonl");
		writeFileSync(evidencePath, [
			JSON.stringify({ source_id: "T1-S1", verification_status: "fetched" }),
			JSON.stringify({ source_id: "T1-S2", verification_status: "verified" }),
			JSON.stringify({ source_id: "T1-S3", verification_status: "metadata-only" }),
		].join("\n") + "\n");

		const researcherTranscript = join(childDir, "research01_researcher_transcript.jsonl");
		writeFileSync(researcherTranscript, [
			JSON.stringify({ recordType: "message", role: "assistant", usage: { input: 15, output: 1, cacheRead: 5, cacheWrite: 0 } }),
			JSON.stringify({ recordType: "tool_start", toolCallId: "s1", toolName: "web_search", argsPayload: JSON.stringify({ queries: ["a", "b", "c", "d"], includeContent: false }) }),
			JSON.stringify({ recordType: "tool_end", toolCallId: "s1", toolName: "web_search", isError: false }),
			JSON.stringify({ recordType: "tool_start", toolCallId: "f1", toolName: "fetch_content", argsPayload: JSON.stringify({ urls: ["https://research.example/a?utm_source=test"] }) }),
			JSON.stringify({ recordType: "tool_end", toolCallId: "f1", toolName: "fetch_content", isError: false }),
			JSON.stringify({ recordType: "tool_start", toolCallId: "g1", toolName: "get_search_content", argsPayload: JSON.stringify({ responseId: "stored-a" }) }),
			JSON.stringify({ recordType: "tool_end", toolCallId: "g1", toolName: "get_search_content", isError: false }),
		].join("\n") + "\n");
		writeFileSync(join(childDir, "research01_researcher_meta.json"), JSON.stringify({
			runId: "research01",
			agent: "researcher",
			usage: { input: 20, output: 4, cacheRead: 10, cacheWrite: 0, turns: 2 },
			transcriptPath: researcherTranscript,
		}));

		const verifierTranscript = join(childDir, "verify01_verifier_transcript.jsonl");
		writeFileSync(verifierTranscript, [
			JSON.stringify({ recordType: "message", role: "assistant", usage: { input: 7, output: 3, cacheRead: 2, cacheWrite: 0 } }),
			JSON.stringify({ recordType: "tool_start", toolCallId: "vf1", toolName: "fetch_content", argsPayload: JSON.stringify({ url: "https://research.example/a" }) }),
			JSON.stringify({ recordType: "tool_end", toolCallId: "vf1", toolName: "fetch_content", isError: false }),
		].join("\n") + "\n");
		writeFileSync(join(childDir, "verify01_verifier_meta.json"), JSON.stringify({
			runId: "verify01",
			agent: "verifier",
			usage: { input: 7, output: 3, cacheRead: 2, cacheWrite: 0, turns: 1 },
			transcriptPath: verifierTranscript,
		}));

		const entries = [
			{ type: "message", id: "u1", message: { role: "user", content: [{ type: "text", text: "Run deep research for: token-efficient-research" }] } },
			assistant("a1", { input: 10, output: 2, cacheRead: 5, cacheWrite: 1 }, [
				{ type: "toolCall", id: "root-search", name: "web_search", arguments: { queries: ["one", "two"], includeContent: false } },
				{ type: "toolCall", id: "root-fetch", name: "fetch_content", arguments: { urls: ["https://lead.example/one", "https://lead.example/two"] } },
			]),
			toolResult("r1", "root-search", "web_search"),
			toolResult("r2", "root-fetch", "fetch_content"),
			toolResult("r3", "sub-1", "subagent", { runId: "research01" }),
			toolResult("r4", "sub-2", "subagent", { runId: "verify01" }),
		];

		const report = buildDeepResearchMetrics({
			slug: "token-efficient-research",
			leadEntries: entries,
			sessionDir: root,
			evidencePath,
		});

		assert.deepEqual(report.stages.lead, {
			inputTokens: 10, outputTokens: 2, cacheReadTokens: 5, cacheWriteTokens: 1,
			promptTokens: 16, cumulativeTokens: 18, peakContextTokens: 16, turns: 1,
			searchCalls: 1, searchQueries: 2, searchFullContentCalls: 0,
			fullFetchCalls: 1, fullFetchedUrls: 2, storedContentLookups: 0, storedContentSourcesReused: 0,
		});
		assert.equal(report.stages.researcher?.inputTokens, 20);
		assert.equal(report.stages.researcher?.peakContextTokens, 20);
		assert.equal(report.stages.researcher?.searchQueries, 4);
		assert.equal(report.stages.researcher?.storedContentSourcesReused, 1);
		assert.equal(report.stages.verifier?.inputTokens, 7);
		assert.equal(report.totals.inputTokens, 37);
		assert.equal(report.totals.outputTokens, 9);
		assert.equal(report.totals.cacheReadTokens, 17);
		assert.equal(report.totals.cacheWriteTokens, 1);
		assert.equal(report.totals.cumulativeTokens, 64);
		assert.equal(report.totals.peakContextTokens, 20);
		assert.equal(report.totals.researcherCount, 1);
		assert.equal(report.totals.verifierRefetches, 1);
		assert.equal(report.totals.acceptedSources, 2);
		assert.equal(report.measurement.childRunsMissing, 0);

		const serialized = JSON.stringify(report);
		assert.doesNotMatch(serialized, /research\.example|lead\.example|stored-a|subagent-artifacts|evidence\.jsonl/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("deep research metrics report missing retained child telemetry without guessing", () => {
	const report = buildDeepResearchMetrics({
		slug: "missing-child",
		leadEntries: [
			{ type: "message", message: { role: "user", content: [{ type: "text", text: "Run deep research for: missing-child" }] } },
			toolResult("r1", "sub", "subagent", { runId: "missing01" }),
		],
		sessionDir: "/definitely/not/a/session-dir",
	});

	assert.equal(report.measurement.childRunsFound, 0);
	assert.equal(report.measurement.childRunsMissing, 1);
	assert.equal(report.totals.researcherCount, 0);
	assert.equal(report.totals.cumulativeTokens, 0);
});
