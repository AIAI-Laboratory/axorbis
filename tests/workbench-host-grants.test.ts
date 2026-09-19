import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { buildWorkbenchState } from "../engine/workbench/scan.js";
import { startWorkbenchServer } from "../engine/workbench/server.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-host-grants-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	mkdirSync(join(root, ".axorbis", "artifacts"), { recursive: true });
	writeFileSync(join(root, "outputs", "host-grants.md"), "# Host grants\n");
	writeFileSync(join(root, ".axorbis", "artifacts", "new-storage.md"), "# New storage\n");
	writeFileSync(join(root, "CHANGELOG.md"), "# Lab notebook\n");
	return root;
}

test("buildWorkbenchState exposes Claude-style host grant rows", () => {
	const root = makeWorkspace();
	try {
		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		assert.equal(state.artifacts.some((artifact) => artifact.path === ".axorbis/artifacts/new-storage.md"), true);
		assert.equal(state.hostGrants.length, 2);

		const artifacts = state.hostGrants.find((grant) => grant.mountName === "axorbis-artifacts");
		assert.match(artifacts?.id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.equal(artifacts?.userId, "local-workbench");
		assert.equal(artifacts?.hostPath, resolve(root, ".axorbis", "artifacts"));
		assert.equal(artifacts?.mode, "rw");
		assert.equal(artifacts?.source, "Axorbis research artifacts");
		assert.equal(artifacts?.exists, true);
		assert.ok((artifacts?.createdAtMs ?? 0) > 0);

		const labNotebook = state.hostGrants.find((grant) => grant.mountName === "lab-notebook");
		assert.equal(labNotebook?.hostPath, resolve(root, "CHANGELOG.md"));
		assert.equal(labNotebook?.mode, "ro");
		assert.equal(labNotebook?.exists, true);

		assert.deepEqual(
			state.hostGrants.map((grant) => [grant.mountName, grant.mode] as const).sort(),
			[
				["lab-notebook", "ro"],
				["axorbis-artifacts", "rw"],
			],
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server returns host grants through state", async () => {
	const root = makeWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const response = await fetch(`${handle.url}api/state`, {
			headers: { cookie: "feynman_workbench=test-token" },
		});
		assert.equal(response.status, 200);
		const payload = await response.json() as {
			hostGrants: Array<{ hostPath: string; mountName: string; mode: "ro" | "rw" }>;
		};
		assert.equal(payload.hostGrants.some((grant) =>
			grant.hostPath === resolve(root, ".axorbis", "artifacts") &&
			grant.mountName === "axorbis-artifacts" &&
			grant.mode === "rw"
		), true);
		assert.equal(payload.hostGrants.some((grant) =>
			grant.hostPath === resolve(root, "CHANGELOG.md") &&
			grant.mountName === "lab-notebook" &&
			grant.mode === "ro"
		), true);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
