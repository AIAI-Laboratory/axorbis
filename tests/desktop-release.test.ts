import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { desktopRuntimeTarget, stageDesktopRuntime, verifyDesktopRuntime } from "../scripts/stage-desktop-runtime.mjs";
import { desktopReleaseVersions, verifyDesktopRelease } from "../scripts/verify-desktop-release.mjs";

test("desktop publishing is gated on matching versions, a bundled runtime, and signing", () => {
	const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version as string;
	assert.equal(desktopReleaseVersions(), version);
	assert.equal(verifyDesktopRelease({ tag: `v${version}` }), version);
	assert.throws(() => verifyDesktopRelease({ tag: "v0.0.0" }), /must equal/);
	const workflow = readFileSync(new URL("../.github/workflows/axorbis-desktop-release.yml", import.meta.url), "utf8");
	assert.match(workflow, /npm run desktop:release-build/);
	assert.match(workflow, /verify-desktop-release\.mjs --require-signing/);
	assert.match(workflow, /verify-desktop-release\.mjs --require-runtime/);
	assert.match(workflow, /needs: macos-arm64/);
	assert.match(workflow, /gh release create/);
});

test("desktop release target follows the native host architecture", () => {
	assert.deepEqual(desktopRuntimeTarget("darwin", "arm64"), { id: "darwin-arm64", extension: "tar.gz" });
	assert.deepEqual(desktopRuntimeTarget("win32", "x64"), { id: "win32-x64", extension: "zip" });
	assert.throws(() => desktopRuntimeTarget("freebsd", "x64"), /Unsupported/);
});

test("release staging requires a verified, version-matched Axorbis runtime", () => {
	const root = mkdtempSync(join(tmpdir(), "axorbis-desktop-release-"));
	const version = "0.3.49";
	const folder = `feynman-${version}-darwin-arm64`;
	const bundle = join(root, folder);
	const runtime = join(root, "runtime");
	const archive = join(root, "runtime.tar.gz");
	try {
		mkdirSync(join(bundle, "node", "bin"), { recursive: true });
		mkdirSync(join(bundle, "app", "dist", "workbench-web"), { recursive: true });
		mkdirSync(runtime);
		writeFileSync(join(runtime, ".gitkeep"), "");
		writeFileSync(join(bundle, "feynman"), "#!/bin/sh\n");
		writeFileSync(join(bundle, "node", "bin", "node"), "node");
		symlinkSync("../node/bin/node", join(bundle, "app", "node-alias"));
		writeFileSync(join(bundle, "app", "package.json"), JSON.stringify({ version }));
		writeFileSync(join(bundle, "app", "dist", "workbench-web", "index.html"), "<title>Axorbis Research Workspace</title>");
		const tar = spawnSync("tar", ["-czf", archive, "-C", root, folder]);
		assert.equal(tar.status, 0, tar.stderr?.toString());
		const options = { archivePath: archive, runtimeDir: runtime, target: { id: "darwin-arm64", extension: "tar.gz" as const }, version };
		assert.equal(stageDesktopRuntime(options), runtime);
		assert.ok(existsSync(join(runtime, "feynman")));
		assert.equal(JSON.parse(readFileSync(join(runtime, "axorbis-runtime.json"), "utf8")).version, version);
		assert.equal(stageDesktopRuntime(options), runtime, "recognized generated runtimes can be restaged");
		assert.throws(() => verifyDesktopRuntime(runtime, "0.3.50", "linux"), /does not match/);
		assert.throws(() => stageDesktopRuntime({ ...options, archivePath: join(root, "missing.tar.gz") }), /Build the verified native runtime first/);
		assert.ok(existsSync(join(runtime, "feynman")), "failed staging must preserve the prior runtime");
		symlinkSync(join(root, "non-portable-target"), join(bundle, "app", "bad-link"));
		assert.equal(spawnSync("tar", ["-czf", archive, "-C", root, folder]).status, 0);
		assert.throws(() => stageDesktopRuntime(options), /Non-portable or broken runtime symlink/);
		assert.ok(existsSync(join(runtime, "feynman")), "bad archive must preserve the prior runtime");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
