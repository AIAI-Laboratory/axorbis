import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { upsertProviderConfig } from "../model/models-json.js";
import { migratedWorkbenchDataPath } from "./data-root.js";

export type AiProviderKind = "anthropic" | "openai" | "gemini" | "openrouter" | "lm-studio" | "ollama" | "litellm" | "custom";
export type AiCredentialRole = "inference" | "usage_admin";
export type AiProviderBillingMode = "billing" | "resource";

export type AiProviderBudget = {
	monthlyUsd?: number;
	sessionUsd?: number;
	warningPercent: number;
	hardStop: boolean;
};

export type AiProviderResourceLimits = {
	contextWindow?: number;
	maxConcurrentRequests?: number;
	cpuCores?: number;
	memoryMb?: number;
	gpuCount?: number;
	note?: string;
};

/** Public metadata for one subagent credential. The secret itself never leaves the vault. */
export type AiProviderSubagentKey = {
	id: string;
	configured: true;
	updatedAt?: string;
};

export type AiProviderPublic = {
	id: string;
	kind: AiProviderKind;
	name: string;
	endpoint: string;
	defaultModel?: string;
	models: string[];
	billingMode: AiProviderBillingMode;
	credentialRoles: Partial<Record<AiCredentialRole, { configured: boolean; updatedAt?: string }>>;
	subagentKeys: AiProviderSubagentKey[];
	budget: AiProviderBudget;
	resourceLimits?: AiProviderResourceLimits;
	usage: AiProviderUsageSummary;
	createdAt: string;
	updatedAt: string;
};

type AiProviderStored = Omit<AiProviderPublic, "credentialRoles" | "usage"> & {
	credentialRoles: Partial<Record<AiCredentialRole, { configured: boolean; updatedAt?: string }>>;
};

export type AiProviderUsageRecord = {
	id: string;
	providerId: string;
	sessionId: string;
	model?: string;
	inputTokens: number;
	outputTokens: number;
	/** Gemini usageMetadata.promptTokenCount (includes cached input). */
	promptTokenCount?: number;
	/** Gemini usageMetadata.candidatesTokenCount (answer tokens, excluding thinking). */
	candidatesTokenCount?: number;
	/** Gemini usageMetadata.thoughtsTokenCount. */
	thoughtsTokenCount: number;
	/** Gemini usageMetadata.cachedContentTokenCount. */
	cachedContentTokenCount: number;
	/** Gemini usageMetadata.toolUsePromptTokenCount. */
	toolUsePromptTokenCount: number;
	/** Gemini usageMetadata.totalTokenCount. */
	totalTokenCount: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	estimatedCostUsd?: number;
	providerReportedCostUsd?: number;
	keyId?: string;
	userId?: string;
	appId?: string;
	requestStartedAt?: string;
	latencyMs?: number;
	httpStatus?: number;
	errorCode?: string;
	createdAt: string;
};

export type AiProviderUsageSummary = {
	inputTokens: number;
	outputTokens: number;
	promptTokenCount: number;
	candidatesTokenCount: number;
	thoughtsTokenCount: number;
	cachedContentTokenCount: number;
	toolUsePromptTokenCount: number;
	totalTokenCount: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	estimatedCostUsd: number;
	providerReportedCostUsd?: number;
	monthCostUsd: number;
	sessionCostUsd: number;
	requestCount: number;
	rateLimitCount: number;
	lastRequest?: {
		model?: string;
		keyId?: string;
		appId?: string;
		userId?: string;
		requestStartedAt?: string;
		createdAt: string;
		latencyMs?: number;
		httpStatus?: number;
		errorCode?: string;
		totalTokenCount: number;
	};
	warning: boolean;
	hardStopped: boolean;
};

export type AiProviderConnectionResult = {
	ok: boolean;
	latencyMs: number;
	status?: number;
	detail: string;
};

type SecretEntry = { providerId: string; role: AiCredentialRole; keyId?: string; iv: string; ciphertext: string; tag: string; updatedAt: string };
type VaultStore = { schema: "feynman.aiProviderVault.v1"; entries: SecretEntry[] };
type ProviderStore = { schema: "feynman.aiProviders.v1"; providers: AiProviderStored[] };
type UsageStore = { schema: "feynman.aiProviderUsage.v1"; records: AiProviderUsageRecord[] };

const PROVIDER_SCHEMA = "feynman.aiProviders.v1" as const;
const VAULT_SCHEMA = "feynman.aiProviderVault.v1" as const;
const USAGE_SCHEMA = "feynman.aiProviderUsage.v1" as const;
const MAX_USAGE_RECORDS = 2_000;
const MAX_KEY_BYTES = 16_384;

type ProviderDefinition = {
	kind: AiProviderKind;
	name: string;
	endpoint: string;
	billingMode: AiProviderBillingMode;
	/** Pi's registry calls Gemini `google`, while the Settings schema calls it `gemini`. */
	piProviderId?: string;
	piApi?: "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";
	inferenceEnvVar?: string;
	usageAdmin: boolean;
};

