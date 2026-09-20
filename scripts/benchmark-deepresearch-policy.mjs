#!/usr/bin/env node

/**
 * Contract benchmark for the Deep Research workflow. This deliberately measures
 * deterministic orchestration bounds, not provider token usage. A live A/B run
 * must use the same task prompts and the feynman_deepresearch_metrics artifact.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const tasks = [
	{ name: "narrow explainer", oldResearchers: 0, newResearchers: 0 },
	{ name: "direct comparison", oldResearchers: 2, newResearchers: 2 },
	{ name: "broad survey", oldResearchers: 4, newResearchers: 3 },
	{ name: "complex multi-domain", oldResearchers: 6, newResearchers: 4 },
];

const oldPolicy = {
	searchRounds: null,
	queriesPerRound: null,
	fullFetchesPerWorker: null,
	acceptedSourcesPerWorker: null,
	verifierRefetch: "every cited URL",
	reviewerInput: "cited draft; raw-source reuse not specified",
	reasoning: { researcher: "high", verifier: "medium", reviewer: "high" },
	context: "implicit/default",
};

const newPolicy = {
	searchRounds: 2,
	queriesPerRound: 4,
	fullFetchesPerWorker: 4,
	acceptedSourcesPerWorker: 8,
	verifierRefetch: "selective only",
	reviewerInput: "cited draft + claim map",
	reasoning: { researcher: "medium", verifier: "low", reviewer: "medium" },
	context: "fresh, inheritance disabled",
};

function bounded(value) {
	return value == null ? "unbounded" : String(value);
}

const rows = tasks.map((task) => ({
	task: task.name,
	oldResearchers: task.oldResearchers,
	newResearchers: task.newResearchers,
	researcherReductionPercent: task.oldResearchers === 0
		? 0
		: Math.round((1 - task.newResearchers / task.oldResearchers) * 100),
	oldSearchBudget: bounded(oldPolicy.searchRounds),
	newSearchBudget: `${newPolicy.searchRounds} rounds × ${newPolicy.queriesPerRound} queries`,
	oldFetchBudget: bounded(oldPolicy.fullFetchesPerWorker),
	newFetchBudget: `${newPolicy.fullFetchesPerWorker}/worker`,
	oldAcceptedSourceBudget: bounded(oldPolicy.acceptedSourcesPerWorker),
	newAcceptedSourceBudget: `~${newPolicy.acceptedSourcesPerWorker}/worker`,
}));

const report = {
	schema: "feynman.deepresearchPolicyBenchmark.v1",
	generatedAt: new Date().toISOString(),
	status: "contract-only",
	interpretation: "The benchmark uses the same representative task shapes to compare deterministic workflow bounds. It does not infer provider token savings or quality from caps.",
	oldPolicy,
	newPolicy,
	rows,
	qualityGuards: [
		"structured claim-level JSONL evidence is required before synthesis",
		"metadata-only discovery cannot support a content claim",
		"verifier runs before reviewer and re-fetches only central/insufficient/conflicted/uncertain claims",
		"reviewer receives the cited draft and claim map first, with targeted escalation only for MAJOR/FATAL issues",
		"two no-gain searches stop retrieval",
	],
	tokenAblation: {
	status: "not-measured",
	why: "No clean old/new provider runs were available in the current environment; the retained historical run mixed retries and quota failures. Run the same task prompts before and after with feynman_deepresearch_metrics to populate token deltas.",
	metricsRequired: ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "promptTokens", "cumulativeTokens", "peakContextTokens"],
	},
};

const outputPath = resolve(process.cwd(), ".axorbis/artifacts/projects/feynman-deepresearch/deepresearch-token-optimization-benchmark.json");
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.table(rows.map((row) => ({
	task: row.task,
	"old researchers": row.oldResearchers,
	"new researchers": row.newResearchers,
	"researcher Δ": `${row.researcherReductionPercent}%`,
	"new fetch cap": row.newFetchBudget,
	"new source cap": row.newAcceptedSourceBudget,
})));
console.log(`Wrote ${outputPath}`);
