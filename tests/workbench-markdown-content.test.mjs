import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownContent, readableResearchMessage } from "../web/src/features/research/markdown-content.js";
import { ProjectFiles } from "../web/src/features/research/project-files.js";
import { groupProjectFiles } from "../web/src/features/research/research-domain.js";

test("research Markdown renders structure without executing embedded HTML or unsafe links", () => {
	const html = renderToStaticMarkup(createElement(MarkdownContent, {
		content: "## Plan\n\n1. First **step**\n2. Second step\n\n| Source | Status |\n| --- | --- |\n| Paper | Read |\n\n[Safe](https://example.org) [Unsafe](javascript:alert(1)) <script>alert(1)</script>",
	}));
	assert.match(html, /<h2>Plan<\/h2>/);
	assert.match(html, /<ol/);
	assert.match(html, /<strong>step<\/strong>/);
	assert.match(html, /<table>/);
	assert.match(html, /href="https:\/\/example.org"/);
	assert.doesNotMatch(html, /href="javascript:/);
	assert.doesNotMatch(html, /<script>/);
	assert.match(renderToStaticMarkup(createElement(MarkdownContent, { content: "Fish &amp; chips" })), /Fish &amp; chips/);
});

test("research artifact paths in replies are visible controls whether or not the model used code spans", () => {
	const content = "Final: `outputs/temporal-kg.md`\n\nProvenance: outputs/temporal-kg.provenance.md";
	const html = renderToStaticMarkup(createElement(MarkdownContent, { content, onFilePath: () => {} }));
	assert.equal((html.match(/rw-file-path-link/g) ?? []).length, 2);
	assert.match(html, /outputs\/temporal-kg\.md/);
	assert.match(html, /outputs\/temporal-kg\.provenance\.md/);
});

test("project files are grouped by research question and stay closed until clicked", () => {
	const files = Array.from({ length: 12 }, (_, index) => ({
		path: `outputs/paper-${index + 1}.md`, name: `paper-${index + 1}.md`, title: `Paper ${index + 1}`,
		category: "output", extension: ".md", contentType: "text/markdown", sizeBytes: 100,
		updatedAt: "2026-09-19T00:00:00.000Z", updatedAtMs: index,
		slug: index < 5 ? "question-one" : index < 10 ? "question-two" : "unlinked", previewable: true,
	}));
	const questions = [
		{ slug: "question-one", title: "First research question", artifactPaths: [files[6].path] },
		{ slug: "question-two", title: "Second research question", artifactPaths: [] },
	];
	const groups = groupProjectFiles(files, questions);
	assert.deepEqual(groups.map((group) => group.files.length), [5, 5, 2]);
	const html = renderToStaticMarkup(createElement(ProjectFiles, { files, questions, navigateQuestion: () => {}, newQuestion: () => {}, onState: () => {}, onError: () => {} }));
	assert.match(html, /2 questions · 12 files/);
	assert.match(html, /First research question/);
	assert.match(html, /Second research question/);
	assert.match(html, /Other project files/);
	assert.doesNotMatch(html, /outputs\/paper-\d+\.md/);
	assert.doesNotMatch(html, /role="dialog"/);
	assert.match(html, /aria-expanded="false"/);
});

test("nested provider errors are presented as readable text", () => {
	const content = JSON.stringify({ error: JSON.stringify({ message: "Quota exceeded. Try again later." }) });
	assert.equal(readableResearchMessage(content), "**Research request failed**\n\nQuota exceeded. Try again later.");
	assert.equal(readableResearchMessage("## A valid answer"), "## A valid answer");
});
