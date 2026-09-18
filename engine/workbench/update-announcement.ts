import { gt, prerelease, valid } from "semver";

export const AXORBIS_RELEASE_API = "https://api.github.com/repos/AIAI-Laboratory/axorbis/releases/latest";

export type ReleaseAnnouncement = {
	version: string;
	title: string;
	notes: string;
	url: string;
};

export type ReleaseCheck = {
	currentVersion: string;
	status: "current" | "unavailable" | "unpublished" | "update-available";
	update: ReleaseAnnouncement | null;
};

function releasePageUrl(value: unknown): string | null {
	if (typeof value !== "string") return null;
	try {
		const url = new URL(value);
		const prefix = "/AIAI-Laboratory/axorbis/releases/tag/";
		if (url.protocol !== "https:" || url.hostname !== "github.com" || !url.pathname.startsWith(prefix)) return null;
		if (!url.pathname.slice(prefix.length) || url.username || url.password || url.port) return null;
		return url.toString();
	} catch {
		return null;
	}
}

export function releaseAnnouncementFromGitHub(payload: unknown, currentVersion: string): ReleaseAnnouncement | null {
	if (!payload || typeof payload !== "object" || !valid(currentVersion)) return null;
	const release = payload as Record<string, unknown>;
	if (release.draft === true || release.prerelease === true) return null;
	const version = typeof release.tag_name === "string" ? valid(release.tag_name) : null;
	const url = releasePageUrl(release.html_url);
	if (!version || prerelease(version) || !url || !gt(version, currentVersion)) return null;
	return {
		version,
		title: typeof release.name === "string" && release.name.trim() ? release.name.trim().slice(0, 120) : `Axorbis ${version}`,
		notes: typeof release.body === "string" ? release.body.trim().slice(0, 280) : "",
		url,
	};
}

export async function checkLatestAxorbisRelease(
	currentVersion: string,
	fetcher: typeof fetch = fetch,
): Promise<ReleaseCheck> {
	const fallback: ReleaseCheck = { currentVersion, status: "unavailable", update: null };
	if (!valid(currentVersion)) return fallback;
	try {
		const response = await fetcher(AXORBIS_RELEASE_API, {
			headers: { accept: "application/vnd.github+json", "user-agent": `Axorbis/${currentVersion}` },
			signal: AbortSignal.timeout(5_000),
		});
		if (response.status === 404) return { ...fallback, status: "unpublished" };
		if (!response.ok) return fallback;
		const release = releaseAnnouncementFromGitHub(await response.json(), currentVersion);
		return { currentVersion, status: release ? "update-available" : "current", update: release };
	} catch {
		return fallback;
	}
}

let cached: { version: string; expiresAt: number; result: Promise<ReleaseCheck> } | null = null;

export function cachedLatestAxorbisRelease(currentVersion: string): Promise<ReleaseCheck> {
	const now = Date.now();
	if (cached?.version === currentVersion && cached.expiresAt > now) return cached.result;
	const result = checkLatestAxorbisRelease(currentVersion);
	cached = { version: currentVersion, expiresAt: now + 30 * 60_000, result };
	return result;
}
