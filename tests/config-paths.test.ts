import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	ensureAxorbisHome,
	ensureAxorbisActiveOrg,
	getBootstrapStatePath,
	getDefaultSessionDir,
	getAxorbisActiveOrgDir,
	getAxorbisActiveOrgPath,
	getAxorbisAgentDir,
	getAxorbisHome,
	getAxorbisMemoryDir,
	getAxorbisOrgDatabasePath,
	getAxorbisOrgsDir,
	getAxorbisStateDir,
} from "../engine/config/paths.js";

test("getAxorbisHome uses AXORBIS_HOME env var when set", () => {
	const previous = process.env.AXORBIS_HOME;
	try {
		process.env.AXORBIS_HOME = "/custom/home";
		assert.equal(getAxorbisHome(), resolve("/custom/home", ".axorbis"));
	} finally {
		if (previous === undefined) {
			delete process.env.AXORBIS_HOME;
		} else {
			process.env.AXORBIS_HOME = previous;
		}
	}
});

test("getAxorbisHome falls back to homedir when AXORBIS_HOME is unset", () => {
	const previous = process.env.AXORBIS_HOME;
	try {
		delete process.env.AXORBIS_HOME;
		const home = getAxorbisHome();
		assert.ok(home.endsWith(".axorbis"), `expected path ending in .feynman, got: ${home}`);
		assert.ok(!home.includes("undefined"), `expected no 'undefined' in path, got: ${home}`);
	} finally {
		if (previous === undefined) {
			delete process.env.AXORBIS_HOME;
		} else {
			process.env.AXORBIS_HOME = previous;
		}
	}
});

test("getAxorbisAgentDir resolves to <home>/agent", () => {
	assert.equal(getAxorbisAgentDir("/some/home"), resolve("/some/home", "agent"));
});

test("getAxorbisOrgsDir resolves to <home>/orgs", () => {
	assert.equal(getAxorbisOrgsDir("/some/home"), resolve("/some/home", "orgs"));
});

test("getAxorbisActiveOrgPath resolves to <home>/active-org.json", () => {
	assert.equal(getAxorbisActiveOrgPath("/some/home"), resolve("/some/home", "active-org.json"));
});

test("getAxorbisOrgDatabasePath resolves to the active org database", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-paths-"));
	try {
		const home = join(root, "home");
		const org = ensureAxorbisActiveOrg(home);
		assert.equal(getAxorbisOrgDatabasePath(home), resolve(home, "orgs", org.org_uuid, "feynman-workbench.db"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("getAxorbisMemoryDir resolves to <home>/memory", () => {
	assert.equal(getAxorbisMemoryDir("/some/home"), resolve("/some/home", "memory"));
});

test("getAxorbisStateDir resolves to <home>/.state", () => {
	assert.equal(getAxorbisStateDir("/some/home"), resolve("/some/home", ".state"));
});

test("getDefaultSessionDir resolves to <home>/sessions", () => {
	assert.equal(getDefaultSessionDir("/some/home"), resolve("/some/home", "sessions"));
});

test("getBootstrapStatePath resolves to <home>/.state/bootstrap.json", () => {
	assert.equal(getBootstrapStatePath("/some/home"), resolve("/some/home", ".state", "bootstrap.json"));
});

test("ensureAxorbisHome creates all required subdirectories", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-paths-"));
	try {
		const home = join(root, "home");
		ensureAxorbisHome(home);

		assert.ok(existsSync(home), "home dir should exist");
		assert.ok(existsSync(join(home, "active-org.json")), "active org manifest should exist");
		assert.ok(existsSync(join(home, "orgs")), "orgs dir should exist");
		assert.ok(existsSync(join(home, "agent")), "agent dir should exist");
		assert.ok(existsSync(join(home, "memory")), "memory dir should exist");
		assert.ok(existsSync(join(home, ".state")), ".state dir should exist");
		assert.ok(existsSync(join(home, "sessions")), "sessions dir should exist");
		const activeOrg = JSON.parse(readFileSync(join(home, "active-org.json"), "utf8")) as { org_uuid?: string; login_owner_data_dir?: string };
		assert.equal(activeOrg.login_owner_data_dir, home);
		assert.match(activeOrg.org_uuid ?? "", /^[0-9a-f-]{36}$/);
		assert.ok(existsSync(join(home, "orgs", activeOrg.org_uuid ?? "")), "active org dir should exist");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("ensureAxorbisHome is idempotent when dirs already exist", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-paths-"));
	try {
		const home = join(root, "home");
		ensureAxorbisHome(home);
		assert.doesNotThrow(() => ensureAxorbisHome(home));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("ensureAxorbisActiveOrg preserves a reference-shaped existing active org", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-paths-"));
	try {
		const home = join(root, "home");
		mkdirSync(home, { recursive: true });
		const orgUuid = "11111111-1111-4111-8111-111111111111";
		const accountUuid = "22222222-2222-4222-8222-222222222222";
		writeFileSync(getAxorbisActiveOrgPath(home), `${JSON.stringify({
			org_uuid: orgUuid,
			org_name: "Lab Org",
			account_uuid: accountUuid,
			login_owner_data_dir: home,
		}, null, 2)}\n`);

		const activeOrg = ensureAxorbisActiveOrg(home);

		assert.equal(activeOrg.org_uuid, orgUuid);
		assert.equal(activeOrg.org_name, "Lab Org");
		assert.equal(activeOrg.account_uuid, accountUuid);
		assert.equal(getAxorbisActiveOrgDir(home), join(home, "orgs", orgUuid));
		assert.ok(existsSync(join(home, "orgs", orgUuid)));
		const persisted = JSON.parse(readFileSync(getAxorbisActiveOrgPath(home), "utf8")) as { schema?: string };
		assert.equal(persisted.schema, "feynman.activeOrg.v1");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("ensureAxorbisActiveOrg does not rewrite a valid manifest", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-paths-"));
	try {
		const home = join(root, "home");
		const activeOrg = ensureAxorbisActiveOrg(home);
		const path = getAxorbisActiveOrgPath(home);
		const before = statSync(path, { bigint: true });

		for (let index = 0; index < 20; index += 1) {
			assert.equal(ensureAxorbisActiveOrg(home).org_uuid, activeOrg.org_uuid);
		}

		const after = statSync(path, { bigint: true });
		assert.equal(after.mtimeNs, before.mtimeNs);
		assert.equal(after.ino, before.ino);
		assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), activeOrg);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
