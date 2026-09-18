import { randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const ACTIVE_ORG_SCHEMA = "feynman.activeOrg.v1";

export type AxorbisActiveOrg = {
	schema: typeof ACTIVE_ORG_SCHEMA;
	org_uuid: string;
	org_name: string;
	account_uuid: string;
	login_owner_data_dir: string;
};

export function getAxorbisHome(): string {
	return resolve(process.env.AXORBIS_HOME ?? homedir(), ".axorbis");
}

export function getAxorbisOrgsDir(home = getAxorbisHome()): string {
	return resolve(home, "orgs");
}

export function getAxorbisActiveOrgPath(home = getAxorbisHome()): string {
	return resolve(home, "active-org.json");
}

export function getAxorbisAgentDir(home = getAxorbisHome()): string {
	return resolve(home, "agent");
}

export function getAxorbisMemoryDir(home = getAxorbisHome()): string {
	return resolve(home, "memory");
}

export function getAxorbisStateDir(home = getAxorbisHome()): string {
	return resolve(home, ".state");
}

export function getDefaultSessionDir(home = getAxorbisHome()): string {
	return resolve(home, "sessions");
}

export function getBootstrapStatePath(home = getAxorbisHome()): string {
	return resolve(getAxorbisStateDir(home), "bootstrap.json");
}

function normalizeActiveOrg(home: string, value: unknown): AxorbisActiveOrg | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	const orgUuid = typeof record.org_uuid === "string" && record.org_uuid.trim() ? record.org_uuid.trim() : undefined;
	if (!orgUuid) return undefined;
	const accountUuid = typeof record.account_uuid === "string" && record.account_uuid.trim()
		? record.account_uuid.trim()
		: randomUUID();
	const orgName = typeof record.org_name === "string" && record.org_name.trim()
		? record.org_name.trim()
		: "Axorbis Local Workspace";
	const ownerDir = typeof record.login_owner_data_dir === "string" && record.login_owner_data_dir.trim()
		? record.login_owner_data_dir.trim()
		: home;
	return {
		schema: ACTIVE_ORG_SCHEMA,
		org_uuid: orgUuid,
		org_name: orgName,
		account_uuid: accountUuid,
		login_owner_data_dir: ownerDir,
	};
}

function activeOrgJson(org: AxorbisActiveOrg): string {
	return `${JSON.stringify(org, null, 2)}\n`;
}

function writeActiveOrgAtomic(path: string, org: AxorbisActiveOrg): void {
	const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporaryPath, activeOrgJson(org), { encoding: "utf8", mode: 0o600, flag: "wx" });
		renameSync(temporaryPath, path);
	} finally {
		rmSync(temporaryPath, { force: true });
	}
}

function createActiveOrg(path: string, org: AxorbisActiveOrg): boolean {
	const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporaryPath, activeOrgJson(org), { encoding: "utf8", mode: 0o600, flag: "wx" });
		try {
			linkSync(temporaryPath, path);
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
			throw error;
		}
	} finally {
		rmSync(temporaryPath, { force: true });
	}
}

export function ensureAxorbisActiveOrg(home = getAxorbisHome()): AxorbisActiveOrg {
	mkdirSync(home, { recursive: true });
	mkdirSync(getAxorbisOrgsDir(home), { recursive: true });
	const path = getAxorbisActiveOrgPath(home);
	if (existsSync(path)) {
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
			const normalized = normalizeActiveOrg(home, parsed);
			if (normalized) {
				if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
					writeActiveOrgAtomic(path, normalized);
				}
				mkdirSync(resolve(getAxorbisOrgsDir(home), normalized.org_uuid), { recursive: true });
				return normalized;
			}
		} catch {
			// Fall through and create a fresh local org manifest below.
		}
	}
	const org: AxorbisActiveOrg = {
		schema: ACTIVE_ORG_SCHEMA,
		org_uuid: randomUUID(),
		org_name: "Axorbis Local Workspace",
		account_uuid: randomUUID(),
		login_owner_data_dir: home,
	};
	if (!createActiveOrg(path, org)) {
		try {
			const existing = normalizeActiveOrg(home, JSON.parse(readFileSync(path, "utf8")));
			if (existing) {
				mkdirSync(resolve(getAxorbisOrgsDir(home), existing.org_uuid), { recursive: true });
				return existing;
			}
		} catch {
			// An existing invalid manifest is replaced atomically below.
		}
		writeActiveOrgAtomic(path, org);
	}
	mkdirSync(resolve(getAxorbisOrgsDir(home), org.org_uuid), { recursive: true });
	return org;
}

export function getAxorbisActiveOrgDir(home = getAxorbisHome()): string {
	return resolve(getAxorbisOrgsDir(home), ensureAxorbisActiveOrg(home).org_uuid);
}

export function getAxorbisOrgDatabasePath(home = getAxorbisHome()): string {
	return resolve(getAxorbisActiveOrgDir(home), "feynman-workbench.db");
}

export function ensureAxorbisHome(home = getAxorbisHome()): void {
	for (const dir of [
		home,
		getAxorbisOrgsDir(home),
		getAxorbisActiveOrgDir(home),
		getAxorbisAgentDir(home),
		getAxorbisMemoryDir(home),
		getAxorbisStateDir(home),
		getDefaultSessionDir(home),
	]) {
		mkdirSync(dir, { recursive: true });
	}
}