export const AI_PROVIDER_DEFINITIONS: ProviderDefinition[] = [
	{ kind: "anthropic", name: "Anthropic", endpoint: "https://api.anthropic.com", billingMode: "billing", piApi: "anthropic-messages", inferenceEnvVar: "ANTHROPIC_API_KEY", usageAdmin: true },
	{ kind: "openai", name: "OpenAI", endpoint: "https://api.openai.com/v1", billingMode: "billing", piApi: "openai-responses", inferenceEnvVar: "OPENAI_API_KEY", usageAdmin: true },
	{ kind: "gemini", name: "Gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta", billingMode: "billing", piProviderId: "google", piApi: "google-generative-ai", inferenceEnvVar: "GEMINI_API_KEY", usageAdmin: false },
	{ kind: "openrouter", name: "OpenRouter", endpoint: "https://openrouter.ai/api/v1", billingMode: "billing", piApi: "openai-completions", inferenceEnvVar: "OPENROUTER_API_KEY", usageAdmin: true },
	{ kind: "lm-studio", name: "LM Studio", endpoint: "http://127.0.0.1:1234/v1", billingMode: "resource", piApi: "openai-completions", usageAdmin: false },
	{ kind: "ollama", name: "Ollama", endpoint: "http://127.0.0.1:11434", billingMode: "resource", piApi: "openai-completions", usageAdmin: false },
	{ kind: "litellm", name: "LiteLLM", endpoint: "http://127.0.0.1:4000/v1", billingMode: "billing", piApi: "openai-completions", inferenceEnvVar: "LITELLM_API_KEY", usageAdmin: true },
	{ kind: "custom", name: "Custom provider", endpoint: "", billingMode: "billing", piApi: "openai-completions", inferenceEnvVar: "FEYNMAN_CUSTOM_PROVIDER_API_KEY", usageAdmin: true },
];

function nowIso(): string { return new Date().toISOString(); }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown, max = 2_048): string | undefined { const result = typeof value === "string" ? value.trim() : ""; return result ? result.slice(0, max) : undefined; }
function finite(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function bool(value: unknown, fallback: boolean): boolean { return typeof value === "boolean" ? value : fallback; }
function id(value: unknown): string {
	const valueText = text(value, 100) ?? randomUUID();
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(valueText)) throw new Error("Provider id may contain only letters, numbers, dots, underscores, and hyphens.");
	return valueText;
}
function definition(kind: AiProviderKind): ProviderDefinition { return AI_PROVIDER_DEFINITIONS.find((item) => item.kind === kind)!; }
function kind(value: unknown): AiProviderKind {
	if (AI_PROVIDER_DEFINITIONS.some((item) => item.kind === value)) return value as AiProviderKind;
	throw new Error("Unsupported AI provider.");
}

/** Keep legacy Gemini model aliases working after the provider catalog adopted
 * the canonical `gemini-*` model ids. This only affects the known alias; all
 * other custom/provider model ids remain untouched. */
function normalizeProviderModelId(providerKind: AiProviderKind, value: string): string {
	if (providerKind !== "gemini") return value;
	const normalized = value.trim().toLowerCase().replaceAll("_", "-");
	const aliases: Record<string, string> = {
		"flash2.5-lite": "gemini-2.5-flash-lite",
		"flash-2.5-lite": "gemini-2.5-flash-lite",
		"2.5-flash-lite": "gemini-2.5-flash-lite",
		"gemini-2.5-lite": "gemini-2.5-flash-lite",
	};
	return aliases[normalized] ?? value;
}
function endpoint(value: unknown, fallback: string): string {
	const candidate = text(value) ?? fallback;
	if (!candidate) return "";
	let url: URL;
	try { url = new URL(candidate); } catch { throw new Error("Provider endpoint must be a valid HTTP(S) URL."); }
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Provider endpoint must use HTTP or HTTPS.");
	return url.toString().replace(/\/$/, "");
}
function models(value: unknown): string[] {
	const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,]/) : [];
	return Array.from(new Set(values.flatMap((item) => text(item, 160) ? [text(item, 160)!] : []))).slice(0, 100);
}
function budget(value: unknown): AiProviderBudget {
	const record = asRecord(value);
	const monthlyUsd = finite(record.monthlyUsd);
	const sessionUsd = finite(record.sessionUsd);
	const warningPercent = finite(record.warningPercent) ?? 80;
	if ((monthlyUsd !== undefined && monthlyUsd < 0) || (sessionUsd !== undefined && sessionUsd < 0)) throw new Error("Budgets cannot be negative.");
	if (warningPercent < 1 || warningPercent > 100) throw new Error("Budget warning threshold must be between 1 and 100.");
	return { ...(monthlyUsd !== undefined ? { monthlyUsd } : {}), ...(sessionUsd !== undefined ? { sessionUsd } : {}), warningPercent, hardStop: bool(record.hardStop, false) };
}
function resourceLimits(value: unknown): AiProviderResourceLimits | undefined {
	const record = asRecord(value);
	const contextWindow = finite(record.contextWindow);
	const maxConcurrentRequests = finite(record.maxConcurrentRequests);
	const cpuCores = finite(record.cpuCores);
	const memoryMb = finite(record.memoryMb);
	const gpuCount = finite(record.gpuCount);
	const note = text(record.note, 240);
	const limits = [contextWindow, maxConcurrentRequests, cpuCores, memoryMb, gpuCount];
	if (limits.some((limit) => limit !== undefined && (limit < 1 || !Number.isInteger(limit)))) throw new Error("Resource limits must be positive integers.");
	return limits.some((limit) => limit !== undefined) || note ? {
		...(contextWindow !== undefined ? { contextWindow } : {}),
		...(maxConcurrentRequests !== undefined ? { maxConcurrentRequests } : {}),
		...(cpuCores !== undefined ? { cpuCores } : {}),
		...(memoryMb !== undefined ? { memoryMb } : {}),
		...(gpuCount !== undefined ? { gpuCount } : {}),
		...(note ? { note } : {}),
	} : undefined;
}

