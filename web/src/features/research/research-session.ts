import type { WorkbenchChatSession, WorkbenchState } from "../../app/types.js";
import { isTerminalChatStreamEvent, parseStreamChunk, patchLastAssistant, upsertAssistantTool, type WorkbenchChatStreamEvent } from "../chat/stream.js";

export type ResearchMode = "ask" | "deep" | "lit" | "review" | "summarize" | "compare" | "audit" | "draft" | "recipe" | "replicate" | "autoresearch" | "watch";

export const MODE_LABELS: Record<ResearchMode, string> = {
	ask: "Ask",
	deep: "Deep research",
	lit: "Literature review",
	review: "Review",
	summarize: "Summarize",
	compare: "Compare",
	audit: "Audit",
	draft: "Draft",
	recipe: "Recipe",
	replicate: "Replicate",
	autoresearch: "Auto research",
	watch: "Watch",
};

const MODE_COMMANDS: Record<ResearchMode, string | null> = {
	ask: null,
	deep: "deepresearch",
	lit: "lit",
	review: "review",
	summarize: "summarize",
	compare: "compare",
	audit: "audit",
	draft: "draft",
	recipe: "recipe",
	replicate: "replicate",
	autoresearch: "autoresearch",
	watch: "watch",
};

/** The reply after a Deep Research plan is a continuation, not a new /deepresearch topic. */
export function awaitingDeepResearchApproval(session: WorkbenchChatSession | null): boolean {
	const messages = session?.messages ?? [];
	const latest = messages.at(-1);
	const isApprovalPrompt = (content: string | undefined) => Boolean(content &&
		(/Review the plan, then reply [‘'"]?yes/iu.test(content)
			|| /Proceed with this deep research plan\?/iu.test(content)));
	if (latest?.role === "assistant" && latest.status === "complete" && isApprovalPrompt(latest.content)) return true;
	return latest?.role === "assistant" && latest.status === "complete"
		&& /The topic ["“]?yes["”]? is too vague for deep research/iu.test(latest.content)
		&& /^\/deepresearch\s+yes\s*$/iu.test(messages.at(-2)?.content ?? "")
		&& isApprovalPrompt(messages.at(-3)?.content);
}

export function researchMessageForSubmission(text: string, mode: ResearchMode, continuePlan: boolean, questionTitle?: string): string {
	if (continuePlan) return text.replace(/^\/deepresearch\s+(?=(?:yes|y|ok|proceed|đồng ý)\s*$)/iu, "");
	if (text.startsWith("/")) return text;
	const command = MODE_COMMANDS[mode];
	if (!command) return text;
	const question = questionTitle?.trim() || text;
	const instruction = text.trim();
	return `/${command} ${question}${instruction && instruction !== question ? `\n\nAdditional instruction: ${instruction}` : ""}`;
}

/**
 * In desktop development the React app is served by Vite while the authenticated
 * research API stays on its ephemeral local Feynman port. Production keeps the
 * same-origin path, so no auth URL is exposed outside the local desktop process.
 */
let cachedBackend: string | null = null;

/**
 * Keep the local backend capability when client-side routing changes pages in
 * desktop development. The backend's ephemeral URL is intentionally passed
 * only through the initial redirect, so a bare history entry would otherwise
 * make subsequent `/api` requests hit Vite instead of Feynman.
 */
export function workbenchNavigationPath(path: string): string {
	const target = new URL(path, window.location.origin);
	const current = new URLSearchParams(window.location.search);
	const backend = current.get("backend") || cachedBackend;
	if (backend) target.searchParams.set("backend", backend);
	return `${target.pathname}${target.search}${target.hash}`;
}

export function workbenchApiUrl(path: string): string {
	const search = new URLSearchParams(window.location.search);
	const backend = search.get("backend") || cachedBackend;
	if (search.has("backend")) cachedBackend = search.get("backend");

	if (!backend) return path;
	try {
		const base = new URL(backend);
		if (base.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(base.hostname)) return path;
		// WebKit can reject a direct authenticated localhost request after the
		// desktop window changes origins. Keep browser requests same-origin and
		// let the Vite development server relay them to the local backend.
		const separator = path.includes("?") ? "&" : "?";
		return `/app-shell/__feynman_proxy__${path}${separator}backend=${encodeURIComponent(base.toString())}`;
	} catch {
		return path;
	}
}

export async function apiJson<T>(url: string, body?: Record<string, unknown>): Promise<T> {
	const response = await fetch(workbenchApiUrl(url), body ? {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	} : undefined);

	let payload: any = {};
	const text = await response.text();
	if (text) {
		try {
			payload = JSON.parse(text);
		} catch (error) {
			if (!response.ok) {
				throw new Error(`Request failed (${response.status}): ${text.slice(0, 100)}`);
			}
			throw error;
		}
	}

	if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
	return payload as T & { error?: string };
}

type SessionCallbacks = {
	onSession: (update: (current: WorkbenchChatSession | null) => WorkbenchChatSession | null) => void;
	onState: (state: WorkbenchState) => void;
};

export async function streamResearchMessage(
	input: { sessionId: string; projectId: string; title: string; text: string; mode: ResearchMode; questionTitle?: string; continuePlan?: boolean },
	callbacks: SessionCallbacks,
): Promise<void> {
	const message = researchMessageForSubmission(input.text, input.mode, input.continuePlan === true, input.questionTitle);
	const response = await fetch(workbenchApiUrl("/api/chat/message/stream"), {
		method: "POST",
		headers: { accept: "text/event-stream", "content-type": "application/json" },
		body: JSON.stringify({ sessionId: input.sessionId, projectId: input.projectId, title: input.title, message }),
	});
	if (!response.ok || !response.body) throw new Error(await response.text() || `Research request failed (${response.status})`);

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let terminal = false;
	let streamError: string | null = null;
	const applyEvent = (event: WorkbenchChatStreamEvent) => {
		if (isTerminalChatStreamEvent(event)) terminal = true;
		if (event.type === "session" || event.type === "done" || event.type === "error") {
			if (event.session) callbacks.onSession(() => event.session!);
			if ((event.type === "done" || event.type === "error") && event.state) callbacks.onState(event.state);
			if (event.type === "error") streamError = event.message || "Research failed";
		} else if (event.type === "delta") {
			callbacks.onSession((current) => current ? patchLastAssistant(current, { content: event.content, status: "running" }) : current);
		} else if (event.type === "tool") {
			callbacks.onSession((current) => current ? upsertAssistantTool(current, event.toolEvent) : current);
		}
	};
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer = parseStreamChunk(buffer + decoder.decode(value, { stream: true }), applyEvent);
	}
	parseStreamChunk(buffer + decoder.decode(), applyEvent);
	if (streamError) throw new Error(streamError);
	if (!terminal) throw new Error("Research stream ended before completion.");
}
