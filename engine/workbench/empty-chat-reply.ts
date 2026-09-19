import type { WorkbenchChatMessage, WorkbenchChatStatus, WorkbenchToolEvent } from "./chat.js";
import { AXORBIS_ARTIFACT_ROOT } from "./artifact-roots.js";

const EMPTY_REPLY = "Feynman finished without text output.";

function successfulPlanWrite(event: WorkbenchToolEvent): { path: string; content: string } | undefined {
	if (event.toolName !== "write" || event.status !== "complete" || event.isError || !event.input) return undefined;
	let args: unknown;
	try { args = JSON.parse(event.input); } catch { return undefined; }
	if (!args || typeof args !== "object") return undefined;
	const { path, content } = args as { path?: unknown; content?: unknown };
	if (typeof path !== "string" || !/^(?:\.axorbis\/artifacts(?:\/projects\/[a-z0-9._-]+)?|outputs)\/\.plans\/[a-z0-9][a-z0-9-]{0,99}\.md$/u.test(path)) return undefined;
	return { path, content: typeof content === "string" ? content : "" };
}

type CompletedArtifactWrite = { path: string; content: string };

function completedArtifactWrite(event: WorkbenchToolEvent): CompletedArtifactWrite | undefined {
	if (event.toolName !== "write" || event.status !== "complete" || event.isError || !event.input) return undefined;
	let args: unknown;
	try { args = JSON.parse(event.input); } catch { return undefined; }
	if (!args || typeof args !== "object") return undefined;
	const { path, content } = args as { path?: unknown; content?: unknown };
	return typeof path === "string" && typeof content === "string" && content.trim()
		? { path, content }
		: undefined;
}

function isFinalReportWrite(write: CompletedArtifactWrite): boolean {
	return new RegExp(`^(?:${AXORBIS_ARTIFACT_ROOT.replace(".", "\\.")}(?:/projects/[a-z0-9._-]+)?|outputs|papers)/(?!\\.plans/|\\.drafts/).+\\.md$`, "u").test(write.path)
		&& !write.path.endsWith(".provenance.md");
}

function completedFinalWrite(event: WorkbenchToolEvent): boolean {
	const write = completedArtifactWrite(event);
	return Boolean(write && isFinalReportWrite(write));
}

