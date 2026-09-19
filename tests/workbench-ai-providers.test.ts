import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	AI_PROVIDER_DEFINITIONS,
	aiProviderIdForModel,
	assertAiProviderBudget,
	defaultAiProviderModel,
	getAiProviderRuntimeEnv,
	listAiProviders,
	normalizeAiProviderModel,
	recordAiProviderUsage,
	removeAiProviderCredential,
	syncAiProviderPiConfig,
	testAiProviderConnection,
	upsertAiProvider,
} from "../engine/workbench/ai-providers.js";
import { workbenchDataPath } from "../engine/workbench/data-root.js";

async function withIsolatedWorkbench<T>(run: (root: string) => T | Promise<T>): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "feynman-ai-provider-home-"));
	const root = mkdtempSync(join(tmpdir(), "feynman-ai-provider-workspace-"));
	const previousHome = process.env.AXORBIS_HOME;
	const previousWorkbenchHome = process.env.AXORBIS_WORKBENCH_HOME;
	process.env.AXORBIS_HOME = home;
	process.env.AXORBIS_WORKBENCH_HOME = join(home, "workbench");
	try { return await run(root); }
	finally {
		if (previousHome === undefined) delete process.env.AXORBIS_HOME; else process.env.AXORBIS_HOME = previousHome;
		if (previousWorkbenchHome === undefined) delete process.env.AXORBIS_WORKBENCH_HOME; else process.env.AXORBIS_WORKBENCH_HOME = previousWorkbenchHome;
		rmSync(home, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true });
	}
}

test("AI provider catalog and vault persist redacted generic BYOK metadata", async () => withIsolatedWorkbench((root) => {
	assert.deepEqual(AI_PROVIDER_DEFINITIONS.map((provider) => provider.kind), ["anthropic", "openai", "gemini", "openrouter", "lm-studio", "ollama", "litellm", "custom"]);
	const inferenceSecret = "inference-secret-do-not-leak";
	const adminSecret = "admin-secret-do-not-leak";
	const provider = upsertAiProvider(root, {
		id: "openai", kind: "openai", models: ["gpt-5.5"], defaultModel: "gpt-5.5",
		inferenceApiKey: inferenceSecret, usageAdminApiKey: adminSecret,
		budget: { monthlyUsd: 24, sessionUsd: 3, warningPercent: 80, hardStop: true },
	});
	assert.equal(provider.credentialRoles.inference?.configured, true);
	assert.equal(provider.credentialRoles.usage_admin?.configured, true);
	const publicText = JSON.stringify(listAiProviders(root));
	assert.equal(publicText.includes(inferenceSecret), false);
	assert.equal(publicText.includes(adminSecret), false);
	assert.equal(readFileSync(workbenchDataPath(root, "ai-providers.json"), "utf8").includes(inferenceSecret), false);
	assert.equal(readFileSync(workbenchDataPath(root, "ai-provider-vault.json"), "utf8").includes(inferenceSecret), false);
	assert.equal(getAiProviderRuntimeEnv(root, "openai/gpt-5.5").OPENAI_API_KEY, inferenceSecret);
	upsertAiProvider(root, { id: "openai", kind: "openai", endpoint: "https://api.openai.com/v1", models: ["gpt-5.5"], defaultModel: "gpt-5.5" });
	assert.equal(listAiProviders(root).find((item) => item.id === "openai")?.credentialRoles.inference?.configured, true);
	assert.equal(getAiProviderRuntimeEnv(root, "openai/gpt-5.5").OPENAI_API_KEY, inferenceSecret);
	removeAiProviderCredential(root, "openai", "inference");
	assert.equal(listAiProviders(root)[0]?.credentialRoles.inference?.configured, undefined);

	upsertAiProvider(root, { id: "gemini", kind: "gemini", defaultModel: "gemini-2.5-pro", inferenceApiKey: inferenceSecret });
	assert.equal(defaultAiProviderModel(root), "openai/gpt-5.5");
	assert.equal(aiProviderIdForModel(root, "google/gemini-2.5-pro"), "gemini");
	assert.equal(normalizeAiProviderModel(root, "google/Flash2.5-lite"), "google/gemini-2.5-flash-lite");
	assert.equal(getAiProviderRuntimeEnv(root, "google/gemini-2.5-pro").GEMINI_API_KEY, inferenceSecret);
	upsertAiProvider(root, { id: "custom", kind: "custom", endpoint: "https://models.example.test/v1", defaultModel: "research-model", inferenceApiKey: inferenceSecret });
	const modelsPath = join(root, "models.json");
	syncAiProviderPiConfig(root, modelsPath, "custom/research-model");
	const modelsText = readFileSync(modelsPath, "utf8");
	assert.match(modelsText, /\$FEYNMAN_CUSTOM_PROVIDER_API_KEY/);
	assert.equal(modelsText.includes(inferenceSecret), false);
}));

test("AI provider usage aggregates budgets and stops only configured billing providers", async () => withIsolatedWorkbench((root) => {
	upsertAiProvider(root, { id: "openai", kind: "openai", budget: { monthlyUsd: 1, sessionUsd: 0.5, warningPercent: 80, hardStop: true } });
	recordAiProviderUsage(root, { providerId: "openai", sessionId: "session-a", usage: { inputTokens: 10, outputTokens: 20, cost: { total: 0.5 } } });
	const provider = listAiProviders(root, "session-a")[0]!;
	assert.equal(provider.usage.inputTokens, 10);
	assert.equal(provider.usage.outputTokens, 20);
	assert.equal(provider.usage.sessionCostUsd, 0.5);
	assert.equal(provider.usage.warning, true);
	assert.equal(provider.usage.hardStopped, true);
	assert.throws(() => assertAiProviderBudget(root, "session-a", "openai/gpt-5.5"), /hard stop/);

	upsertAiProvider(root, { id: "ollama", kind: "ollama", resourceLimits: { contextWindow: 32_768, maxConcurrentRequests: 2, cpuCores: 8, memoryMb: 16_384, gpuCount: 1 }, budget: { monthlyUsd: 0, warningPercent: 80, hardStop: true } });
	recordAiProviderUsage(root, { providerId: "ollama", sessionId: "session-a", usage: { inputTokens: 5, outputTokens: 7, cost: { total: 99 } } });
	const ollama = listAiProviders(root, "session-a").find((item) => item.id === "ollama")!;
	assert.equal(ollama.billingMode, "resource");
	assert.equal(ollama.resourceLimits?.memoryMb, 16_384);
	assert.equal(ollama.usage.hardStopped, false);
	assert.doesNotThrow(() => assertAiProviderBudget(root, "session-a", "ollama/llama3"));
}));

test("AI provider connection test uses the vault server-side and redacts responses", async () => {
	await withIsolatedWorkbench(async (root) => {
		upsertAiProvider(root, { id: "openai", kind: "openai", inferenceApiKey: "connection-secret" });
		let authorization = "";
		const result = await testAiProviderConnection(root, "openai", async (_url, init) => {
			authorization = String((init?.headers as Record<string, string>).authorization);
			return new Response("{}", { status: 200 });
		});
		assert.equal(authorization, "Bearer connection-secret");
		assert.equal(result.ok, true);
		assert.equal(JSON.stringify(result).includes("connection-secret"), false);
	});
});
