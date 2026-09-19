import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkbenchRpcPrompt } from "../engine/workbench/chat-runtime.js";
import { pendingDeepResearchPlan } from "../engine/workbench/empty-chat-reply.js";
import type { WorkbenchChatMessage, WorkbenchPromptRequest } from "../engine/workbench/chat.js";
import { awaitingDeepResearchApproval, researchMessageForSubmission, workbenchApiUrl, workbenchNavigationPath } from "../web/src/features/research/research-session.js";
import type { WorkbenchChatSession } from "../web/src/app/types.js";

const planMessage: WorkbenchChatMessage = {
	id: "plan",
	role: "assistant",
	status: "complete",
	createdAt: "2026-09-18T00:00:00.000Z",
	content: "Research plan saved to .axorbis/artifacts/projects/temporal-kg/.plans/temporal-kg.md.\nReview the plan, then reply ‘yes’ to continue or tell me what to change.",
	toolEvents: [{
		id: "write-plan",
		label: "write",
		toolName: "write",
		status: "complete",
		input: JSON.stringify({ path: ".axorbis/artifacts/projects/temporal-kg/.plans/temporal-kg.md", content: "## Plan" }),
	}],
};

test("Deep Research mode sends plan confirmation without creating a new command", () => {
	const session = { messages: [planMessage] } as WorkbenchChatSession;
	assert.equal(awaitingDeepResearchApproval(session), true);
	assert.equal(researchMessageForSubmission("yes", "deep", true), "yes");
	assert.equal(researchMessageForSubmission("/deepresearch yes", "deep", true), "yes");
	assert.equal(researchMessageForSubmission("new topic", "deep", false), "/deepresearch new topic");
	assert.equal(researchMessageForSubmission("", "deep", false, "Can temporal knowledge graphs generalize?"), "/deepresearch Can temporal knowledge graphs generalize?");
	assert.equal(researchMessageForSubmission("Focus on benchmarks", "lit", false, "Can temporal knowledge graphs generalize?"), "/lit Can temporal knowledge graphs generalize?\n\nAdditional instruction: Focus on benchmarks");

	const request = { message: "yes", session: { messages: [planMessage] } } as WorkbenchPromptRequest;
	assert.equal(pendingDeepResearchPlan(request.session.messages), ".axorbis/artifacts/projects/temporal-kg/.plans/temporal-kg.md");
	assert.match(buildWorkbenchRpcPrompt(request), /explicitly approves the Deep Research plan at \.axorbis\/artifacts\/projects\/temporal-kg\/\.plans\/temporal-kg\.md/);
});

test("a misrouted /deepresearch yes can still approve the previous plan", () => {
	const messages = [
		planMessage,
		{ id: "wrong-user", role: "user", status: "complete", content: "/deepresearch yes", createdAt: "2026-09-18T00:00:01.000Z", toolEvents: [] },
		{ id: "wrong-reply", role: "assistant", status: "complete", content: "The topic \"yes\" is too vague for deep research. Please provide a more specific topic.", createdAt: "2026-09-18T00:00:02.000Z", toolEvents: [] },
	] as WorkbenchChatMessage[];
	assert.equal(awaitingDeepResearchApproval({ messages } as WorkbenchChatSession), true);
	assert.equal(pendingDeepResearchPlan(messages), ".axorbis/artifacts/projects/temporal-kg/.plans/temporal-kg.md");
	const request = { message: "/deepresearch yes", session: { messages } } as WorkbenchPromptRequest;
	assert.match(buildWorkbenchRpcPrompt(request), /explicitly approves the Deep Research plan/);
});

test("desktop navigation preserves the development backend URL", () => {
	const originalWindow = globalThis.window;
	const location = { origin: "http://127.0.0.1:1420", search: "?backend=http%3A%2F%2F127.0.0.1%3A43123%3Ftoken%3Dsecret" };
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: { location },
	});
	try {
		assert.equal(
			workbenchNavigationPath("/projects/temporal-kg/questions/research?artifact=outputs%2Fbrief.md#sources"),
			"/projects/temporal-kg/questions/research?artifact=outputs%2Fbrief.md&backend=http%3A%2F%2F127.0.0.1%3A43123%3Ftoken%3Dsecret#sources",
		);
		const proxiedApi = workbenchApiUrl("/api/state");
		location.search = "";
		assert.equal(workbenchApiUrl("/api/state"), proxiedApi);
	} finally {
		Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
	}
});
