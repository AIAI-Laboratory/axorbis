import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".axorbis/artifacts/projects/feynman-deepresearch/deepresearch-orchestration-tool-definitions.json");
const agentDir = mkdtempSync(resolve(tmpdir(), "feynman-tool-measure-"));

function toolsFor(agent) {
	const file = readFileSync(resolve(root, ".axorbis", "agents", `${agent}.md`), "utf8");
	const line = file.match(/^tools:\s*(.*)$/m)?.[1];
	if (line === undefined) throw new Error(`Missing tools allowlist for ${agent}`);
	return line.split(",").map((value) => value.trim()).filter(Boolean);
}

function measure(session, agents) {
	const lanes = agents.map((agent) => {
		const expected = toolsFor(agent);
		session.setActiveToolsByName(expected);
		const active = session.getActiveToolNames();
		const missing = expected.filter((name) => !active.includes(name));
		if (missing.length) throw new Error(`${agent}: unavailable tools: ${missing.join(", ")}`);
		const definitions = active.map((name) => {
			const definition = session.getToolDefinition(name);
			if (!definition) throw new Error(`Missing definition: ${name}`);
			return definition;
		});
		const definitionChars = definitions.reduce((sum, tool) =>
			sum + JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }).length, 0);
		const guidanceChars = definitions.reduce((sum, tool) =>
			sum + JSON.stringify({ promptSnippet: tool.promptSnippet ?? "", promptGuidelines: tool.promptGuidelines ?? [] }).length, 0);
		return { agent, activeTools: active, definitionChars, estimatedDefinitionTokens: Math.ceil(definitionChars / 4), guidanceChars, estimatedGuidanceTokens: Math.ceil(guidanceChars / 4) };
	});
	return {
		lanes,
		definitionChars: lanes.reduce((sum, lane) => sum + lane.definitionChars, 0),
		estimatedDefinitionTokens: lanes.reduce((sum, lane) => sum + lane.estimatedDefinitionTokens, 0),
		guidanceChars: lanes.reduce((sum, lane) => sum + lane.guidanceChars, 0),
		estimatedGuidanceTokens: lanes.reduce((sum, lane) => sum + lane.estimatedGuidanceTokens, 0),
	};
}

try {
	const loader = new DefaultResourceLoader({
		cwd: root,
		agentDir,
		additionalExtensionPaths: [resolve(root, "extensions/research-tools.ts"), resolve(root, "extensions/deepresearch-domain-tools.ts")],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	const allAgents = ["researcher", "deepresearch-researcher-bio", "deepresearch-researcher-chem", "deepresearch-researcher-genomics"];
	const allTools = [...new Set(allAgents.flatMap(toolsFor))];
	const { session } = await createAgentSession({ resourceLoader: loader, sessionManager: SessionManager.inMemory(), tools: allTools });
	try {
		const comparisons = {
			narrowBio: {
				question: "What protein domains does TP53 contain?",
				before: measure(session, ["researcher"]),
				after: measure(session, ["deepresearch-researcher-bio"]),
			},
			interdisciplinary: {
				question: "How do TP53 protein interactions, drug affinities, and cancer variants inform target selection?",
				before: measure(session, ["researcher", "researcher", "researcher"]),
				after: measure(session, ["deepresearch-researcher-bio", "deepresearch-researcher-chem", "deepresearch-researcher-genomics"]),
			},
		};
		const report = {
			schema: "feynman.deepresearchToolDefinitions.v1",
			method: "Pi SDK active tool definitions; JSON length of {name,description,parameters}, plus prompt snippets/guidelines separately; estimated tokens = ceil(chars/4) per child. This is not provider-reported usage.",
			comparisons,
		};
		writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
		process.stdout.write(`${JSON.stringify({ output, comparisons: Object.fromEntries(Object.entries(comparisons).map(([key, value]) => [key, { before: value.before.estimatedDefinitionTokens, after: value.after.estimatedDefinitionTokens }])) }, null, 2)}\n`);
	} finally {
		await session.dispose();
	}
} finally {
	rmSync(agentDir, { recursive: true, force: true });
}
