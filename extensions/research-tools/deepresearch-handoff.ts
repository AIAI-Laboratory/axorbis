import { readFileSync, realpathSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { validateResearcherHandoff, validateReviewHandoff, validateVerifiedHandoff } from "./deepresearch-handoff-validator.js";

function safePath(cwd: string, path: string, suffix: string): string {
	const full = resolve(cwd, path);
	const rel = relative(cwd, full);
	if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || extname(full) !== suffix || !rel.split(/[\\/]/).includes(".drafts")) {
		throw new Error(`Expected a workspace .drafts ${suffix} path`);
	}
	const realRelative = relative(realpathSync(cwd), realpathSync(full));
	if (isAbsolute(realRelative) || realRelative === ".." || realRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error("Handoff path leaves the workspace");
	return full;
}

export function registerDeepResearchHandoffTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "feynman_deepresearch_handoff",
		label: "Deep Research Handoff",
		description: "Validate structured Deep Research summaries against durable evidence or review artifacts without loading full artifacts into model context.",
		parameters: Type.Object({
			kind: Type.Union([Type.Literal("researcher"), Type.Literal("reviewer")]),
			fullPath: Type.String({ description: "Workspace-relative evidence JSONL or full review Markdown path." }),
			summaryPath: Type.String({ description: "Workspace-relative structured summary JSON path." }),
			verifiedPath: Type.Optional(Type.String({ description: "Workspace-relative verified summary JSON path." })),
			citedPath: Type.Optional(Type.String({ description: "Workspace-relative cited draft Markdown path, required for reviewer handoffs." })),
		}),
		async execute(_id, params, _signal, _update, ctx) {
			const fullPath = safePath(ctx.cwd, params.fullPath, params.kind === "researcher" ? ".jsonl" : ".md");
			const summaryPath = safePath(ctx.cwd, params.summaryPath, ".json");
			const full = readFileSync(fullPath, "utf8");
			const summary = readFileSync(summaryPath, "utf8");
			if (params.kind === "reviewer" && !params.citedPath) throw new Error("citedPath is required for reviewer handoffs");
			const result = params.kind === "researcher"
				? validateResearcherHandoff(full, summary)
				: validateReviewHandoff(full, summary, readFileSync(safePath(ctx.cwd, params.citedPath!, ".md"), "utf8"));
			if (params.verifiedPath) {
				if (params.kind !== "researcher") throw new Error("verifiedPath is only valid for researcher handoffs");
				Object.assign(result, validateVerifiedHandoff(summary, readFileSync(safePath(ctx.cwd, params.verifiedPath, ".json"), "utf8")));
			}
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	});
}
