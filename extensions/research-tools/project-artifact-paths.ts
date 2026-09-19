import { isAbsolute, relative, resolve, sep } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { AXORBIS_ARTIFACT_ROOT } from "../../engine/workbench/artifact-roots.js";

function activeProjectArtifactRoot(): string | undefined {
	const root = process.env.AXORBIS_PROJECT_ARTIFACT_ROOT?.trim().replace(/^\/+|\/+$/g, "");
	return root?.startsWith(`${AXORBIS_ARTIFACT_ROOT}/projects/`) ? root : undefined;
}

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function normalizedWorkspacePath(cwd: string, path: string): { absolute: boolean; path: string } | undefined {
	const absolute = isAbsolute(path);
	const relativePath = toPosixPath(relative(cwd, resolve(cwd, path))).replace(/^\.\//, "");
	if (!relativePath || relativePath === ".." || relativePath.startsWith("../")) return undefined;
	return { absolute, path: relativePath };
}

export function redirectedArtifactPath(cwd: string, path: string, projectRoot: string): string | undefined {
	const normalized = normalizedWorkspacePath(cwd, path);
	if (!normalized) return undefined;
	const { absolute, path: relativePath } = normalized;
	if (relativePath === projectRoot || relativePath.startsWith(`${projectRoot}/`)) return undefined;

	let suffix: string | undefined;
	if (relativePath === AXORBIS_ARTIFACT_ROOT || relativePath.startsWith(`${AXORBIS_ARTIFACT_ROOT}/`)) {
		const projectPrefix = `${AXORBIS_ARTIFACT_ROOT}/projects/`;
		if (relativePath.startsWith(projectPrefix)) {
			const projectRelative = relativePath.slice(projectPrefix.length);
			const separator = projectRelative.indexOf("/");
			// A path already rooted at this project is safe. A path rooted at a
			// different project is rehomed using only its artifact-relative suffix.
			const currentProject = projectRoot.slice(projectPrefix.length).replace(/\/+$/, "");
			const requestedProject = separator === -1 ? projectRelative : projectRelative.slice(0, separator);
			if (requestedProject === currentProject) return undefined;
			suffix = separator === -1 ? "" : projectRelative.slice(separator + 1);
		} else {
			suffix = relativePath.slice(AXORBIS_ARTIFACT_ROOT.length).replace(/^\/+/, "");
		}
	} else if (relativePath.startsWith("outputs/")) {
		suffix = relativePath.slice("outputs/".length);
	} else if (relativePath.startsWith("papers/")) {
		suffix = `.papers/${relativePath.slice("papers/".length)}`;
	} else if (relativePath.startsWith("notes/")) {
		suffix = `.notes/${relativePath.slice("notes/".length)}`;
	}
	if (!suffix) return undefined;
	const target = `${projectRoot}/${suffix}`;
	return absolute ? resolve(cwd, target) : target;
}

/**
 * Pi's stock write and edit tools have normal workspace permissions. During a
 * workbench question, redirect their legacy/generic research destinations to
 * that question's project directory before the tools execute.
 */
export function registerProjectArtifactPathGuard(pi: ExtensionAPI): void {
	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
		const input = event.input as { path?: unknown };
		if (typeof input.path !== "string") return undefined;
		const projectRoot = activeProjectArtifactRoot();
		if (!projectRoot) return undefined;
		const redirected = redirectedArtifactPath(ctx.cwd, input.path, projectRoot);
		if (!redirected) return undefined;
		input.path = redirected;
		return undefined;
	});
}
