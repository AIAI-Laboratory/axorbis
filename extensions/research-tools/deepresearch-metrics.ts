import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type JsonRecord = Record<string, unknown>;

type Usage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
};

type Retrieval = {
	searchCalls: number;
	searchQueries: number;
	searchFullContentCalls: number;
	fullFetchCalls: number;
	fullFetchedUrls: number;
	storedContentLookups: number;
	storedContentSourcesReused: number;
	fetchedUrlHashes: Set<string>;
	storedSourceHashes: Set<string>;
};

export type DeepResearchStageMetrics = {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	promptTokens: number;
	cumulativeTokens: number;
	peakContextTokens: number;
	turns: number;
	searchCalls: number;
	searchQueries: number;
	searchFullContentCalls: number;
	fullFetchCalls: number;
	fullFetchedUrls: number;
	storedContentLookups: number;
	storedContentSourcesReused: number;
};

export type DeepResearchMetricsReport = {
	schema: "feynman.deepresearchMetrics.v1";
	slug: string;
	generatedAt: string;
	definitions: {
		inputTokens: string;
		promptTokens: string;
		cumulativeTokens: string;
		peakContextTokens: string;
		storedContentSourcesReused: string;
		fullFetchedUrls: string;
	};
	stages: Record<string, DeepResearchStageMetrics>;
	totals: DeepResearchStageMetrics & {
		researcherCount: number;
		verifierRefetches: number;
		acceptedSources: number;
	};
	measurement: {
		leadSessionSegmentFound: boolean;
		childRunsFound: number;
		childRunsMissing: number;
		evidenceLedgerRead: boolean;
		notes: string[];
	};
};

const ZERO_USAGE = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const ZERO_RETRIEVAL = (): Retrieval => ({
	searchCalls: 0,
	searchQueries: 0,
	searchFullContentCalls: 0,
	fullFetchCalls: 0,
	fullFetchedUrls: 0,
	storedContentLookups: 0,
	storedContentSourcesReused: 0,
	fetchedUrlHashes: new Set<string>(),
	storedSourceHashes: new Set<string>(),
});

function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function usageValue(value: unknown): Usage {
	if (!isRecord(value)) return ZERO_USAGE();
	return {
		input: numberValue(value.input),
		output: numberValue(value.output),
		cacheRead: numberValue(value.cacheRead),
		cacheWrite: numberValue(value.cacheWrite),
	};
}

function addUsage(target: Usage, usage: Usage): void {
	target.input += usage.input;
	target.output += usage.output;
	target.cacheRead += usage.cacheRead;
	target.cacheWrite += usage.cacheWrite;
}

function compactHash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function normalizedUrl(value: unknown): string | undefined {
	if (typeof value !== "string" || !value.trim()) return undefined;
	try {
		const url = new URL(value.trim());
		url.hash = "";
		for (const key of [...url.searchParams.keys()]) {
			if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
		}
		return url.toString().replace(/\/$/, "");
	} catch {
		return undefined;
	}
}

function urlValues(args: JsonRecord): string[] {
	const values = [args.url, ...(Array.isArray(args.urls) ? args.urls : [])];
	return values.flatMap((value) => {
		const normalized = normalizedUrl(value);
		return normalized ? [normalized] : [];
	});
}

function queryCount(args: JsonRecord): number {
	if (Array.isArray(args.queries)) return args.queries.filter((query) => typeof query === "string" && query.trim()).length;
	return typeof args.query === "string" && args.query.trim() ? 1 : 0;
}

function storedSourceIdentity(args: JsonRecord): string | undefined {
	for (const key of ["responseId", "fetchId", "searchId", "sourceId"]) {
		const value = args[key];
		if (typeof value === "string" && value.trim()) return compactHash(`${key}:${value.trim()}`);
	}
	return undefined;
}

type ToolCall = { id?: string; name: string; args: JsonRecord; succeeded?: boolean };

function applyToolCalls(retrieval: Retrieval, calls: ToolCall[]): void {
	for (const call of calls) {
		if (call.succeeded === false) continue;
		if (call.name === "web_search") {
			retrieval.searchCalls += 1;
			retrieval.searchQueries += queryCount(call.args);
			if (call.args.includeContent === true) retrieval.searchFullContentCalls += 1;
			continue;
		}
		if (call.name === "fetch_content") {
			const urls = urlValues(call.args);
			retrieval.fullFetchCalls += 1;
			retrieval.fullFetchedUrls += urls.length;
			for (const url of urls) retrieval.fetchedUrlHashes.add(compactHash(url));
			continue;
		}
		if (call.name === "get_search_content") {
			retrieval.storedContentLookups += 1;
			const identity = storedSourceIdentity(call.args);
			if (identity) retrieval.storedSourceHashes.add(identity);
		}
	}
	retrieval.storedContentSourcesReused = retrieval.storedSourceHashes.size;
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((part) => isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [])
		.join("\n");
}

