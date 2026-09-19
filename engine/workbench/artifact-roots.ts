/**
 * Durable research files are kept out of the workspace root.  The legacy
 * public folders remain readable so existing projects continue to work, but
 * new Axorbis work is always written below this root.
 */
export const AXORBIS_ARTIFACT_ROOT = ".axorbis/artifacts";
export const AXORBIS_ARTIFACT_ROOT_PREFIX = `${AXORBIS_ARTIFACT_ROOT}/`;
export const AXORBIS_PROJECT_ARTIFACTS_DIR = "projects";

export const LEGACY_ARTIFACT_ROOTS = ["outputs", "papers", "notes"] as const;
export const WORKBENCH_ARTIFACT_ROOTS = [AXORBIS_ARTIFACT_ROOT, ...LEGACY_ARTIFACT_ROOTS] as const;

export function isAxorbisArtifactPath(path: string): boolean {
	return path === AXORBIS_ARTIFACT_ROOT || path.startsWith(AXORBIS_ARTIFACT_ROOT_PREFIX);
}

export function projectArtifactRoot(projectId: string): string {
	const slug = projectId.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "workspace";
	return `${AXORBIS_ARTIFACT_ROOT}/${AXORBIS_PROJECT_ARTIFACTS_DIR}/${slug}`;
}

export function axorbisArtifactRelativePath(path: string): string | undefined {
	if (!isAxorbisArtifactPath(path)) return undefined;
	const segments = path.slice(AXORBIS_ARTIFACT_ROOT_PREFIX.length).split("/");
	return segments[0] === AXORBIS_PROJECT_ARTIFACTS_DIR && segments[1] ? segments.slice(2).join("/") : segments.join("/");
}

export function isWorkbenchArtifactPath(path: string): boolean {
	return WORKBENCH_ARTIFACT_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}
