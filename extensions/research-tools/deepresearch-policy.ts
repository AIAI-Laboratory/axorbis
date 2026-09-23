import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export type DeepResearchMode = "simple" | "standard" | "deep";
export type DeepResearchDomain = "web-only" | "paper-search" | "bio" | "chem" | "genomics" | "unknown";

export type DeepResearchPolicy = {
	mode: DeepResearchMode;
	maxResearchers: number;
	maxWriters: number;
	maxSearchRounds: number;
	maxQueries: number;
	maxFetchedUrls: number;
	maxAcceptedSources: number;
	maxVerifierRefetches: number;
	maxCumulativeTokens: number;
	workerThinking: "low" | "medium";
	allowReviewer: boolean;
	allowVerifier: boolean;
	domainTags: DeepResearchDomain[];
	routeReason: string;
};

export type DeepResearchPolicyInput = {
	complexity: DeepResearchMode;
	questionCount: number;
	entityCount: number;
	domainTags: DeepResearchDomain[];
	reason: string;
	exhaustive?: boolean;
};

const POLICY_BY_MODE: Record<DeepResearchMode, Omit<DeepResearchPolicy, "mode" | "domainTags" | "routeReason">> = {
	simple: {
		maxResearchers: 1,
		maxWriters: 1,
		maxSearchRounds: 2,
		maxQueries: 6,
		maxFetchedUrls: 4,
		maxAcceptedSources: 8,
		maxVerifierRefetches: 2,
		maxCumulativeTokens: 45_000,
		workerThinking: "low",
		allowReviewer: false,
		allowVerifier: false,
	},
	standard: {
		maxResearchers: 2,
		maxWriters: 1,
		maxSearchRounds: 2,
		maxQueries: 8,
		maxFetchedUrls: 6,
		maxAcceptedSources: 10,
		maxVerifierRefetches: 3,
		maxCumulativeTokens: 70_000,
		workerThinking: "medium",
		allowReviewer: false,
		allowVerifier: true,
	},
	deep: {
		maxResearchers: 3,
		maxWriters: 1,
		maxSearchRounds: 2,
		maxQueries: 10,
		maxFetchedUrls: 10,
		maxAcceptedSources: 18,
		maxVerifierRefetches: 6,
		maxCumulativeTokens: 135_000,
		workerThinking: "medium",
		allowReviewer: true,
		allowVerifier: true,
	},
};

const COMPACTABLE_TOOL_NAMES = new Set([
	"web_search",
	"fetch_content",
	"get_search_content",
	"alpha_search",
	"alpha_fetch",
	"hf_dataset_info",
	"hf_repo_files",
	"hf_repo_read_file",
]);

const MAX_RETAINED_TOOL_RESULT_CHARS = 8_000;
const RECENT_MESSAGES_TO_KEEP = 6;

function boundedInteger(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, Math.floor(Number.isFinite(value) ? value : minimum)));
}

function effectiveMode(input: DeepResearchPolicyInput): DeepResearchMode {
	const materialDomains = new Set(input.domainTags.filter((tag) => tag !== "web-only" && tag !== "paper-search" && tag !== "unknown"));
	if (input.exhaustive || input.complexity === "deep" || input.questionCount >= 5 || materialDomains.size >= 3) return "deep";
	if (input.complexity === "standard" || input.questionCount >= 2 || input.entityCount >= 2 || materialDomains.size >= 2) return "standard";
	return "simple";
}

export function selectDeepResearchPolicy(input: DeepResearchPolicyInput): DeepResearchPolicy {
	const normalized = {
		...input,
		questionCount: boundedInteger(input.questionCount, 1, 12),
		entityCount: boundedInteger(input.entityCount, 1, 12),
		domainTags: [...new Set(input.domainTags)].slice(0, 6),
	};
	const mode = effectiveMode(normalized);
	const reason = input.reason.trim();
	const routeReason = mode === input.complexity ? reason : `${reason} Escalated to ${mode} by policy thresholds.`;
	return { mode, ...POLICY_BY_MODE[mode], domainTags: normalized.domainTags.length ? normalized.domainTags : ["unknown"], routeReason };
}