function providerPath(workingDir: string): string { return migratedWorkbenchDataPath(workingDir, "ai-providers.json"); }
function vaultPath(workingDir: string): string { return migratedWorkbenchDataPath(workingDir, "ai-provider-vault.json"); }
function vaultKeyPath(workingDir: string): string { return migratedWorkbenchDataPath(workingDir, "ai-provider-vault.key"); }
function usagePath(workingDir: string): string { return migratedWorkbenchDataPath(workingDir, "ai-provider-usage.json"); }

function ensurePrivatePath(path: string): void {
	const dir = dirname(path);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) throw new Error("AI provider storage directory cannot be a symbolic link.");
	try { chmodSync(dir, 0o700); } catch { /* Windows ACLs are handled by the OS. */ }
	if (existsSync(path)) {
		const stat = lstatSync(path);
		if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("AI provider storage must be a regular file.");
		try { chmodSync(path, 0o600); } catch { /* Windows ACLs are handled by the OS. */ }
	}
}
function readJson<T>(path: string, fallback: T): T {
	ensurePrivatePath(path);
	if (!existsSync(path)) return fallback;
	try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; }
}
function writeJson(path: string, value: unknown): void {
	ensurePrivatePath(path);
	const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
		renameSync(temp, path);
		try { chmodSync(path, 0o600); } catch { /* Windows ACLs are handled by the OS. */ }
	} finally { rmSync(temp, { force: true }); }
}
function vaultKey(workingDir: string): Buffer {
	const path = vaultKeyPath(workingDir);
	ensurePrivatePath(path);
	if (existsSync(path)) {
		const key = Buffer.from(readFileSync(path, "utf8").trim(), "base64");
		if (key.length === 32) return key;
		throw new Error("AI provider vault key is invalid.");
	}
	const key = randomBytes(32);
	writeFileSync(path, `${key.toString("base64")}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
	return key;
}
function encryptSecret(workingDir: string, value: string): Pick<SecretEntry, "iv" | "ciphertext" | "tag"> {
	const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", vaultKey(workingDir), iv);
	const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
	return { iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}
function decryptSecret(workingDir: string, entry: SecretEntry): string {
	const decipher = createDecipheriv("aes-256-gcm", vaultKey(workingDir), Buffer.from(entry.iv, "base64"));
	decipher.setAuthTag(Buffer.from(entry.tag, "base64"));
	return Buffer.concat([decipher.update(Buffer.from(entry.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
function readProviderStore(workingDir: string): ProviderStore {
	const raw = readJson<Partial<ProviderStore>>(providerPath(workingDir), {});
	return { schema: PROVIDER_SCHEMA, providers: Array.isArray(raw.providers) ? raw.providers.filter((item): item is AiProviderStored => Boolean(item && typeof item === "object")) : [] };
}
function writeProviderStore(workingDir: string, providers: AiProviderStored[]): void { writeJson(providerPath(workingDir), { schema: PROVIDER_SCHEMA, providers }); }
function readVault(workingDir: string): VaultStore {
	const raw = readJson<Partial<VaultStore>>(vaultPath(workingDir), {});
	return { schema: VAULT_SCHEMA, entries: Array.isArray(raw.entries) ? raw.entries.filter((item): item is SecretEntry => Boolean(item && typeof item === "object")) : [] };
}
function writeVault(workingDir: string, entries: SecretEntry[]): void { writeJson(vaultPath(workingDir), { schema: VAULT_SCHEMA, entries }); }
function readUsage(workingDir: string): UsageStore {
	const raw = readJson<Partial<UsageStore>>(usagePath(workingDir), {});
	return { schema: USAGE_SCHEMA, records: Array.isArray(raw.records) ? raw.records.filter((item): item is AiProviderUsageRecord => Boolean(item && typeof item === "object")) : [] };
}
function writeUsage(workingDir: string, records: AiProviderUsageRecord[]): void { writeJson(usagePath(workingDir), { schema: USAGE_SCHEMA, records: records.slice(-MAX_USAGE_RECORDS) }); }

function parseStored(record: Record<string, unknown>): AiProviderStored {
	const providerKind = kind(record.kind);
	const def = definition(providerKind);
	const createdAt = text(record.createdAt, 64) ?? nowIso();
	const roleRecords = asRecord(record.credentialRoles);
	const roles: AiProviderStored["credentialRoles"] = {};
	for (const role of ["inference", "usage_admin"] as const) {
		const source = asRecord(roleRecords[role]);
		if (source.configured === true) roles[role] = { configured: true, ...(text(source.updatedAt, 64) ? { updatedAt: text(source.updatedAt, 64) } : {}) };
	}
	const subagentKeys = Array.isArray(record.subagentKeys)
		? record.subagentKeys.flatMap((item): AiProviderSubagentKey[] => {
			const source = asRecord(item);
			const keyId = text(source.id, 100);
			if (!keyId || source.configured !== true) return [];
			return [{ id: keyId, configured: true, ...(text(source.updatedAt, 64) ? { updatedAt: text(source.updatedAt, 64) } : {}) }];
		}).slice(0, 100)
		: [];
	const output: AiProviderStored = {
		id: id(record.id), kind: providerKind, name: text(record.name, 120) ?? def.name,
		endpoint: endpoint(record.endpoint, def.endpoint), ...(text(record.defaultModel, 160) ? { defaultModel: text(record.defaultModel, 160) } : {}),
		models: models(record.models), billingMode: def.billingMode, credentialRoles: roles, subagentKeys, budget: budget(record.budget), createdAt, updatedAt: text(record.updatedAt, 64) ?? createdAt,
	};
	const limits = resourceLimits(record.resourceLimits);
	if (limits) output.resourceLimits = limits;
	if (output.defaultModel && output.models.length && !output.models.includes(output.defaultModel)) throw new Error("Default model must be included in the provider model list.");
	return output;
}

function usageNumber(value: unknown): number { return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0; }
function monthKey(date: string): string { return date.slice(0, 7); }
function cost(record: AiProviderUsageRecord): number { return record.providerReportedCostUsd ?? record.estimatedCostUsd ?? 0; }
function recordNumber(value: number | undefined): number { return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0; }

export function summarizeAiProviderUsage(provider: AiProviderStored, records: AiProviderUsageRecord[], sessionId?: string): AiProviderUsageSummary {
	const currentMonth = monthKey(nowIso());
	const providerRecords = records.filter((record) => record.providerId === provider.id);
	const monthly = providerRecords.filter((record) => monthKey(record.createdAt) === currentMonth);
	const session = sessionId ? providerRecords.filter((record) => record.sessionId === sessionId) : [];
	const sum = (items: AiProviderUsageRecord[], getter: (record: AiProviderUsageRecord) => number) => items.reduce((total, record) => total + getter(record), 0);
	const monthCostUsd = sum(monthly, cost); const sessionCostUsd = sum(session, cost);
	const totalCost = providerRecords.reduce((total, record) => total + (record.estimatedCostUsd ?? 0), 0);
	const reported = providerRecords.some((record) => record.providerReportedCostUsd !== undefined) ? sum(providerRecords, (record) => record.providerReportedCostUsd ?? 0) : undefined;
	const limits = [provider.budget.monthlyUsd ? monthCostUsd / provider.budget.monthlyUsd : 0, provider.budget.sessionUsd && sessionId ? sessionCostUsd / provider.budget.sessionUsd : 0];
	const maxRatio = Math.max(...limits);
	const hardStopped = provider.billingMode === "billing" && provider.budget.hardStop && ((provider.budget.monthlyUsd !== undefined && monthCostUsd >= provider.budget.monthlyUsd) || (provider.budget.sessionUsd !== undefined && Boolean(sessionId) && sessionCostUsd >= provider.budget.sessionUsd));
	const last = providerRecords
		.slice()
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
		.at(-1);
	return {
		inputTokens: sum(providerRecords, (record) => recordNumber(record.inputTokens)),
		outputTokens: sum(providerRecords, (record) => recordNumber(record.outputTokens)),
		promptTokenCount: sum(providerRecords, (record) => recordNumber(record.promptTokenCount)),
		candidatesTokenCount: sum(providerRecords, (record) => recordNumber(record.candidatesTokenCount)),
		thoughtsTokenCount: sum(providerRecords, (record) => recordNumber(record.thoughtsTokenCount)),
		cachedContentTokenCount: sum(providerRecords, (record) => recordNumber(record.cachedContentTokenCount)),
		toolUsePromptTokenCount: sum(providerRecords, (record) => recordNumber(record.toolUsePromptTokenCount)),
		totalTokenCount: sum(providerRecords, (record) => recordNumber(record.totalTokenCount)),
		cacheReadTokens: sum(providerRecords, (record) => recordNumber(record.cacheReadTokens)),
		cacheWriteTokens: sum(providerRecords, (record) => recordNumber(record.cacheWriteTokens)),
		estimatedCostUsd: totalCost,
		...(reported !== undefined ? { providerReportedCostUsd: reported } : {}),
		monthCostUsd,
		sessionCostUsd,
		requestCount: providerRecords.length,
		rateLimitCount: providerRecords.filter((record) => record.httpStatus === 429 || record.errorCode === "429").length,
		...(last ? {
			lastRequest: {
				...(last.model ? { model: last.model } : {}),
				...(last.keyId ? { keyId: last.keyId } : {}),
				...(last.appId ? { appId: last.appId } : {}),
				...(last.userId ? { userId: last.userId } : {}),
				...(last.requestStartedAt ? { requestStartedAt: last.requestStartedAt } : {}),
				createdAt: last.createdAt,
				...(last.latencyMs !== undefined ? { latencyMs: last.latencyMs } : {}),
				...(last.httpStatus !== undefined ? { httpStatus: last.httpStatus } : {}),
				...(last.errorCode ? { errorCode: last.errorCode } : {}),
				totalTokenCount: recordNumber(last.totalTokenCount),
			},
		} : {}),
		warning: provider.billingMode === "billing" && maxRatio >= provider.budget.warningPercent / 100,
		hardStopped,
	};
}

function publicProvider(provider: AiProviderStored, records: AiProviderUsageRecord[], sessionId?: string): AiProviderPublic { return { ...provider, usage: summarizeAiProviderUsage(provider, records, sessionId) }; }

export function listAiProviders(workingDir: string, sessionId?: string): AiProviderPublic[] {
	const records = readUsage(workingDir).records;
	return readProviderStore(workingDir).providers.map((provider) => publicProvider(provider, records, sessionId)).sort((a, b) => a.name.localeCompare(b.name));
}

export function upsertAiProvider(workingDir: string, input: Record<string, unknown>): AiProviderPublic {
	if ("apiKey" in input || "key" in input || "secret" in input) throw new Error("Use inferenceApiKey or usageAdminApiKey; secret fields are never stored in provider metadata.");
	const provider = parseStored(input);
	const store = readProviderStore(workingDir);
	const previous = store.providers.find((item) => item.id === provider.id);
	provider.createdAt = previous?.createdAt ?? provider.createdAt;
	// Credential metadata is owned by the vault. Ordinary settings edits must not
	// accidentally clear an existing key or let a caller forge its configured state.
	provider.credentialRoles = { ...previous?.credentialRoles };
	provider.subagentKeys = [...(previous?.subagentKeys ?? provider.subagentKeys)];
	provider.updatedAt = nowIso();
	const providedSecrets: Array<[AiCredentialRole, string | undefined]> = [["inference", text(input.inferenceApiKey, MAX_KEY_BYTES)], ["usage_admin", text(input.usageAdminApiKey, MAX_KEY_BYTES)]];
	const vault = readVault(workingDir);
	for (const [role, value] of providedSecrets) {
		if (value === undefined) continue;
		vault.entries = vault.entries.filter((entry) => !(entry.providerId === provider.id && entry.role === role && (!entry.keyId || entry.keyId === "main")));
		if (value) {
			vault.entries.push({ providerId: provider.id, role, ...encryptSecret(workingDir, value), updatedAt: provider.updatedAt });
			provider.credentialRoles[role] = { configured: true, updatedAt: provider.updatedAt };
		} else delete provider.credentialRoles[role];
	}
	const removeSubagentKeyIds = Array.isArray(input.removeSubagentInferenceKeyIds)
		? input.removeSubagentInferenceKeyIds.filter((value): value is string => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)).slice(0, 100)
		: [];
	if (removeSubagentKeyIds.length) {
		const removed = new Set(removeSubagentKeyIds);
		vault.entries = vault.entries.filter((entry) => !(entry.providerId === provider.id && entry.role === "inference" && entry.keyId && removed.has(entry.keyId)));
		provider.subagentKeys = provider.subagentKeys.filter((key) => !removed.has(key.id));
		provider.updatedAt = nowIso();
	}
	const addedSubagentKeys = Array.isArray(input.subagentInferenceApiKeys)
		? input.subagentInferenceApiKeys.flatMap((value): string[] => {
			const key = text(value, MAX_KEY_BYTES);
			return key ? [key] : [];
		}).slice(0, 100)
		: [];
	for (const value of addedSubagentKeys) {
		const keyId = randomUUID();
		vault.entries.push({ providerId: provider.id, role: "inference", keyId, ...encryptSecret(workingDir, value), updatedAt: provider.updatedAt });
		provider.subagentKeys.push({ id: keyId, configured: true, updatedAt: provider.updatedAt });
	}
	writeVault(workingDir, vault.entries);
	writeProviderStore(workingDir, [...store.providers.filter((item) => item.id !== provider.id), provider]);
	return publicProvider(provider, readUsage(workingDir).records);
}

export function removeAiProviderCredential(workingDir: string, providerId: string, role: AiCredentialRole): AiProviderPublic {
	const store = readProviderStore(workingDir); const provider = store.providers.find((item) => item.id === providerId);
	if (!provider) throw new Error("AI provider was not found.");
	const vault = readVault(workingDir); writeVault(workingDir, vault.entries.filter((entry) => !(entry.providerId === provider.id && entry.role === role && (!entry.keyId || entry.keyId === "main"))));
	delete provider.credentialRoles[role]; provider.updatedAt = nowIso(); writeProviderStore(workingDir, store.providers);
	return publicProvider(provider, readUsage(workingDir).records);
}

export function removeAiProvider(workingDir: string, providerId: string): void {
	const store = readProviderStore(workingDir); writeProviderStore(workingDir, store.providers.filter((provider) => provider.id !== providerId));
	const vault = readVault(workingDir); writeVault(workingDir, vault.entries.filter((entry) => entry.providerId !== providerId));
}

function secretFor(workingDir: string, providerId: string, role: AiCredentialRole): string | undefined {
	const entry = readVault(workingDir).entries.find((item) => item.providerId === providerId && item.role === role && (!item.keyId || item.keyId === "main"));
	return entry ? decryptSecret(workingDir, entry) : undefined;
}

function subagentSecretsFor(workingDir: string, provider: AiProviderStored): Array<{ id: string; value: string }> {
	const entries = readVault(workingDir).entries.filter((item) => item.providerId === provider.id && item.role === "inference" && item.keyId && item.keyId !== "main");
	const byId = new Map(entries.map((entry) => [entry.keyId!, entry]));
	const ordered = provider.subagentKeys.map((key) => ({ id: key.id, entry: byId.get(key.id) })).filter((item): item is { id: string; entry: SecretEntry } => Boolean(item.entry));
	return ordered.map(({ id, entry }) => ({ id, value: decryptSecret(workingDir, entry) }));
}

/** Resolve a Pi model prefix back to the provider id used by the Settings store. */
export function aiProviderIdForModel(workingDir: string, explicitModel?: string): string | undefined {
	const prefix = explicitModel?.split("/", 1)[0];
	if (!prefix) return undefined;
	return readProviderStore(workingDir).providers.find((provider) => provider.id === prefix || definition(provider.kind).piProviderId === prefix)?.id;
}

export function getAiProviderRuntimeEnv(workingDir: string, explicitModel?: string): NodeJS.ProcessEnv {
	const requestedProvider = aiProviderIdForModel(workingDir, explicitModel);
	const provider = readProviderStore(workingDir).providers.find((item) => item.id === requestedProvider)
		?? readProviderStore(workingDir).providers.find((item) => item.defaultModel && (!explicitModel || explicitModel === `${definition(item.kind).piProviderId ?? item.id}/${item.defaultModel}`));
	if (!provider) return {};
	const inferenceKey = secretFor(workingDir, provider.id, "inference");
	const env: NodeJS.ProcessEnv = {
		FEYNMAN_AI_PROVIDER_ID: provider.id,
		FEYNMAN_AI_PROVIDER_ENDPOINT: provider.endpoint,
		...(explicitModel ? { AXORBIS_SUBAGENT_PARENT_MODEL: explicitModel } : {}),
	};
	const envVar = definition(provider.kind).inferenceEnvVar;
	if (inferenceKey && envVar) env[envVar] = inferenceKey;
	const subagentConfig = buildSubagentRuntimeConfig(workingDir, provider, explicitModel);
	Object.assign(env, subagentConfig.env);
	return env;
}

type SubagentRuntimeConfig = { env: Record<string, string>; aliases: Record<string, string[]> };

function safeAliasPart(value: string): string {
	const normalized = value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
	return (normalized || "provider").slice(0, 48);
}

function buildSubagentRuntimeConfig(workingDir: string, provider: AiProviderStored, explicitModel?: string): SubagentRuntimeConfig {
	const keys = subagentSecretsFor(workingDir, provider);
	const def = definition(provider.kind);
	const piProviderId = def.piProviderId ?? provider.id;
	const modelFromSpec = explicitModel?.startsWith(`${piProviderId}/`)
		? explicitModel.slice(piProviderId.length + 1).split(":", 1)[0]
		: explicitModel?.startsWith(`${provider.id}/`) ? explicitModel.slice(provider.id.length + 1).split(":", 1)[0] : undefined;
	const modelIds = Array.from(new Set([
		...provider.models.map((model) => normalizeProviderModelId(provider.kind, model)),
		...(provider.defaultModel ? [normalizeProviderModelId(provider.kind, provider.defaultModel)] : []),
		...(modelFromSpec ? [modelFromSpec] : []),
	]));
	if (!keys.length || !modelIds.length || !def.inferenceEnvVar) return { env: {}, aliases: {} };
	const env: Record<string, string> = {};
	const aliases: Record<string, string[]> = {};
	for (let index = 0; index < keys.length; index += 1) {
		const envVar = `AXORBIS_SUBAGENT_KEY_${safeAliasPart(provider.id).toUpperCase().replace(/[^A-Z0-9_]/g, "_")}_${index}`;
		env[envVar] = keys[index]!.value;
		const aliasProvider = `axorbis_subagent_${safeAliasPart(provider.id)}_${index}`;
		for (const modelId of modelIds) {
			const alias = `${aliasProvider}/${modelId}`;
			for (const source of [`${piProviderId}/${modelId}`, `${provider.id}/${modelId}`]) {
				aliases[source] = [...(aliases[source] ?? []), alias];
			}
		}
	}
	env.AXORBIS_SUBAGENT_MODEL_ALIASES = JSON.stringify(aliases);
	return { env, aliases };
}

/** Writes endpoint/model metadata only; Pi resolves the secret from its child env. */
export function syncAiProviderPiConfig(workingDir: string, modelsJsonPath: string, explicitModel?: string): void {
	const resolvedModel = normalizeAiProviderModel(workingDir, explicitModel);
	const providerId = aiProviderIdForModel(workingDir, resolvedModel);
	const provider = readProviderStore(workingDir).providers.find((item) => item.id === providerId);
	if (!provider) return;
	const def = definition(provider.kind);
	const piProviderId = def.piProviderId ?? provider.id;
	const modelFromSpec = resolvedModel?.startsWith(`${piProviderId}/`)
		? resolvedModel.slice(piProviderId.length + 1).split(":", 1)[0]
		: resolvedModel?.startsWith(`${provider.id}/`) ? resolvedModel.slice(provider.id.length + 1).split(":", 1)[0] : undefined;
	const modelIds = Array.from(new Set([
		...provider.models.map((model) => normalizeProviderModelId(provider.kind, model)),
		...(provider.defaultModel ? [normalizeProviderModelId(provider.kind, provider.defaultModel)] : []),
		...(modelFromSpec ? [modelFromSpec] : []),
	]));
	const result = upsertProviderConfig(modelsJsonPath, piProviderId, {
		baseUrl: provider.endpoint, apiKey: def.inferenceEnvVar ? `$${def.inferenceEnvVar}` : "local", api: def.piApi,
		authHeader: provider.kind !== "gemini" && provider.kind !== "ollama" && provider.kind !== "lm-studio",
		...(modelIds.length ? { models: modelIds.map((id) => ({ id })) } : {}),
	});
	if (!result.ok) throw new Error(`Could not configure AI provider for Pi: ${result.error}`);
	const subagentKeys = subagentSecretsFor(workingDir, provider);
	for (let index = 0; index < subagentKeys.length; index += 1) {
		const aliasProvider = `axorbis_subagent_${safeAliasPart(provider.id)}_${index}`;
		const envVar = `AXORBIS_SUBAGENT_KEY_${safeAliasPart(provider.id).toUpperCase().replace(/[^A-Z0-9_]/g, "_")}_${index}`;
		const aliasResult = upsertProviderConfig(modelsJsonPath, aliasProvider, {
			baseUrl: provider.endpoint,
			apiKey: `$${envVar}`,
			api: def.piApi,
			authHeader: provider.kind !== "gemini" && provider.kind !== "ollama" && provider.kind !== "lm-studio",
			...(modelIds.length ? { models: modelIds.map((id) => ({ id })) } : {}),
		});
		if (!aliasResult.ok) throw new Error(`Could not configure subagent AI provider for Pi: ${aliasResult.error}`);
	}
}

export function defaultAiProviderModel(workingDir: string): string | undefined {
	const provider = readProviderStore(workingDir).providers.find((item) => item.defaultModel);
	return provider?.defaultModel ? `${definition(provider.kind).piProviderId ?? provider.id}/${normalizeProviderModelId(provider.kind, provider.defaultModel)}` : undefined;
}

/** Resolve a persisted provider/model spec to the canonical runtime model id. */
export function normalizeAiProviderModel(workingDir: string, explicitModel?: string): string | undefined {
	if (!explicitModel) return undefined;
	const separator = explicitModel.indexOf("/");
	if (separator <= 0 || separator === explicitModel.length - 1) return explicitModel;
	const prefix = explicitModel.slice(0, separator);
	const model = explicitModel.slice(separator + 1);
	const provider = readProviderStore(workingDir).providers.find((item) => item.id === prefix || definition(item.kind).piProviderId === prefix);
	return provider ? `${prefix}/${normalizeProviderModelId(provider.kind, model)}` : explicitModel;
}

export function assertAiProviderBudget(workingDir: string, sessionId: string, explicitModel?: string): void {
	const providerId = aiProviderIdForModel(workingDir, explicitModel);
	const provider = readProviderStore(workingDir).providers.find((item) => item.id === providerId);
	if (!provider) return;
	const usage = summarizeAiProviderUsage(provider, readUsage(workingDir).records, sessionId);
	if (usage.hardStopped) throw new Error("AI provider budget has reached its configured hard stop. Increase the budget or turn off hard stop to continue.");
}

export function recordAiProviderUsage(workingDir: string, input: {
	providerId?: string;
	sessionId: string;
	model?: string;
	usage: Record<string, unknown>;
	keyId?: string;
	userId?: string;
	appId?: string;
	requestStartedAt?: string;
	latencyMs?: number;
	httpStatus?: number;
	errorCode?: string;
}): AiProviderUsageRecord | undefined {
	const providerId = text(input.providerId, 100);
	if (!providerId || !input.sessionId) return undefined;
	const usage = input.usage;
	const costObject = asRecord(usage.cost);
	const promptTokenCount = usageNumber(usage.promptTokenCount ?? usage.prompt_token_count);
	const cachedContentTokenCount = usageNumber(usage.cachedContentTokenCount ?? usage.cached_content_token_count ?? usage.cacheReadTokens ?? usage.cache_read_tokens);
	const thoughtsTokenCount = usageNumber(usage.thoughtsTokenCount ?? usage.thoughts_token_count ?? usage.reasoningTokens ?? usage.reasoning_tokens ?? usage.reasoning);
	const candidatesTokenCount = usageNumber(usage.candidatesTokenCount ?? usage.candidates_token_count)
		|| Math.max(0, usageNumber(usage.outputTokens ?? usage.output_tokens) - thoughtsTokenCount);
	const inputTokens = usageNumber(usage.inputTokens ?? usage.input_tokens)
		|| Math.max(0, promptTokenCount - cachedContentTokenCount);
	const outputTokens = usageNumber(usage.outputTokens ?? usage.output_tokens)
		|| candidatesTokenCount + thoughtsTokenCount;
	const totalTokenCount = usageNumber(usage.totalTokenCount ?? usage.total_tokens)
		|| inputTokens + outputTokens + cachedContentTokenCount;
	const toolUsePromptTokenCount = usageNumber(usage.toolUsePromptTokenCount ?? usage.tool_use_prompt_token_count ?? usage.toolUseTokens);
	const estimatedCostUsd = finite(usage.estimatedCostUsd) ?? finite(costObject.total) ?? finite(costObject.estimated);
	const providerReportedCostUsd = finite(usage.providerReportedCostUsd) ?? finite(costObject.providerReported);
	const record: AiProviderUsageRecord = {
		id: randomUUID(),
		providerId,
		sessionId: input.sessionId,
		...(text(input.model, 160) ? { model: text(input.model, 160) } : {}),
		inputTokens,
		outputTokens,
		...(promptTokenCount > 0 ? { promptTokenCount } : {}),
		...(candidatesTokenCount > 0 ? { candidatesTokenCount } : {}),
		thoughtsTokenCount,
		cachedContentTokenCount,
		toolUsePromptTokenCount,
		totalTokenCount,
		cacheReadTokens: cachedContentTokenCount || usageNumber(usage.cacheReadTokens ?? usage.cache_read_tokens),
		cacheWriteTokens: usageNumber(usage.cacheWriteTokens ?? usage.cache_write_tokens),
		...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
		...(providerReportedCostUsd !== undefined ? { providerReportedCostUsd } : {}),
		...(text(input.keyId, 120) ? { keyId: text(input.keyId, 120) } : {}),
		...(text(input.userId, 120) ? { userId: text(input.userId, 120) } : {}),
		...(text(input.appId, 120) ? { appId: text(input.appId, 120) } : {}),
		...(text(input.requestStartedAt, 64) ? { requestStartedAt: text(input.requestStartedAt, 64) } : {}),
		...(input.latencyMs !== undefined && Number.isFinite(input.latencyMs) ? { latencyMs: Math.max(0, Math.round(input.latencyMs)) } : {}),
		...(input.httpStatus !== undefined && Number.isFinite(input.httpStatus) ? { httpStatus: Math.round(input.httpStatus) } : {}),
		...(text(input.errorCode, 120) ? { errorCode: text(input.errorCode, 120) } : {}),
		createdAt: nowIso(),
	};
	const store = readUsage(workingDir); writeUsage(workingDir, [...store.records, record]); return record;
}

function probeUrl(provider: AiProviderStored): string {
	if (provider.kind === "ollama") return `${provider.endpoint}/api/tags`;
	return `${provider.endpoint.replace(/\/$/, "")}/models`;
}
export async function testAiProviderConnection(workingDir: string, providerId: string, fetcher: typeof fetch = fetch): Promise<AiProviderConnectionResult> {
	const provider = readProviderStore(workingDir).providers.find((item) => item.id === providerId);
	if (!provider) throw new Error("AI provider was not found.");
	const key = secretFor(workingDir, provider.id, "inference"); const startedAt = Date.now();
	const headers: Record<string, string> = { accept: "application/json" };
	if (key) {
		if (provider.kind === "anthropic") { headers["x-api-key"] = key; headers["anthropic-version"] = "2023-06-01"; }
		else if (provider.kind === "gemini") headers["x-goog-api-key"] = key;
		else headers.authorization = `Bearer ${key}`;
	}
	try {
		const response = await fetcher(probeUrl(provider), { headers, signal: AbortSignal.timeout(10_000) });
		return { ok: response.ok, latencyMs: Date.now() - startedAt, status: response.status, detail: response.ok ? "Connection verified." : `Provider returned HTTP ${response.status}.` };
	} catch { return { ok: false, latencyMs: Date.now() - startedAt, detail: "Provider connection could not be completed." }; }
}