function deepResearchSegment(entries: unknown[], slug: string): { entries: unknown[]; found: boolean } {
	let start = -1;
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "user") continue;
		const text = contentText(entry.message.content).toLowerCase();
		if (text.includes("run deep research for:") && (text.includes(slug.toLowerCase()) || start === -1)) start = index;
	}
	return { entries: start >= 0 ? entries.slice(start) : entries, found: start >= 0 };
}

function rootToolCalls(entries: unknown[]): ToolCall[] {
	const ended = new Map<string, boolean>();
	for (const entry of entries) {
		if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "toolResult") continue;
		const id = typeof entry.message.toolCallId === "string" ? entry.message.toolCallId : undefined;
		if (id) ended.set(id, entry.message.isError !== true);
	}
	const calls: ToolCall[] = [];
	for (const entry of entries) {
		if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "assistant") continue;
		if (!Array.isArray(entry.message.content)) continue;
		for (const part of entry.message.content) {
			if (!isRecord(part) || part.type !== "toolCall" || typeof part.name !== "string") continue;
			const id = typeof part.id === "string" ? part.id : undefined;
			calls.push({ id, name: part.name, args: isRecord(part.arguments) ? part.arguments : {}, succeeded: id ? ended.get(id) : undefined });
		}
	}
	return calls;
}

function rootUsage(entries: unknown[]): { usage: Usage; peak: number; turns: number } {
	const usage = ZERO_USAGE();
	let peak = 0;
	let turns = 0;
	for (const entry of entries) {
		if (!isRecord(entry)) continue;
		if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage) addUsage(usage, usageValue(entry.usage));
		if (entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "assistant") continue;
		const turnUsage = usageValue(entry.message.usage);
		addUsage(usage, turnUsage);
		peak = Math.max(peak, turnUsage.input + turnUsage.cacheRead + turnUsage.cacheWrite);
		turns += 1;
	}
	return { usage, peak, turns };
}

function collectRunIds(value: unknown, output = new Set<string>()): Set<string> {
	if (Array.isArray(value)) {
		for (const item of value) collectRunIds(item, output);
		return output;
	}
	if (!isRecord(value)) return output;
	if (typeof value.runId === "string" && /^[A-Za-z0-9_-]{6,128}$/.test(value.runId)) output.add(value.runId);
	for (const nested of Object.values(value)) collectRunIds(nested, output);
	return output;
}

function childRunIds(entries: unknown[]): Set<string> {
	const ids = new Set<string>();
	for (const entry of entries) {
		if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "toolResult") continue;
		if (entry.message.toolName !== "subagent") continue;
		collectRunIds(entry.message.details, ids);
	}
	return ids;
}