function textContent(message: AgentMessage): string {
	if (message.role !== "toolResult") return "";
	return message.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function compactText(text: string): string {
	if (text.length <= MAX_RETAINED_TOOL_RESULT_CHARS) return text;
	const head = text.slice(0, 5_000);
	const tail = text.slice(-2_000);
	return `${head}\n\n[Older tool output compacted by Deep Research. Reuse the stored response or fetch only a named missing passage.]\n\n${tail}`;
}

/**
 * Keeps the durable session intact while sending only bounded retrieval output
 * to later model calls. The full response remains available to get_search_content
 * or the on-disk evidence ledger, so this is context compaction rather than data loss.
 */
export function compactDeepResearchMessages(messages: AgentMessage[]): AgentMessage[] {
	let changed = false;
	const firstRecentIndex = Math.max(0, messages.length - RECENT_MESSAGES_TO_KEEP);
	const compacted = messages.map((message, index) => {
		if (index >= firstRecentIndex || message.role !== "toolResult" || !COMPACTABLE_TOOL_NAMES.has(message.toolName)) {
			return message;
		}
		const original = textContent(message);
		const compactedText = compactText(original);
		if (compactedText === original) return message;
		changed = true;
		return {
			...message,
			content: [{ type: "text" as const, text: compactedText }],
		};
	});
	return changed ? compacted : messages;
}

function queryCount(input: Record<string, unknown>): number {
	if (Array.isArray(input.queries)) {
		return input.queries.filter((query) => typeof query === "string" && query.trim()).length;
	}
	return typeof input.query === "string" && input.query.trim() ? 1 : 0;
}

function urlCount(input: Record<string, unknown>): number {
	if (Array.isArray(input.urls)) return input.urls.filter((url) => typeof url === "string" && url.trim()).length;
	return typeof input.url === "string" && input.url.trim() ? 1 : 0;
}

function researcherCount(input: Record<string, unknown>): number {
	if (typeof input.agent === "string") return input.agent === "researcher" ? 1 : 0;
	if (typeof input.workflowScript !== "string") return 0;
	return [...input.workflowScript.matchAll(/\bagent\s*:\s*["']researcher["']/g)].length || 1;
}

function writerCount(input: Record<string, unknown>): number {
	if (typeof input.agent === "string") return input.agent === "writer" ? 1 : 0;
	if (typeof input.workflowScript !== "string") return 0;
	return [...input.workflowScript.matchAll(/\bagent\s*:\s*["']writer["']/g)].length;
}

type RuntimeState = {
	active: boolean;
	policy: DeepResearchPolicy;
	queries: number;
	fetchedUrls: number;
	researchers: number;
	writers: number;
};

function defaultState(): RuntimeState {
	return {
		active: false,
		policy: selectDeepResearchPolicy({ complexity: "simple", questionCount: 1, entityCount: 1, domainTags: ["unknown"], reason: "Default until routing completes." }),
		queries: 0,
		fetchedUrls: 0,
		researchers: 0,
		writers: 0,
	};
}

const POLICY_PARAMETERS = Type.Object({
	complexity: Type.Union([
		Type.Literal("simple"),
		Type.Literal("standard"),
		Type.Literal("deep"),
	]),
	questionCount: Type.Integer({ minimum: 1, maximum: 12 }),
	entityCount: Type.Integer({ minimum: 1, maximum: 12 }),
	domainTags: Type.Array(Type.Union([
		Type.Literal("web-only"), Type.Literal("paper-search"), Type.Literal("bio"),
		Type.Literal("chem"), Type.Literal("genomics"), Type.Literal("unknown"),
	]), { minItems: 1, maxItems: 6 }),
	reason: Type.String({ minLength: 8, maxLength: 500 }),
	exhaustive: Type.Optional(Type.Boolean()),
});

export function registerDeepResearchPolicy(pi: ExtensionAPI): void {
	const state = defaultState();

	pi.on("session_start", () => {
		Object.assign(state, defaultState());
	});

	pi.on("before_agent_start", (event) => {
		const prompt = event.prompt.trim();
		const isDeepResearch = /(?:^|\s)\/deepresearch\b/i.test(prompt)
			|| /deep research/i.test(prompt)
			|| /run deep research for:/i.test(prompt);
		if (isDeepResearch) {
			state.active = true;
			state.queries = 0;
			state.fetchedUrls = 0;
			state.researchers = 0;
			state.writers = 0;
		} else if (state.active && !/^yes$/i.test(prompt)) {
			state.active = false;
		}
	});

	pi.on("context", (event) => {
		if (!state.active) return;
		const messages = compactDeepResearchMessages(event.messages);
		return messages === event.messages ? undefined : { messages };
	});

	pi.on("tool_call", (event) => {
		if (!state.active) return;

		if (event.toolName === "feynman_deepresearch_policy") return;

		if (event.toolName === "web_search") {
			const requestedQueries = queryCount(event.input);
			if (state.queries + requestedQueries > state.policy.maxQueries) {
				return {
					block: true,
					terminate: true,
					reason: `Deep Research query budget exhausted (${state.policy.maxQueries} queries). Continue from the evidence ledger or mark the gap blocked.`,
				};
			}
			state.queries += requestedQueries;
			if (event.input.includeContent === true) event.input.includeContent = false;
			return;
		}

		if (event.toolName === "fetch_content") {
			const requestedUrls = urlCount(event.input);
			if (state.fetchedUrls + requestedUrls > state.policy.maxFetchedUrls) {
				return {
					block: true,
					terminate: true,
					reason: `Deep Research fetch budget exhausted (${state.policy.maxFetchedUrls} URLs). Reuse stored passages or record the missing evidence.`,
				};
			}
			state.fetchedUrls += requestedUrls;
			return;
		}

		if (event.toolName === "subagent") {
			const requestedResearchers = researcherCount(event.input);
			if (state.researchers + requestedResearchers > state.policy.maxResearchers) {
				return {
					block: true,
					terminate: true,
					reason: `Deep Research researcher budget exhausted (${state.policy.maxResearchers}). Use the lead-owned path or the existing claim ledger.`,
				};
			}
			state.researchers += requestedResearchers;
			const requestedWriters = writerCount(event.input);
			if (state.writers + requestedWriters > state.policy.maxWriters) {
				return {
					block: true,
					terminate: true,
					reason: `Deep Research writer budget exhausted (${state.policy.maxWriters}). Use the existing compact draft or the lead-owned fallback.`,
				};
			}
			state.writers += requestedWriters;
		}
	});

	pi.registerTool({
		name: "feynman_deepresearch_policy",
		label: "Deep Research Policy",
		description: "Choose a bounded Deep Research execution policy before searching or delegating.",
		parameters: POLICY_PARAMETERS,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			state.active = true;
			state.policy = selectDeepResearchPolicy(params);
			return {
				content: [{ type: "text", text: JSON.stringify({ ...state.policy, currentContextTokens: ctx.getContextUsage()?.tokens ?? null }) }],
				details: state.policy,
			};
		},
	});
}
