import assert from "node:assert/strict";
import test from "node:test";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { compactDeepResearchMessages, selectDeepResearchPolicy } from "../extensions/research-tools/deepresearch-policy.js";

function toolResult(toolName: string, text: string): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: `${toolName}-1`,
		toolName,
		isError: false,
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

test("deep research policy routes conservative workloads without researcher fan-out", () => {
	const direct = selectDeepResearchPolicy({ breadth: "direct", questionCount: 1, entityCount: 1, domainCount: 1 });
	assert.equal(direct.mode, "direct");
	assert.equal(direct.maxResearchers, 0);
	assert.equal(direct.maxWriters, 0);
	assert.equal(direct.maxCumulativeTokens, 45_000);

	const complex = selectDeepResearchPolicy({ breadth: "broad", questionCount: 8, entityCount: 4, domainCount: 4 });
	assert.equal(complex.mode, "complex");
	assert.equal(complex.maxResearchers, 3);
	assert.equal(complex.maxWriters, 1);
	assert.equal(complex.allowReviewer, true);
});

test("deep research policy escalates comparison requests with multiple entities", () => {
	const policy = selectDeepResearchPolicy({ breadth: "direct", questionCount: 1, entityCount: 3, domainCount: 1 });
	assert.equal(policy.mode, "comparison");
	assert.equal(policy.maxResearchers, 1);
});

test("deep research context compaction bounds old retrieval results and preserves recent context", () => {
	const long = "a".repeat(20_000);
	const messages: AgentMessage[] = [
		toolResult("fetch_content", long),
		...Array.from({ length: 5 }, (_, index) => ({ role: "user", content: `step ${index}`, timestamp: Date.now() } as AgentMessage)),
		toolResult("fetch_content", long),
	];

	const compacted = compactDeepResearchMessages(messages);
	assert.equal(compacted.length, messages.length);
	assert.ok(compacted[0]?.role === "toolResult");
	assert.ok(compacted[0].content[0]?.type === "text");
	const firstContent = compacted[0].role === "toolResult" ? compacted[0].content[0] : undefined;
	assert.ok(firstContent?.type === "text");
	assert.ok((firstContent?.type === "text" ? firstContent.text.length : Infinity) < long.length);
	assert.equal(compacted.at(-1)?.role, "toolResult");
	assert.equal((compacted.at(-1) as Extract<AgentMessage, { role: "toolResult" }>).content[0]?.type, "text");
	assert.equal(
		(compacted.at(-1) as Extract<AgentMessage, { role: "toolResult" }>).content[0]?.type === "text"
			? ((compacted.at(-1) as Extract<AgentMessage, { role: "toolResult" }>).content[0] as Extract<(Extract<AgentMessage, { role: "toolResult" }>)['content'][number], { type: "text" }>).text.length
			: 0,
		long.length,
	);
});
