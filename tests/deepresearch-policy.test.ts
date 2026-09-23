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

test("deep research policy routes one focused question to researcher and writer", () => {
	const simple = selectDeepResearchPolicy({ complexity: "simple", questionCount: 1, entityCount: 1, domainTags: ["bio"], reason: "One focused biology question." });
	assert.equal(simple.mode, "simple");
	assert.equal(simple.maxResearchers, 1);
	assert.equal(simple.maxWriters, 1);
	assert.equal(simple.allowVerifier, false);
	assert.equal(simple.allowReviewer, false);
	assert.deepEqual(simple.domainTags, ["bio"]);
	assert.equal(simple.maxCumulativeTokens, 45_000);

	const deep = selectDeepResearchPolicy({ complexity: "deep", questionCount: 8, entityCount: 4, domainTags: ["bio", "chem", "genomics"], reason: "Eight questions across three specialist domains." });
	assert.equal(deep.mode, "deep");
	assert.equal(deep.maxResearchers, 3);
	assert.equal(deep.maxWriters, 1);
	assert.equal(deep.allowVerifier, true);
	assert.equal(deep.allowReviewer, true);
});

test("deep research policy escalates a comparison labeled simple", () => {
	const policy = selectDeepResearchPolicy({ complexity: "simple", questionCount: 1, entityCount: 3, domainTags: ["paper-search"], reason: "Comparison of three methods." });
	assert.equal(policy.mode, "standard");
	assert.equal(policy.maxResearchers, 2);
	assert.equal(policy.allowVerifier, true);
	assert.match(policy.routeReason, /Escalated to standard/);
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
