import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve as resolvePath } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { getExtensionCommandSpec } from "../../metadata/commands.mjs";
import { AXORBIS_ARTIFACT_ROOT } from "../../engine/workbench/artifact-roots.js";
import { buildProjectAgentsTemplate, buildSessionLogsReadme } from "./project-scaffold.js";

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

function activeArtifactRoot(): string {
	const configured = process.env.AXORBIS_PROJECT_ARTIFACT_ROOT?.trim().replace(/^\/+|\/+$/g, "");
	return configured?.startsWith(`${AXORBIS_ARTIFACT_ROOT}/projects/`) ? configured : AXORBIS_ARTIFACT_ROOT;
}
const ARTIFACT_EXTS = new Set([".md", ".tex", ".pdf", ".py", ".csv", ".json", ".html", ".txt", ".log"]);

async function collectArtifacts(cwd: string): Promise<{ label: string; path: string }[]> {
	const items: { label: string; path: string; mtime: number }[] = [];

	for (const dir of [activeArtifactRoot()]) {
		const dirPath = resolvePath(cwd, dir);
		if (!(await pathExists(dirPath))) continue;

		const walk = async (current: string): Promise<void> => {
			let entries;
			try {
				entries = await readdir(current, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				const full = join(current, entry.name);
				if (entry.isDirectory()) {
					await walk(full);
				} else if (ARTIFACT_EXTS.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
					const rel = relative(cwd, full);
					let title = "";
					try {
						const head = await readFile(full, "utf8").then((c) => c.slice(0, 200));
						const match = head.match(/^#\s+(.+)/m);
						if (match) title = match[1]!.trim();
					} catch {}
					const info = await stat(full).catch(() => null);
					const mtime = info?.mtimeMs ?? 0;
					const size = info ? formatSize(info.size) : "";
					const titlePart = title ? ` — ${title}` : "";
					items.push({ label: `${rel}${titlePart}  (${size})`, path: rel, mtime });
				}
			}
		};

		await walk(dirPath);
	}

	items.sort((a, b) => b.mtime - a.mtime);
	return items;
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function registerInitCommand(pi: ExtensionAPI): void {
	pi.registerCommand("init", {
		description: getExtensionCommandSpec("init")?.description ?? "Initialize AGENTS.md and session-log folders for a research project.",
		handler: async (_args, ctx) => {
			const agentsPath = resolvePath(ctx.cwd, "AGENTS.md");
			const artifactRoot = activeArtifactRoot();
			const notesDir = resolvePath(ctx.cwd, artifactRoot, ".notes");
			const sessionLogsDir = resolvePath(notesDir, "session-logs");
			const sessionLogsReadmePath = resolvePath(sessionLogsDir, "README.md");
			const created: string[] = [];
			const skipped: string[] = [];

			await mkdir(notesDir, { recursive: true });
			await mkdir(sessionLogsDir, { recursive: true });

			if (!(await pathExists(agentsPath))) {
				await writeFile(agentsPath, buildProjectAgentsTemplate(), "utf8");
				created.push("AGENTS.md");
			} else {
				skipped.push("AGENTS.md");
			}

			if (!(await pathExists(sessionLogsReadmePath))) {
				await writeFile(sessionLogsReadmePath, buildSessionLogsReadme(), "utf8");
				created.push(`${artifactRoot}/.notes/session-logs/README.md`);
			} else {
				skipped.push(`${artifactRoot}/.notes/session-logs/README.md`);
			}

			const createdSummary = created.length > 0 ? `created: ${created.join(", ")}` : "created: nothing";
			const skippedSummary = skipped.length > 0 ? `; kept existing: ${skipped.join(", ")}` : "";
			ctx.ui.notify(`${createdSummary}${skippedSummary}`, "info");
		},
	});
}

export function registerOutputsCommand(pi: ExtensionAPI): void {
	pi.registerCommand("outputs", {
		description: "Browse all research artifacts, including files saved in .axorbis/artifacts.",
		handler: async (_args, ctx) => {
			const items = await collectArtifacts(ctx.cwd);
			if (items.length === 0) {
				ctx.ui.notify("No artifacts found. Use /lit, /draft, /review, or /deepresearch to create some.", "info");
				return;
			}

			const selected = await ctx.ui.select(`Artifacts (${items.length})`, items.map((i) => i.label));
			if (!selected) return;

			const match = items.find((i) => i.label === selected);
			if (match) {
				ctx.ui.setEditorText(`read ${match.path}`);
			}
		},
	});
}
