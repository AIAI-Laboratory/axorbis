import type { WorkbenchChatSession, WorkbenchState } from "../../app/types.js";
import { isTerminalChatStreamEvent, parseStreamChunk, patchLastAssistant, upsertAssistantTool, type WorkbenchChatStreamEvent } from "../chat/stream.js";

export type ResearchMode = "ask" | "deep";

export async function apiJson<T>(url: string, body?: Record<string, string>): Promise<T> {
	const response = await fetch(url, body ? {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	} : undefined);
	const payload = await response.json() as T & { error?: string };
	if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
	return payload;
}

type SessionCallbacks = {
	onSession: (update: (current: WorkbenchChatSession | null) => WorkbenchChatSession | null) => void;
	onState: (state: WorkbenchState) => void;
};

export async function streamResearchMessage(
	input: { sessionId: string; projectId: string; title: string; text: string; mode: ResearchMode },
	callbacks: SessionCallbacks,
): Promise<void> {
	const message = input.mode === "deep" && !input.text.startsWith("/")
		? `/deepresearch ${input.text}`
		: input.text;
	const response = await fetch("/api/chat/message/stream", {
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
