import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { desktopRuntimeTarget, verifyDesktopRuntime } from "./stage-desktop-runtime.mjs";

const appRoot = resolve(import.meta.dirname, "..");

export function desktopReleaseVersions(root = appRoot) {
	const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
	const rootPackage = readJson("package.json");
	const desktopPackage = readJson("app/package.json");
	const tauri = readJson("app/src-tauri/tauri.conf.json");
	const cargo = readFileSync(resolve(root, "app/src-tauri/Cargo.toml"), "utf8");
	const cargoVersion = cargo.match(/^version = "([^"]+)"/m)?.[1];
	const versions = [rootPackage.version, desktopPackage.version, tauri.version, cargoVersion];
	if (versions.some((version) => version !== rootPackage.version)) {
		throw new Error(`Desktop release versions differ: ${versions.join(", ")}`);
	}
	return rootPackage.version;
}

export function verifyDesktopRelease(options = {}) {
	const root = options.root ?? appRoot;
	const version = desktopReleaseVersions(root);
	const tag = options.tag ?? process.env.AXORBIS_RELEASE_TAG;
	if (tag && tag !== `v${version}`) throw new Error(`Release tag ${tag} must equal v${version}`);
	if (options.requireSigning) {
		for (const name of ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_SIGNING_IDENTITY", "APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"]) {
			if (!process.env[name]) throw new Error(`Missing required macOS release secret: ${name}`);
		}
	}
	if (options.requireRuntime) {
		const runtime = resolve(root, "app/runtime");
		verifyDesktopRuntime(runtime, version);
		const markerPath = resolve(runtime, "axorbis-runtime.json");
		if (!existsSync(markerPath)) throw new Error("Desktop release runtime was not staged by the verified bundle workflow");
		const marker = JSON.parse(readFileSync(markerPath, "utf8"));
		if (marker.version !== version) throw new Error("Staged runtime marker has the wrong version");
		if (marker.target !== desktopRuntimeTarget().id) throw new Error("Staged runtime target does not match this build machine");
	}
	return version;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
	try {
		const version = verifyDesktopRelease({
			requireSigning: process.argv.includes("--require-signing"),
			requireRuntime: process.argv.includes("--require-runtime"),
		});
		console.log(`[axorbis] desktop release preflight passed for ${version}`);
	} catch (error) {
		console.error(`[axorbis] ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
