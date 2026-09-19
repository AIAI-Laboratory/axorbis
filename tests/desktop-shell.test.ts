import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

test("desktop metadata and bootstrap contract stay aligned", () => {
	const rootPackage = JSON.parse(read("package.json")) as { version: string };
	const iconGenerator = read("scripts/generate-desktop-icons.mjs");
	const desktopPackage = JSON.parse(read("app/package.json")) as { version: string };
	const config = JSON.parse(read("app/src-tauri/tauri.conf.json")) as {
		version: string;
		build: { devUrl?: string; frontendDist: string };
		app: { withGlobalTauri: boolean; windows: Array<Record<string, unknown>>; security: { csp: string | null } };
		bundle: { resources: Record<string, string> };
	};
	const cargo = read("app/src-tauri/Cargo.toml");
	const bootstrap = read("app/ui/index.html");
	const bootstrapScript = read("app/ui/main.js");
	const bootstrapStyles = read("app/ui/styles.css");
	const fontStyles = read("app/ui/fonts/fonts.css");
	const researchStyles = read("web/src/styles/research-system.css");
	const workbenchStyles = read("web/src/styles/research-app.css");
	const workbenchApp = read("web/src/app/research-app.tsx");
	const rustCommands = read("app/src-tauri/src/lib.rs");

	assert.equal(desktopPackage.version, rootPackage.version);
	assert.match(iconGenerator, /img\/icon\.svg/);
	assert.match(iconGenerator, /viewBox="-125 -125 1000 1000"/);
	assert.equal(config.version, rootPackage.version);
	assert.match(cargo, new RegExp(`version = "${rootPackage.version.replaceAll(".", "\\.")}"`));
	assert.equal(config.build.frontendDist, "../ui");
	assert.equal(config.build.devUrl, undefined);
	assert.equal(config.app.withGlobalTauri, true);
	assert.ok(config.app.security.csp);
	assert.doesNotMatch(config.app.security.csp ?? "", /unsafe-inline|unsafe-eval/);
	assert.equal(config.bundle.resources["../runtime/"], "runtime/");
	assert.equal(config.app.windows[0]?.titleBarStyle, undefined);
	assert.equal(config.app.windows[0]?.hiddenTitle, undefined);
	assert.doesNotMatch(bootstrap, /<script(?![^>]+src=)/);
	assert.doesNotMatch(bootstrap, /<style\b/);
	assert.match(bootstrap, /<strong>AXORBIS<\/strong>/);
	assert.doesNotMatch(bootstrap, />Open Feynman</);
	assert.match(bootstrapScript, /feynman\.research\.theme/);
	assert.match(bootstrapScript, /theme === "system" \? "light"/);
	assert.equal(config.app.windows[0]?.title, "Axorbis");
	for (const token of ["#ff3b30", "#181817", "#696a66", "#ddded8", "#fafaf8", "#fff2ef"]) {
		assert.match(bootstrapStyles.toLowerCase(), new RegExp(token));
	}
	assert.match(bootstrapStyles, /\.topbar\s*\{\s*height:\s*56px/);
	assert.match(bootstrapStyles, /\.body-grid\s*\{\s*grid-template-columns:\s*208px/);
	assert.match(bootstrap, /href="\.\/fonts\/fonts\.css"/);
	assert.match(workbenchStyles, /@import "\.\.\/\.\.\/\.\.\/app\/ui\/fonts\/fonts\.css"/);
	assert.match(workbenchApp, /import "\.\.\/styles\/research-system\.css"/);
	for (const family of ["Space Grotesk", "JetBrains Mono"]) {
		assert.match(fontStyles, new RegExp(`font-family: "${family}"`));
		assert.match(bootstrapStyles, new RegExp(family));
		assert.match(researchStyles, new RegExp(family));
	}
	for (const face of ["space-grotesk", "jetbrains-mono"]) {
		for (const subset of ["latin", "latin-ext", "vietnamese"]) {
			assert.ok(statSync(resolve(root, `app/ui/fonts/${face}-${subset}-wght-normal.woff2`)).size > 1000);
		}
	}

	for (const command of ["desktop_info", "choose_workspace", "start_backend"]) {
		assert.match(bootstrapScript, new RegExp(`invoke\\("${command}"`));
		assert.match(rustCommands, new RegExp(`commands::${command}`));
	}
});

test("desktop supervisor uses a dynamic authenticated local URL and owns child cleanup", () => {
	const commands = read("app/src-tauri/src/commands.rs");
	assert.match(commands, /"--no-open"/);
	assert.match(commands, /"--host"[\s\S]*"127\.0\.0\.1"/);
	assert.match(commands, /"--port"[\s\S]*"0"/);
	assert.doesNotMatch(commands, /"--no-auth"/);
	assert.match(commands, /line\.starts_with\("URL: "\)/);
	assert.match(commands, /parsed\.scheme\(\) != "http" \|\| !local_host/);
	assert.match(commands, /child\.kill\(\)/);
	assert.match(commands, /child\.wait\(\)/);
});
