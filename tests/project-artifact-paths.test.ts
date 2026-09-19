import assert from "node:assert/strict";
import test from "node:test";

import { redirectedArtifactPath } from "../extensions/research-tools/project-artifact-paths.js";

const cwd = "/workspace";
const projectRoot = ".axorbis/artifacts/projects/temporal-kg";

test("project artifact guard redirects generic Axorbis paths into the active project", () => {
	assert.equal(
		redirectedArtifactPath(cwd, ".axorbis/artifacts/.plans/temporal-kg.md", projectRoot),
		`${projectRoot}/.plans/temporal-kg.md`,
	);
	assert.equal(
		redirectedArtifactPath(cwd, ".axorbis/artifacts/.drafts/temporal-kg-cited.md", projectRoot),
		`${projectRoot}/.drafts/temporal-kg-cited.md`,
	);
	assert.equal(
		redirectedArtifactPath(cwd, "outputs/temporal-kg.md", projectRoot),
		`${projectRoot}/temporal-kg.md`,
	);
});

test("project artifact guard preserves active project paths and rehomes other project paths", () => {
	assert.equal(
		redirectedArtifactPath(cwd, `${projectRoot}/.drafts/temporal-kg-cited.md`, projectRoot),
		undefined,
	);
	assert.equal(
		redirectedArtifactPath(cwd, ".axorbis/artifacts/projects/old-project/.drafts/old.md", projectRoot),
		`${projectRoot}/.drafts/old.md`,
	);
});
