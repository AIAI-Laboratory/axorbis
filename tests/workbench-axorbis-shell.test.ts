import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startWorkbenchServer } from "../engine/workbench/server.js";
import { parseStreamChunk } from "../web/src/features/chat/stream.js";
import { researchPath } from "../web/src/features/research/research-domain.js";

test("Axorbis is the only web entry and legacy interface files are gone", () => {
	const root = new URL("../web/", import.meta.url);
	const html = readFileSync(new URL("index.html", root), "utf8");
	const app = readFileSync(new URL("src/app/research-app.tsx", root), "utf8");
	const styles = readFileSync(new URL("src/styles/research-app.css", root), "utf8");
	assert.match(html, /Axorbis Research Workspace/);
	assert.match(html, /\/src\/app\/research-main\.tsx/);
	assert.match(app, /function HomePage/);
	assert.match(app, /function ProjectsPage/);
	assert.match(app, /function QuestionPage/);
	assert.match(styles, /--red:#FF3B30/i);
	for (const path of ["research.html", "src/app/main.tsx", "src/styles/main.css", "src/viewers/pdf-preview.tsx"]) {
		assert.equal(existsSync(new URL(path, root)), false, path);
	}
	assert.equal(researchPath("space a", "question 1"), "/projects/space%20a/questions/question%201");
});

test("authenticated root and historical app-shell URLs serve the same Axorbis entry", async () => {
	const appRoot = mkdtempSync(join(tmpdir(), "axorbis-shell-"));
	const workingDir = mkdtempSync(join(tmpdir(), "axorbis-workspace-"));
	mkdirSync(join(appRoot, "dist", "workbench-web", "assets"), { recursive: true });
	writeFileSync(join(appRoot, "dist", "workbench-web", "index.html"), "<!doctype html><title>Axorbis</title><script src='/app-shell/assets/axorbis.js'></script>");
	writeFileSync(join(appRoot, "dist", "workbench-web", "assets", "axorbis.js"), "export const axorbis = true;");
	const server = await startWorkbenchServer({ appRoot, workingDir, token: "secret", port: 0 });
	try {
		const denied = await fetch(`${server.url}projects/example/questions/test`);
		assert.equal(denied.status, 401);
		for (const route of ["", "projects/example/questions/test", "app-shell/", "app-shell/projects/example/frames/test"]) {
			const response = await fetch(`${server.url}${route}?token=secret`);
			assert.equal(response.status, 200, route);
			assert.match(await response.text(), /<title>Axorbis<\/title>/);
		}
		const asset = await fetch(`${server.url}app-shell/assets/axorbis.js?token=secret`);
		assert.equal(asset.status, 200);
		assert.match(await asset.text(), /axorbis = true/);
	} finally {
		await server.close();
		rmSync(appRoot, { recursive: true, force: true });
		rmSync(workingDir, { recursive: true, force: true });
	}
});

test("Axorbis stream parser accepts complete SSE frames", () => {
	const events: unknown[] = [];
	const remaining = parseStreamChunk('data: {"type":"delta","content":"hello"}\n\ndata: {"type":"done","session":{}}\n\npartial', (event) => events.push(event));
	assert.deepEqual(events, [{ type: "delta", content: "hello" }, { type: "done", session: {} }]);
	assert.equal(remaining, "partial");
});