function readJson(path: string): JsonRecord | undefined {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return isRecord(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function readJsonLines(path: string): JsonRecord[] {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split(/\r?\n/)
		.flatMap((line) => {
			if (!line.trim()) return [];
			try {
				const value = JSON.parse(line) as unknown;
				return isRecord(value) ? [value] : [];
			} catch {
				return [];
			}
		});
}

function transcriptData(path: string | undefined): { usage: Usage; peak: number; turns: number; calls: ToolCall[] } {
	if (!path || !existsSync(path)) return { usage: ZERO_USAGE(), peak: 0, turns: 0, calls: [] };
	const records = readJsonLines(path);
	const usage = ZERO_USAGE();
	let peak = 0;
	let turns = 0;
	const ended = new Map<string, boolean>();
	for (const record of records) {
		if (record.recordType === "tool_end" && typeof record.toolCallId === "string") ended.set(record.toolCallId, record.isError !== true);
	}
	const calls: ToolCall[] = [];
	for (const record of records) {
		if (record.recordType === "message" && record.role === "assistant") {
			const turnUsage = usageValue(record.usage ?? (isRecord(record.message) ? record.message.usage : undefined));
			addUsage(usage, turnUsage);
			peak = Math.max(peak, turnUsage.input + turnUsage.cacheRead + turnUsage.cacheWrite);
			turns += 1;
		}
		if (record.recordType === "tool_start" && typeof record.toolName === "string") {
			let args: JsonRecord = {};
			if (typeof record.argsPayload === "string") {
				try {
					const parsed = JSON.parse(record.argsPayload) as unknown;
					if (isRecord(parsed)) args = parsed;
				} catch {}
			}
			const id = typeof record.toolCallId === "string" ? record.toolCallId : undefined;
			calls.push({ id, name: record.toolName, args, succeeded: id ? ended.get(id) : undefined });
		}
	}
	return { usage, peak, turns, calls };
}

function stageName(agent: unknown): string {
	if (typeof agent === "string" && (agent === "researcher" || agent.startsWith("deepresearch-researcher-"))) return "researcher";
	if (agent === "deepresearch-claim-verifier") return "verifier";
	if (agent === "deepresearch-reviewer") return "reviewer";
	return agent === "writer" || agent === "verifier" || agent === "reviewer" ? agent : "other";
}

function stageMetrics(usage: Usage, peak: number, turns: number, retrieval: Retrieval): DeepResearchStageMetrics {
	return {
		inputTokens: usage.input,
		outputTokens: usage.output,
		cacheReadTokens: usage.cacheRead,
		cacheWriteTokens: usage.cacheWrite,
		promptTokens: usage.input + usage.cacheRead + usage.cacheWrite,
		cumulativeTokens: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
		peakContextTokens: peak,
		turns,
		searchCalls: retrieval.searchCalls,
		searchQueries: retrieval.searchQueries,
		searchFullContentCalls: retrieval.searchFullContentCalls,
		fullFetchCalls: retrieval.fullFetchCalls,
		fullFetchedUrls: retrieval.fullFetchedUrls,
		storedContentLookups: retrieval.storedContentLookups,
		storedContentSourcesReused: retrieval.storedContentSourcesReused,
	};
}

function safeWorkspacePath(cwd: string, requested: string, expectedExtension: string): string {
	const path = resolve(cwd, requested);
	const rel = relative(cwd, path);
	if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
		throw new Error("Metrics paths must stay inside the current workspace.");
	}
	if (extname(path) !== expectedExtension) throw new Error(`Expected a ${expectedExtension} path.`);
	return path;
}

export function buildDeepResearchMetrics(input: {
	slug: string;
	leadEntries: unknown[];
	sessionDir: string;
	evidencePath?: string;
}): DeepResearchMetricsReport {
	const segment = deepResearchSegment(input.leadEntries, input.slug);
	const stages = new Map<string, { usage: Usage; peak: number; turns: number; retrieval: Retrieval }>();
	const ensureStage = (name: string) => {
		let stage = stages.get(name);
		if (!stage) {
			stage = { usage: ZERO_USAGE(), peak: 0, turns: 0, retrieval: ZERO_RETRIEVAL() };
			stages.set(name, stage);
		}
		return stage;
	};

	const lead = ensureStage("lead");
	const leadUsage = rootUsage(segment.entries);
	addUsage(lead.usage, leadUsage.usage);
	lead.peak = leadUsage.peak;
	lead.turns = leadUsage.turns;
	applyToolCalls(lead.retrieval, rootToolCalls(segment.entries));

	const runIds = childRunIds(segment.entries);
	let childRunsFound = 0;
	let childRunsMissing = 0;
	const researcherRuns = new Set<string>();
	for (const runId of runIds) {
		const candidates = [
			"researcher", "deepresearch-researcher-web", "deepresearch-researcher-paper",
			"deepresearch-researcher-bio", "deepresearch-researcher-chem", "deepresearch-researcher-genomics",
			"verifier", "deepresearch-claim-verifier", "reviewer", "deepresearch-reviewer", "writer", "worker", "delegate",
		]
			.map((agent) => resolve(input.sessionDir, "subagent-artifacts", `${runId}_${agent}_meta.json`));
		const metaPath = candidates.find((path) => existsSync(path));
		const meta = metaPath ? readJson(metaPath) : undefined;
		if (!meta) {
			childRunsMissing += 1;
			continue;
		}
		childRunsFound += 1;
		const name = stageName(meta.agent);
		if (name === "researcher") researcherRuns.add(runId);
		const stage = ensureStage(name);
		const transcriptPath = typeof meta.transcriptPath === "string" ? meta.transcriptPath : undefined;
		const transcript = transcriptData(transcriptPath);
		const metaUsage = usageValue(meta.usage);
		addUsage(stage.usage, (metaUsage.input + metaUsage.output + metaUsage.cacheRead + metaUsage.cacheWrite) > 0 ? metaUsage : transcript.usage);
		stage.peak = Math.max(stage.peak, transcript.peak, numberValue(isRecord(meta.progress) ? meta.progress.windowPeak : undefined));
		stage.turns += numberValue(metaUsage.input + metaUsage.output + metaUsage.cacheRead + metaUsage.cacheWrite > 0 && isRecord(meta.usage) ? meta.usage.turns : undefined) || transcript.turns;
		applyToolCalls(stage.retrieval, transcript.calls);
	}

	const evidence = input.evidencePath ? readJsonLines(input.evidencePath) : [];
	const acceptedSourceIds = new Set(evidence.flatMap((record) => {
		if (record.verification_status === "metadata-only" || typeof record.source_id !== "string") return [];
		return [record.source_id];
	}));

	const stageReport = Object.fromEntries([...stages.entries()].map(([name, stage]) => [
		name,
		stageMetrics(stage.usage, stage.peak, stage.turns, stage.retrieval),
	]));
	const totalUsage = ZERO_USAGE();
	const totalRetrieval = ZERO_RETRIEVAL();
	let peakContextTokens = 0;
	let turns = 0;
	for (const stage of stages.values()) {
		addUsage(totalUsage, stage.usage);
		peakContextTokens = Math.max(peakContextTokens, stage.peak);
		turns += stage.turns;
		totalRetrieval.searchCalls += stage.retrieval.searchCalls;
		totalRetrieval.searchQueries += stage.retrieval.searchQueries;
		totalRetrieval.searchFullContentCalls += stage.retrieval.searchFullContentCalls;
		totalRetrieval.fullFetchCalls += stage.retrieval.fullFetchCalls;
		totalRetrieval.fullFetchedUrls += stage.retrieval.fullFetchedUrls;
		totalRetrieval.storedContentLookups += stage.retrieval.storedContentLookups;
		for (const hash of stage.retrieval.storedSourceHashes) totalRetrieval.storedSourceHashes.add(hash);
	}
	totalRetrieval.storedContentSourcesReused = totalRetrieval.storedSourceHashes.size;

	const researchFetches = new Set<string>([
		...(stages.get("lead")?.retrieval.fetchedUrlHashes ?? []),
		...(stages.get("researcher")?.retrieval.fetchedUrlHashes ?? []),
	]);
	const verifierRefetches = [...(stages.get("verifier")?.retrieval.fetchedUrlHashes ?? [])]
		.filter((hash) => researchFetches.has(hash)).length;

	return {
		schema: "feynman.deepresearchMetrics.v1",
		slug: input.slug,
		generatedAt: new Date().toISOString(),
		definitions: {
			inputTokens: "Provider-reported uncached input tokens; cache reads and writes are separate.",
			promptTokens: "Input + cache-read + cache-write tokens summed across requests.",
			cumulativeTokens: "Input + output + cache-read + cache-write tokens summed across requests.",
			peakContextTokens: "Largest provider-reported per-turn prompt footprint; it is not cumulative usage.",
			storedContentSourcesReused: "Distinct stored response identifiers reopened with get_search_content; not HTTP cache hits.",
			fullFetchedUrls: "Successful explicit fetch_content URL requests. web_search includeContent calls are reported separately because fetched URL counts may be opaque.",
		},
		stages: stageReport,
		totals: {
			...stageMetrics(totalUsage, peakContextTokens, turns, totalRetrieval),
			researcherCount: researcherRuns.size,
			verifierRefetches,
			acceptedSources: acceptedSourceIds.size,
		},
		measurement: {
			leadSessionSegmentFound: segment.found,
			childRunsFound,
			childRunsMissing,
			evidenceLedgerRead: Boolean(input.evidencePath && existsSync(input.evidencePath)),
			notes: [
				"Counts come from local Pi session entries and retained pi-subagents metadata/transcripts.",
				"No prompts, URLs, source text, tool arguments, or local paths are included in this artifact.",
				"A zero may mean no activity or unavailable retained child telemetry; inspect measurement fields before comparison.",
			],
		},
	};
}

export function registerDeepResearchMetricsTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "feynman_deepresearch_metrics",
		label: "Deep Research Metrics",
		description: "Write a sanitized per-stage Deep Research usage and retrieval metrics artifact from the current Pi session and completed child runs.",
		promptSnippet: "Measure Deep Research lead/researcher/verifier/reviewer token and retrieval usage after all child runs finish.",
		promptGuidelines: [
			"Call once near the end of an approved /deepresearch run, after researcher, verifier, and reviewer children have completed.",
			"Pass the merged evidence JSONL so accepted-source counts come from durable evidence rather than guesses.",
			"Do not describe stored-content reuse as an HTTP cache hit.",
		],
		parameters: Type.Object({
			slug: Type.String({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+){0,4}$" }),
			evidencePath: Type.Optional(Type.String({ description: "Workspace-relative merged evidence .jsonl path." })),
			outputPath: Type.String({ description: "Workspace-relative .json metrics output path." }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const evidencePath = params.evidencePath
				? safeWorkspacePath(ctx.cwd, params.evidencePath, ".jsonl")
				: undefined;
			const outputPath = safeWorkspacePath(ctx.cwd, params.outputPath, ".json");
			const report = buildDeepResearchMetrics({
				slug: params.slug,
				leadEntries: ctx.sessionManager.getEntries(),
				sessionDir: ctx.sessionManager.getSessionDir(),
				evidencePath,
			});
			mkdirSync(dirname(outputPath), { recursive: true });
			writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
			return {
				content: [{ type: "text", text: `Deep Research metrics written: ${relative(ctx.cwd, outputPath)}` }],
				details: report,
			};
		},
	});
}
