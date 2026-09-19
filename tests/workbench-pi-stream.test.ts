import test from "node:test";
import assert from "node:assert/strict";

import { handlePiJsonLine } from "../engine/workbench/chat-runtime.js";
import { resolveEmptyWorkbenchReply } from "../engine/workbench/empty-chat-reply.js";

test("workbench Pi RPC stream accepts Pi 0.84 delta-only message updates", async () => {
	const toolEvents = new Map();
	const updates: Array<{ contentDelta?: string; status?: string }> = [];
	for (const delta of ["partial ", "answer"]) {
		await handlePiJsonLine(JSON.stringify({
			type: "message_update",
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 0,
				delta,
			},
		}), toolEvents, (update) => {
			updates.push(update);
		});
	}

	assert.deepEqual(updates, [
		{ contentDelta: "partial ", status: "running", toolEvents: [] },
		{ contentDelta: "answer", status: "running", toolEvents: [] },
	]);
});

test("workbench Pi RPC stream preserves provider errors from assistant messages", async () => {
	const toolEvents = new Map();
	const updates: Array<{ content?: string; status?: string }> = [];
	await handlePiJsonLine(JSON.stringify({
		type: "message_end",
		message: {
			role: "assistant",
			content: [],
			stopReason: "error",
			errorMessage: "Model gemini-2.5-flash-lite is not available for this API key.",
		},
	}), toolEvents, (update) => {
		updates.push(update);
	});

	assert.deepEqual(updates, [{
		content: "Model gemini-2.5-flash-lite is not available for this API key.",
		status: "error",
		toolEvents: [],
	}]);
});

test("empty deep research turn returns its plan and asks for approval", () => {
	const reply = resolveEmptyWorkbenchReply("/deepresearch tìm kiếm", [{
		id: "write-1",
		label: "write",
		toolName: "write",
		status: "complete",
		input: JSON.stringify({
			path: "outputs/.plans/tim-kiem.md",
			content: "## Plan\n### Key Questions\n1. What should be found?\n2. Which sources matter?\n### Evidence Needed\n",
		}),
	}], "complete");
	assert.equal(reply.status, "complete");
	assert.match(reply.content, /outputs\/\.plans\/tim-kiem\.md/);
	assert.match(reply.content, /What should be found/);
	assert.match(reply.content, /reply ‘yes’/);
});

test("empty assistant turn without a plan is reported as an error", () => {
	const reply = resolveEmptyWorkbenchReply("Find sources", [], "complete");
	assert.equal(reply.status, "error");
	assert.match(reply.content, /did not generate a reply/);
});

test("empty completed deep research turn returns a synthesis and openable artifact paths", () => {
	const reply = resolveEmptyWorkbenchReply("yes", [{
		id: "write-report",
		label: "write",
		toolName: "write",
		status: "complete",
		input: JSON.stringify({
			path: "outputs/temporal-kg.md",
			content: "# Temporal knowledge graph\n\n## Executive Summary\n\nTemporal relations improve the graph's ability to distinguish events that share entities but occur at different times.\n\n## Findings\n\n- Detail",
		}),
	}, {
		id: "write-provenance",
		label: "write",
		toolName: "write",
		status: "complete",
		input: JSON.stringify({ path: "outputs/temporal-kg.provenance.md", content: "# Provenance" }),
	}], "complete");
	assert.equal(reply.status, "complete");
	assert.match(reply.content, /Research synthesis/);
	assert.match(reply.content, /Temporal relations improve/);
	assert.match(reply.content, /`outputs\/temporal-kg\.md`/);
	assert.match(reply.content, /`outputs\/temporal-kg\.provenance\.md`/);
});
