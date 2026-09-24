import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { DEEPRESEARCH_SOURCES, registerDeepResearchDomainTools } from "../extensions/research-tools/deepresearch-domain-tools.js";

test("Deep Research domain tools expose only their source enum and scoped profiles", () => {
	const tools: Array<{ name: string; parameters: { properties: { source: { enum: string[] } } } }> = [];
	registerDeepResearchDomainTools({ registerTool: (tool: typeof tools[number]) => tools.push(tool) } as unknown as ExtensionAPI);
	assert.equal(tools.length, 4);
	for (const [domain, sources] of Object.entries(DEEPRESEARCH_SOURCES)) {
		const name = `feynman_deepresearch_${domain}_search`;
		const tool = tools.find((candidate) => candidate.name === name);
		assert.ok(tool, `${name} registered`);
		assert.deepEqual(tool.parameters.properties.source.enum, sources);
		const profile = readFileSync(resolve(import.meta.dirname, "..", ".axorbis", "agents", `deepresearch-researcher-${domain === "paper" ? "paper" : domain}.md`), "utf8");
		assert.match(profile, new RegExp(name));
		assert.doesNotMatch(profile, /feynman_science_database_search/);
	}
	const fallback = readFileSync(resolve(import.meta.dirname, "..", ".axorbis", "agents", "deepresearch-researcher-paper.md"), "utf8");
	assert.match(fallback, /web_search/);
	assert.match(fallback, /feynman_deepresearch_paper_search/);
});
