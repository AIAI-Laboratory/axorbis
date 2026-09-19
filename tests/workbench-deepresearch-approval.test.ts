import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkbenchRpcPrompt } from "../engine/workbench/chat-runtime.js";
import { pendingDeepResearchPlan } from "../engine/workbench/empty-chat-reply.js";
import type { WorkbenchChatMessage, WorkbenchPromptRequest } from "../engine/workbench/chat.js";
import { awaitingDeepResearchApproval, researchMessageForSubmission } from "../web/src/features/research/research-session.js";
import type { WorkbenchChatSession } from "../web/src/app/types.js";

const planMessage: WorkbenchChatMessage = {
	id: "plan",
	role: "assistant",
	status: "complete",
	createdAt: "2026-09-18T00:00:00.000Z",
	content: "Research plan saved to outputs/.plans/temporal-kg.md.\nReview the plan, then reply ‘yes’ to continue or tell me what to change.",
	toolEvents: [{
		id: "write-plan",
		label: "write",
		toolName: "write",
		status: "complete",
		input: JSON.stringify({ path: "outputs/.plans/temporal-kg.md", content: "## Plan" }),
	}],
};

test("Deep Research mode sends plan confirmation without creating a new command", () => {
	const session = { messages: [planMessage] } as WorkbenchChatSession;
	assert.equal(awaitingDeepResearchApproval(session), true);
	assert.equal(researchMessageForSubmission("yes", "deep", true), "yes");
	assert.equal(researchMessageForSubmission("/deepresearch yes", "deep", true), "yes");
	assert.equal(researchMessageForSubmission("new topic", "deep", false), "/deepresearch new topic");

	const request = { message: "yes", session: { messages: [planMessage] } } as WorkbenchPromptRequest;
	assert.equal(pendingDeepResearchPlan(request.session.messages), "outputs/.plans/temporal-kg.md");
	assert.match(buildWorkbenchRpcPrompt(request), /explicitly approves the Deep Research plan at outputs\/\.plans\/temporal-kg\.md/);
});

test("a misrouted /deepresearch yes can still approve the previous plan", () => {
	const messages = [
		planMessage,
		{ id: "wrong-user", role: "user", status: "complete", content: "/deepresearch yes", createdAt: "2026-09-18T00:00:01.000Z", toolEvents: [] },
		{ id: "wrong-reply", role: "assistant", status: "complete", content: "The topic \"yes\" is too vague for deep research. Please provide a more specific topic.", createdAt: "2026-09-18T00:00:02.000Z", toolEvents: [] },
	] as WorkbenchChatMessage[];
	assert.equal(awaitingDeepResearchApproval({ messages } as WorkbenchChatSession), true);
	assert.equal(pendingDeepResearchPlan(messages), "outputs/.plans/temporal-kg.md");
	const request = { message: "/deepresearch yes", session: { messages } } as WorkbenchPromptRequest;
	assert.match(buildWorkbenchRpcPrompt(request), /explicitly approves the Deep Research plan/);
});
