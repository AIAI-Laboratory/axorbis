import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startWorkbenchServer } from "../engine/workbench/server.js";
import {
	AXORBIS_RELEASE_API,
	checkLatestAxorbisRelease,
	releaseAnnouncementFromGitHub,
} from "../engine/workbench/update-announcement.js";

const release = {
	tag_name: "v0.3.50",
	name: "Axorbis 0.3.50",
	body: "Research fixes and a safer desktop launcher.",
	html_url: "https://github.com/AIAI-Laboratory/axorbis/releases/tag/v0.3.50",
	draft: false,
	prerelease: false,
};

test("release announcements accept only newer stable Axorbis GitHub releases", () => {
	assert.deepEqual(releaseAnnouncementFromGitHub(release, "0.3.49"), {
		version: "0.3.50",
		title: "Axorbis 0.3.50",
		notes: release.body,
		url: release.html_url,
	});
	assert.equal(releaseAnnouncementFromGitHub(release, "0.3.50"), null);
	assert.equal(releaseAnnouncementFromGitHub(release, "0.3.51"), null);
	assert.equal(releaseAnnouncementFromGitHub({ ...release, draft: true }, "0.3.49"), null);
	assert.equal(releaseAnnouncementFromGitHub({ ...release, prerelease: true }, "0.3.49"), null);
	assert.equal(releaseAnnouncementFromGitHub({ ...release, tag_name: "v0.3.50-beta.1" }, "0.3.49"), null);
	assert.equal(releaseAnnouncementFromGitHub({ ...release, html_url: "https://github.com.evil.test/AIAI-Laboratory/axorbis/releases/tag/v0.3.50" }, "0.3.49"), null);
	assert.equal(releaseAnnouncementFromGitHub({ ...release, html_url: "https://github.com/other/repo/releases/tag/v0.3.50" }, "0.3.49"), null);
	assert.equal(releaseAnnouncementFromGitHub({ ...release, tag_name: "latest" }, "0.3.49"), null);
});

test("release lookup is bounded and network failures never block the app", async () => {
	const requested: string[] = [];
	const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
		requested.push(String(input));
		assert.ok(init?.signal, "release check must have a timeout signal");
		return Response.json(release);
	}) as typeof fetch;
	const available = await checkLatestAxorbisRelease("0.3.49", fetcher);
	assert.deepEqual(requested, [AXORBIS_RELEASE_API]);
	assert.equal(available.status, "update-available");
	assert.equal(available.update?.version, "0.3.50");
	assert.equal((await checkLatestAxorbisRelease("0.3.49", (async () => new Response("", { status: 404 })) as typeof fetch)).status, "unpublished");
	assert.equal((await checkLatestAxorbisRelease("0.3.49", (async () => { throw new Error("offline"); }) as typeof fetch)).status, "unavailable");
	assert.equal((await checkLatestAxorbisRelease("invalid", fetcher)).status, "unavailable");
	assert.equal(requested.length, 1, "invalid local version must not trigger a network call");
});

test("the update endpoint is authenticated and returns a vetted announcement", async () => {
	const appRoot = mkdtempSync(join(tmpdir(), "axorbis-update-app-"));
	const workingDir = mkdtempSync(join(tmpdir(), "axorbis-update-workspace-"));
	mkdirSync(join(appRoot, "dist", "workbench-web"), { recursive: true });
	writeFileSync(join(appRoot, "dist", "workbench-web", "index.html"), "<title>Axorbis</title>");
	const originalFetch = globalThis.fetch;
	globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => String(input) === AXORBIS_RELEASE_API
		? Promise.resolve(Response.json(release))
		: originalFetch(input, init)) as typeof fetch;
	try {
		const server = await startWorkbenchServer({ appRoot, workingDir, version: "0.3.49", token: "secret", port: 0 });
		try {
			assert.equal((await fetch(`${server.url}api/update`)).status, 401);
			const response = await fetch(`${server.url}api/update?token=secret`);
			assert.equal(response.status, 200);
			const payload = await response.json() as { status: string; update?: { version: string; url: string } };
			assert.equal(payload.status, "update-available");
			assert.equal(payload.update?.version, "0.3.50");
			assert.equal(payload.update?.url, release.html_url);
		} finally { await server.close(); }
	} finally {
		globalThis.fetch = originalFetch;
		rmSync(appRoot, { recursive: true, force: true });
		rmSync(workingDir, { recursive: true, force: true });
	}
});
