import type { WorkbenchArtifact, WorkbenchProject, WorkbenchResearchClaim, WorkbenchRun, WorkbenchState } from "../../app/types.js";

export function projectQuestions(state: WorkbenchState, project: WorkbenchProject): WorkbenchRun[] {
	const slugs = new Set(project.runSlugs);
	return state.runs
		.filter((run) => run.source === "chat" && (run.projectId === project.id || slugs.has(run.slug)))
		.filter((run) => run.title !== project.name || run.artifactCount > 0)
		.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export function projectArtifacts(state: WorkbenchState, project: WorkbenchProject): WorkbenchArtifact[] {
	const paths = new Set(project.artifactPaths);
	const slugs = new Set(project.runSlugs);
	return state.artifacts.filter((artifact) => paths.has(artifact.path) || slugs.has(artifact.slug));
}

export function questionClaims(state: WorkbenchState, run: WorkbenchRun): WorkbenchResearchClaim[] {
	return state.claims.filter((claim) => claim.runSlug === run.slug || claim.sessionId === run.slug);
}

export function questionArtifacts(state: WorkbenchState, run: WorkbenchRun): WorkbenchArtifact[] {
	const paths = new Set(run.artifactPaths ?? []);
	return state.artifacts.filter((artifact) => artifact.slug === run.slug || paths.has(artifact.path));
}

export function researchPath(projectId: string, runSlug?: string): string {
	const projectPath = `/projects/${encodeURIComponent(projectId)}`;
	return runSlug ? `${projectPath}/questions/${encodeURIComponent(runSlug)}` : projectPath;
}
