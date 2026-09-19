import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getPiWebAccessStatus, loadPiWebAccessConfig } from "../engine/pi/web-access.js";
import { startWorkbenchServer } from "../engine/workbench/server.js";

test("workbench setup saves a selected web-search key without returning it", async () => {
	const home = mkdtempSync(join(tmpdir(), "feynman-search-setup-home-"));
	const workspace = mkdtempSync(join(tmpdir(), "feynman-search-setup-workspace-"));
	const previousHome = process.env.AXORBIS_HOME;
	process.env.AXORBIS_HOME = home;
	const handle = await startWorkbenchServer({ workingDir: workspace, host: "127.0.0.1", port: 0, requireAuth: false });
	try {
		const secret = "exa-search-secret";
		const response = await fetch(`${handle.url}api/search`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action: "upsert", provider: "exa", apiKey: secret }),
		});
		assert.equal(response.status, 200);
		const body = await response.text();
		assert.doesNotMatch(body, new RegExp(secret));
		assert.equal(getPiWebAccessStatus().searchProvider, "exa");
		assert.equal(loadPiWebAccessConfig().exaApiKey, secret);

		const access = await fetch(`${handle.url}api/research-access`);
		assert.equal(access.status, 200);
		const accessBody = await access.text();
		assert.doesNotMatch(accessBody, new RegExp(secret));
		assert.match(accessBody, /"searchProvider": "exa"/);
	} finally {
		await handle.close();
		if (previousHome === undefined) delete process.env.AXORBIS_HOME; else process.env.AXORBIS_HOME = previousHome;
		rmSync(home, { recursive: true, force: true });
		rmSync(workspace, { recursive: true, force: true });
	}
});