function planQuestions(content: string): string[] {
	const section = content.match(/(?:^|\n)#{2,3}\s+Key Questions\s*\n([\s\S]*?)(?=\n#{2,3}\s+|$)/iu)?.[1];
	if (!section) return [];
	return [...section.matchAll(/^\s*\d+\.\s+(.+)$/gmu)].slice(0, 3).map((match) => match[1]!.trim().slice(0, 200));
}

function conciseReportSummary(content: string): string | undefined {
	const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n?/u, "").trim();
	const executive = withoutFrontmatter.match(/(?:^|\n)#{1,3}\s+(?:Executive )?Summary\s*\n([\s\S]*?)(?=\n#{1,3}\s+|$)/iu)?.[1];
	const candidate = (executive ?? withoutFrontmatter)
		.replace(/^#\s+.+$/mu, "")
		.split(/\n\s*\n/u)
		.map((paragraph) => paragraph.trim())
		.filter((paragraph) => paragraph && !/^#{1,6}\s/u.test(paragraph) && !/^[-*]\s/u.test(paragraph) && !/^\|/u.test(paragraph))
		.slice(0, 2)
		.join("\n\n");
	return candidate ? candidate.slice(0, 1_800).trim() : undefined;
}

function emptyFinalResearchReply(toolEvents: WorkbenchToolEvent[]): string | undefined {
	const writes = toolEvents.map(completedArtifactWrite).filter((item): item is CompletedArtifactWrite => Boolean(item));
	const finalReport = writes.find(isFinalReportWrite);
	if (!finalReport) return undefined;
	const paths = [...new Set(writes.map((write) => write.path))];
	const supporting = paths.filter((path) => path !== finalReport.path && !path.endsWith(".provenance.md"));
	const summary = conciseReportSummary(finalReport.content);
	return [
		"## Research synthesis",
		"",
		summary ?? "The final report was written, but it does not contain a readable executive summary. Open the report for the complete findings.",
		"",
		"## Files",
		"",
		`- Final report: \`${finalReport.path}\``,
		...paths.filter((path) => path.endsWith(".provenance.md")).map((path) => `- Provenance: \`${path}\``),
		...supporting.map((path) => `- Supporting artifact: \`${path}\``),
	].join("\n");
}

type PlanMessage = Pick<WorkbenchChatMessage, "role" | "status" | "content" | "toolEvents">;

function asksForPlanApproval(message: PlanMessage | undefined): boolean {
	return message?.role === "assistant" && message.status === "complete"
		&& (/Review the plan, then reply [‘'"]?yes/iu.test(message.content)
			|| /Proceed with this deep research plan\?/iu.test(message.content));
}

/** Find the plan awaiting approval, including sessions affected by the old
 * composer bug that sent `/deepresearch yes` as a new topic. */
export function pendingDeepResearchPlan(messages: PlanMessage[]): string | undefined {
	const completed = messages.filter((message) => message.status === "complete");
	let lastAssistantIndex = completed.length - 1;
	while (lastAssistantIndex >= 0 && completed[lastAssistantIndex]?.role !== "assistant") lastAssistantIndex--;
	if (lastAssistantIndex < 0) return undefined;
	let planMessage = completed[lastAssistantIndex];
	if (!asksForPlanApproval(planMessage)) {
		const priorUser = completed[lastAssistantIndex - 1];
		const priorAssistant = completed[lastAssistantIndex - 2];
		const misroutedApproval = planMessage?.role === "assistant"
			&& /The topic ["“]?yes["”]? is too vague for deep research/iu.test(planMessage.content)
			&& priorUser?.role === "user" && /^\/deepresearch\s+yes\s*$/iu.test(priorUser.content);
		if (!misroutedApproval || !asksForPlanApproval(priorAssistant)) return undefined;
		planMessage = priorAssistant;
	}
	return planMessage?.toolEvents.map(successfulPlanWrite).find((item) => item !== undefined)?.path;
}

export function isDeepResearchApproval(message: string): boolean {
	return /^(?:\/deepresearch\s+)?(?:yes|y|ok|proceed|đồng ý)\s*$/iu.test(message.trim());
}

/** A model can stop after tool calls with an empty final message. Never report
 * that as a normal answer; preserve the useful plan/approval state if present. */
export function resolveEmptyWorkbenchReply(
	userMessage: string,
	toolEvents: WorkbenchToolEvent[],
	status: WorkbenchChatStatus,
): { content: string; status: WorkbenchChatStatus } {
	if (status === "stopped") return { content: "Research stopped before a reply was generated.", status };
	if (status === "error") return { content: "The model failed without an error description. Check the model in Settings → AI Providers and try again.", status };
	const isDeepResearch = /^\/deepresearch(?:\s|$)/iu.test(userMessage.trimStart());
	const hasEvidenceWork = toolEvents.some((event) => event.toolName && event.toolName !== "write");
	const plan = isDeepResearch && !hasEvidenceWork && !toolEvents.some(completedFinalWrite)
		? toolEvents.map(successfulPlanWrite).find((item) => item !== undefined)
		: undefined;
	if (plan) {
		const questions = planQuestions(plan.content);
		return {
			content: [
				`Research plan saved to ${plan.path}.`,
				...(questions.length ? [`Key questions: ${questions.join("; ")}`] : []),
				"Review the plan, then reply ‘yes’ to continue or tell me what to change.",
			].join("\n"),
			status: "complete",
		};
	}
	const finalResearchReply = emptyFinalResearchReply(toolEvents);
	if (finalResearchReply) return { content: finalResearchReply, status: "complete" };
	return {
		content: `${EMPTY_REPLY} The model completed ${toolEvents.length} research step${toolEvents.length === 1 ? "" : "s"} but did not generate a reply. Check the generated files and retry, or select another model in Settings → AI Providers.`,
		status: "error",
	};
}

/** Repair the old generic placeholder when a saved transcript has a plan. */
export function isLegacyEmptyWorkbenchReply(content: string): boolean {
	return content.trim() === EMPTY_REPLY;
}
