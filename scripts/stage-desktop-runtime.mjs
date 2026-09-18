import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPortableSymlinks } from "./lib/portable-symlinks.mjs";

const appRoot = resolve(import.meta.dirname, "..");
const desktopRoot = resolve(appRoot, "app");
const packageVersion = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8")).version;

export function desktopRuntimeTarget(platform = process.platform, architecture = process.arch) {
	const targets = {
		"darwin-arm64": ["darwin-arm64", "tar.gz"],
		"darwin-x64": ["darwin-x64", "tar.gz"],
		"linux-arm64": ["linux-arm64", "tar.gz"],
		"linux-x64": ["linux-x64", "tar.gz"],
		"win32-arm64": ["win32-arm64", "zip"],
		"win32-x64": ["win32-x64", "zip"],
	};
	const target = targets[`${platform}-${architecture}`];
	if (!target) throw new Error(`Unsupported Axorbis desktop target: ${platform}/${architecture}`);
	return { id: target[0], extension: target[1] };
}

function run(command, args) {
	const result = spawnSync(command, args, { stdio: "inherit" });
	if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.status}`);
}

function extractArchive(archivePath, destination, extension) {
	if (extension === "zip") {
		if (process.platform === "win32") {
			const escapedArchive = archivePath.replaceAll("'", "''");
			const escapedDestination = destination.replaceAll("'", "''");
			run("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedDestination}' -Force`]);
		} else {
			run("unzip", ["-q", archivePath, "-d", destination]);
		}
		return;
	}
	run("tar", ["-xzf", archivePath, "-C", destination]);
}

export function verifyDesktopRuntime(runtimeDir, version = packageVersion, platform = process.platform) {
	const launcher = resolve(runtimeDir, platform === "win32" ? "feynman.cmd" : "feynman");
	const node = resolve(runtimeDir, "node", platform === "win32" ? "node.exe" : "bin/node");
	const appPackagePath = resolve(runtimeDir, "app", "package.json");
	const webEntry = resolve(runtimeDir, "app", "dist", "workbench-web", "index.html");
	for (const path of [launcher, node, appPackagePath, webEntry]) {
		if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Desktop runtime is incomplete: ${path}`);
	}
	const appPackage = JSON.parse(readFileSync(appPackagePath, "utf8"));
	if (appPackage.version !== version) throw new Error(`Desktop runtime version ${appPackage.version} does not match ${version}`);
	if (!readFileSync(webEntry, "utf8").includes("Axorbis Research Workspace")) {
		throw new Error("Desktop runtime does not contain the Axorbis web entry");
	}
	assertPortableSymlinks(runtimeDir);
	return { launcher, node, webEntry };
}

export function stageDesktopRuntime(options = {}) {
	const version = options.version ?? packageVersion;
	const target = options.target ?? desktopRuntimeTarget();
	const archivePath = resolve(options.archivePath ?? resolve(appRoot, "dist", "release", `feynman-${version}-${target.id}.${target.extension}`));
	const runtimeDir = resolve(options.runtimeDir ?? resolve(desktopRoot, "runtime"));
	if (!existsSync(archivePath)) throw new Error(`Build the verified native runtime first: ${archivePath}`);
	if (existsSync(runtimeDir)) {
		const existing = readdirSync(runtimeDir).filter((entry) => entry !== ".gitkeep");
		if (existing.length && !existing.includes("axorbis-runtime.json")) {
			throw new Error(`Refusing to replace an unrecognized runtime directory: ${runtimeDir}`);
		}
	}
	const scratch = mkdtempSync(join(dirname(runtimeDir), ".axorbis-runtime-stage-"));
	const extracted = resolve(scratch, `feynman-${version}-${target.id}`);
	const staged = resolve(scratch, "runtime");
	const backup = `${runtimeDir}.axorbis-backup`;
	try {
		extractArchive(archivePath, scratch, target.extension);
		verifyDesktopRuntime(extracted, version, target.id.startsWith("win32") ? "win32" : "linux");
		cpSync(extracted, staged, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
		writeFileSync(resolve(staged, ".gitkeep"), "");
		writeFileSync(resolve(staged, "axorbis-runtime.json"), `${JSON.stringify({ version, target: target.id, archive: basename(archivePath) }, null, 2)}\n`);
		verifyDesktopRuntime(staged, version, target.id.startsWith("win32") ? "win32" : "linux");
		if (existsSync(backup)) throw new Error(`Previous runtime backup still exists: ${backup}`);
		if (existsSync(runtimeDir)) renameSync(runtimeDir, backup);
		try {
			renameSync(staged, runtimeDir);
		} catch (error) {
			if (existsSync(backup)) renameSync(backup, runtimeDir);
			throw error;
		}
		if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
		return runtimeDir;
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	const runtimeDir = stageDesktopRuntime();
	console.log(`[axorbis] verified desktop runtime staged: ${runtimeDir}`);
}
