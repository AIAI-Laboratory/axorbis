import { existsSync, lstatSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { deleteWorkbenchChatSession, listWorkbenchChatSessions } from "./chat.js";
import { removeWorkbenchArtifactActions } from "./artifact-actions.js";
import { isWorkbenchArtifactPath } from "./artifact-roots.js";
import { isInsideDirectory, resolveWorkbenchStoredPath } from "./data-root.js";
import { removeWorkbenchQuestionFromProject, setWorkbenchQuestionArchived } from "./projects.js";
import { buildWorkbenchState } from "./scan.js";

export type WorkbenchQuestionAction = "archive" | "restore" | "delete";

export function archiveWorkbenchQuestion(input: { workingDir: string; projectId: string; runSlug: string; archived: boolean }): void {
	setWorkbenchQuestionArchived(input.workingDir, {
		projectId: input.projectId,
		runSlug: input.runSlug,
		archived: input.archived,
	});
}

function removeArtifactFile(workingDir: string, artifactPath: string): void {
	const relativePath = artifactPath.replaceAll("\\", "/").replace(/^\/+/, "");
	if (!isWorkbenchArtifactPath(relativePath)) return;
	const absolutePath = resolveWorkbenchStoredPath(workingDir, relativePath);
	if (!isInsideDirectory(resolve(workingDir), absolutePath) || !existsSync(absolutePath)) return;
	try {
		if (lstatSync(absolutePath).isFile()) rmSync(absolutePath, { force: true });
	} catch {
		// A stale or concurrently removed artifact should not prevent question deletion.
	}
}

export function deleteWorkbenchQuestion(input: {
	workingDir: string;
	projectId: string;
	runSlug: string;
	sessionDir?: string;
}): void {
	const state = buildWorkbenchState({ workingDir: input.workingDir });
	const project = state.projects.find((item) => item.id === input.projectId);
	if (!project || project.kind !== "custom") throw new Error("Project was not found.");
	const run = state.runs.find((item) => item.slug === input.runSlug && (item.projectId === input.projectId || project.runSlugs.includes(item.slug)));
	const artifactPaths = new Set([
		...(run?.artifactPaths ?? []),
		...state.artifacts.filter((artifact) => artifact.slug === input.runSlug && (run?.artifactPaths?.includes(artifact.path) ?? true)).map((artifact) => artifact.path),
	]);
	for (const artifactPath of artifactPaths) removeArtifactFile(input.workingDir, artifactPath);
	removeWorkbenchArtifactActions(input.workingDir, artifactPaths);

	const session = listWorkbenchChatSessions({ workingDir: input.workingDir }).find((item) => item.id === input.runSlug);
	if (session?.piSession.path && input.sessionDir) {
		const piPath = resolveWorkbenchStoredPath(input.workingDir, session.piSession.path);
		if (isInsideDirectory(input.sessionDir, piPath)) rmSync(piPath, { force: true });
	}
	deleteWorkbenchChatSession({ workingDir: input.workingDir, sessionDir: input.sessionDir }, input.runSlug);
	removeWorkbenchQuestionFromProject(input.workingDir, input.projectId, input.runSlug);
}
