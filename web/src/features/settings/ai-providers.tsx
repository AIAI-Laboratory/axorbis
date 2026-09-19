import { useEffect, useState, type FormEvent } from "react";

export type AiProviderKind =
	| "anthropic"
	| "openai"
	| "gemini"
	| "openrouter"
	| "lm-studio"
	| "ollama"
	| "litellm"
	| "custom";

export type AiProviderConnectionStatus = "connected" | "error" | "untested";

export type AiProviderBudget = {
	monthlyUsd?: number;
	sessionUsd?: number;
	warningPercent?: number;
	hardStop?: boolean;
};

export type AiProviderResourceLimits = {
	cpuCores?: number;
	memoryMb?: number;
	gpuCount?: number;
	contextTokens?: number;
};

export type AiProviderUsage = {
	inputTokens: number;
	outputTokens: number;
	estimatedCostUsd: number;
	providerReportedCostUsd?: number;
	monthCostUsd: number;
	warning: boolean;
	hardStopped: boolean;
};

/**
 * This shape intentionally exposes credential *state*, never credential values.
 * Key text exists only inside the form until a save/test callback consumes it.
 */
export type AiProviderRecord = {
	id: string;
	kind: AiProviderKind;
	name?: string;
	endpoint?: string;
	defaultModel?: string;
	inferenceKeyConfigured?: boolean;
	usageKeyConfigured?: boolean;
	supportsInferenceKey?: boolean;
	supportsUsageKey?: boolean;
	connectionStatus?: AiProviderConnectionStatus;
	connectionDetail?: string;
	budget?: AiProviderBudget;
	resourceLimits?: AiProviderResourceLimits;
	usage?: AiProviderUsage;
};

export type AiProviderSaveInput = {
	id: string;
	kind: AiProviderKind;
	name: string;
	endpoint?: string;
	defaultModel?: string;
	/** Present only when a user supplied a replacement in this form submission. */
	inferenceApiKey?: string;
	/** Present only when a user supplied a replacement in this form submission. */
	usageApiKey?: string;
	clearInferenceApiKey?: boolean;
	clearUsageApiKey?: boolean;
	budget?: AiProviderBudget;
	resourceLimits?: AiProviderResourceLimits;
};

export type AiProviderTestInput = Pick<AiProviderSaveInput,
	"id" | "kind" | "endpoint" | "defaultModel" | "inferenceApiKey" | "usageApiKey">;

export type AiProvidersProps = {
	providers: AiProviderRecord[];
	onSave: (input: AiProviderSaveInput) => void | Promise<void>;
	onTest: (input: AiProviderTestInput) => void | Promise<void>;
	onRemove: (provider: Pick<AiProviderRecord, "id" | "kind" | "name">) => void | Promise<void>;
	savingProviderId?: string;
	testingProviderId?: string;
	disabled?: boolean;
};

type ProviderPreset = Pick<AiProviderRecord, "kind" | "name" | "endpoint" | "supportsInferenceKey" | "supportsUsageKey">;

export const AI_PROVIDER_PRESETS: readonly ProviderPreset[] = [
	{ kind: "anthropic", name: "Anthropic", endpoint: "https://api.anthropic.com", supportsInferenceKey: true, supportsUsageKey: true },
	{ kind: "openai", name: "OpenAI", endpoint: "https://api.openai.com/v1", supportsInferenceKey: true, supportsUsageKey: true },
	{ kind: "gemini", name: "Gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta", supportsInferenceKey: true, supportsUsageKey: false },
	{ kind: "openrouter", name: "OpenRouter", endpoint: "https://openrouter.ai/api/v1", supportsInferenceKey: true, supportsUsageKey: true },
	{ kind: "lm-studio", name: "LM Studio", endpoint: "http://localhost:1234/v1", supportsInferenceKey: false, supportsUsageKey: false },
	{ kind: "ollama", name: "Ollama", endpoint: "http://localhost:11434", supportsInferenceKey: false, supportsUsageKey: false },
	{ kind: "litellm", name: "LiteLLM", endpoint: "http://localhost:4000/v1", supportsInferenceKey: true, supportsUsageKey: true },
	{ kind: "custom", name: "Custom provider", supportsInferenceKey: true, supportsUsageKey: true },
] as const;

type ProviderDraft = {
	name: string;
	endpoint: string;
	defaultModel: string;
	inferenceApiKey: string;
	usageApiKey: string;
	clearInferenceApiKey: boolean;
	clearUsageApiKey: boolean;
	monthlyUsd: string;
	sessionUsd: string;
	warningPercent: string;
	hardStop: boolean;
	cpuCores: string;
	memoryMb: string;
	gpuCount: string;
	contextTokens: string;
};

function isLocalProvider(kind: AiProviderKind): boolean {
	return kind === "lm-studio" || kind === "ollama";
}

function numberText(value: number | undefined): string {
	return value === undefined ? "" : String(value);
}

function optionalNumber(value: string): number | undefined {
	const normalized = value.trim();
	if (!normalized) return undefined;
	const parsed = Number(normalized);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function initialDraft(provider: AiProviderRecord): ProviderDraft {
	return {
		name: provider.name ?? AI_PROVIDER_PRESETS.find((preset) => preset.kind === provider.kind)?.name ?? "Custom provider",
		endpoint: provider.endpoint ?? "",
		defaultModel: provider.defaultModel ?? "",
		// Never seed these fields from state. The server must never return raw keys.
		inferenceApiKey: "",
		usageApiKey: "",
		clearInferenceApiKey: false,
		clearUsageApiKey: false,
		monthlyUsd: numberText(provider.budget?.monthlyUsd),
		sessionUsd: numberText(provider.budget?.sessionUsd),
		warningPercent: numberText(provider.budget?.warningPercent),
		hardStop: provider.budget?.hardStop ?? false,
		cpuCores: numberText(provider.resourceLimits?.cpuCores),
		memoryMb: numberText(provider.resourceLimits?.memoryMb),
		gpuCount: numberText(provider.resourceLimits?.gpuCount),
		contextTokens: numberText(provider.resourceLimits?.contextTokens),
	};
}

function statusLabel(provider: AiProviderRecord): string {
	if (provider.connectionStatus === "connected") return "Connected";
	if (provider.connectionStatus === "error") return "Needs attention";
	return "Not tested";
}

function statusClass(provider: AiProviderRecord): string {
	return provider.connectionStatus === "connected" ? "connected" : provider.connectionStatus === "error" ? "error" : "untested";
}

function usd(value: number): string {
	return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function ProviderCard({ provider, onSave, onTest, onRemove, saving, testing, disabled, initialExpanded = true }: {
	provider: AiProviderRecord;
	onSave: AiProvidersProps["onSave"];
	onTest: AiProvidersProps["onTest"];
	onRemove: AiProvidersProps["onRemove"];
	saving: boolean;
	testing: boolean;
	disabled: boolean;
	initialExpanded?: boolean;
}) {
	const [draft, setDraft] = useState<ProviderDraft>(() => initialDraft(provider));
	const [expanded, setExpanded] = useState(initialExpanded);
	const local = isLocalProvider(provider.kind);
	const supportsInferenceKey = provider.supportsInferenceKey ?? !local;
	const supportsUsageKey = provider.supportsUsageKey ?? false;

	useEffect(() => setDraft(initialDraft(provider)), [provider]);

	const update = <K extends keyof ProviderDraft>(key: K, value: ProviderDraft[K]) => {
		setDraft((current) => ({ ...current, [key]: value }));
	};
	const request = (): AiProviderSaveInput => ({
		id: provider.id,
		kind: provider.kind,
		name: draft.name.trim() || provider.name || "Custom provider",
		...(draft.endpoint.trim() ? { endpoint: draft.endpoint.trim() } : {}),
		...(draft.defaultModel.trim() ? { defaultModel: draft.defaultModel.trim() } : {}),
		...(draft.inferenceApiKey ? { inferenceApiKey: draft.inferenceApiKey } : {}),
		...(draft.usageApiKey ? { usageApiKey: draft.usageApiKey } : {}),
		...(draft.clearInferenceApiKey ? { clearInferenceApiKey: true } : {}),
		...(draft.clearUsageApiKey ? { clearUsageApiKey: true } : {}),
		budget: {
			...(optionalNumber(draft.monthlyUsd) !== undefined ? { monthlyUsd: optionalNumber(draft.monthlyUsd) } : {}),
			...(optionalNumber(draft.sessionUsd) !== undefined ? { sessionUsd: optionalNumber(draft.sessionUsd) } : {}),
			...(optionalNumber(draft.warningPercent) !== undefined ? { warningPercent: optionalNumber(draft.warningPercent) } : {}),
			hardStop: draft.hardStop,
		},
		...(local ? { resourceLimits: {
			...(optionalNumber(draft.cpuCores) !== undefined ? { cpuCores: optionalNumber(draft.cpuCores) } : {}),
			...(optionalNumber(draft.memoryMb) !== undefined ? { memoryMb: optionalNumber(draft.memoryMb) } : {}),
			...(optionalNumber(draft.gpuCount) !== undefined ? { gpuCount: optionalNumber(draft.gpuCount) } : {}),
			...(optionalNumber(draft.contextTokens) !== undefined ? { contextTokens: optionalNumber(draft.contextTokens) } : {}),
		} } : {}),
	});
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		void Promise.resolve(onSave(request())).finally(() => {
			// Replacement keys live in memory only long enough for their request.
			setDraft((current) => ({ ...current, inferenceApiKey: "", usageApiKey: "" }));
		});
	};
	const testConnection = () => {
		const next = request();
		void Promise.resolve(onTest({
			id: next.id,
			kind: next.kind,
			endpoint: next.endpoint,
			defaultModel: next.defaultModel,
			inferenceApiKey: next.inferenceApiKey,
			usageApiKey: next.usageApiKey,
		})).finally(() => setDraft((current) => ({ ...current, inferenceApiKey: "", usageApiKey: "" })));
	};

	return <article className="rw-provider-card">
		<header className="rw-provider-card-head">
			<button type="button" className="rw-provider-summary" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
				<div><h2>{provider.name || AI_PROVIDER_PRESETS.find((preset) => preset.kind === provider.kind)?.name || "Custom provider"}</h2><p>{local ? "Local runtime and resource limits" : "Inference access, usage, and budget controls"}</p></div>
				<span className={`rw-provider-status ${statusClass(provider)}`}>{statusLabel(provider)} · {expanded ? "Hide" : "Configure"}</span>
			</button>
		</header>
		{expanded && <>
		{provider.connectionDetail && <p className="rw-provider-diagnostic" role={provider.connectionStatus === "error" ? "alert" : undefined}>{provider.connectionDetail}</p>}
		{provider.usage && <div className={`rw-provider-usage ${provider.usage.hardStopped ? "hard-stopped" : provider.usage.warning ? "warning" : ""}`}>
			<span><b>{provider.usage.inputTokens.toLocaleString()}</b> input tokens</span><span><b>{provider.usage.outputTokens.toLocaleString()}</b> output tokens</span>
			{!local && <><span><b>{usd(provider.usage.monthCostUsd)}</b> this month</span><span>{provider.usage.providerReportedCostUsd !== undefined ? "Provider-reported cost available" : `Estimated total ${usd(provider.usage.estimatedCostUsd)}`}</span></>}
			{provider.usage.hardStopped && <strong>Budget hard stop is active.</strong>}
		</div>}
		<form onSubmit={submit}>
			<div className="rw-provider-fields">
				{provider.kind === "custom" && <label><span>Provider name</span><input value={draft.name} onChange={(event) => update("name", event.target.value)} maxLength={80} disabled={disabled || saving} /></label>}
				<label className={provider.kind === "custom" ? "" : "rw-provider-field-wide"}><span>Endpoint</span><input type="url" inputMode="url" placeholder="https://…" value={draft.endpoint} onChange={(event) => update("endpoint", event.target.value)} disabled={disabled || saving} /></label>
				<label className={provider.kind === "custom" ? "" : "rw-provider-field-wide"}><span>Default model</span><input placeholder="Select or enter a model id" value={draft.defaultModel} onChange={(event) => update("defaultModel", event.target.value)} maxLength={160} disabled={disabled || saving} /></label>
				{supportsInferenceKey && <label className="rw-provider-field-wide"><span>Inference API key <em>{provider.inferenceKeyConfigured ? "Saved" : "Not configured"}</em></span><input type="password" autoComplete="new-password" placeholder={provider.inferenceKeyConfigured ? "••••••••••••••••" : "Enter an inference API key"} value={draft.inferenceApiKey} onChange={(event) => update("inferenceApiKey", event.target.value)} disabled={disabled || saving || draft.clearInferenceApiKey} /></label>}
				{supportsInferenceKey && provider.inferenceKeyConfigured && <label className="rw-provider-check rw-provider-field-wide"><input type="checkbox" checked={draft.clearInferenceApiKey} onChange={(event) => update("clearInferenceApiKey", event.target.checked)} disabled={disabled || saving} /> Remove saved inference key</label>}
				{supportsUsageKey && <label className="rw-provider-field-wide"><span>Admin / usage API key <em>{provider.usageKeyConfigured ? "Saved" : "Optional"}</em></span><input type="password" autoComplete="new-password" placeholder={provider.usageKeyConfigured ? "••••••••••••••••" : "Optional key for provider usage reporting"} value={draft.usageApiKey} onChange={(event) => update("usageApiKey", event.target.value)} disabled={disabled || saving || draft.clearUsageApiKey} /></label>}
				{supportsUsageKey && provider.usageKeyConfigured && <label className="rw-provider-check rw-provider-field-wide"><input type="checkbox" checked={draft.clearUsageApiKey} onChange={(event) => update("clearUsageApiKey", event.target.checked)} disabled={disabled || saving} /> Remove saved admin / usage key</label>}
			</div>
			{local ? <section className="rw-provider-section"><div><h3>Resource limits</h3><p>Local providers do not have a billing quota. Keep these limits aligned with the host that runs the model.</p></div><div className="rw-provider-fields rw-provider-limit-fields"><NumberField label="CPU cores" value={draft.cpuCores} onChange={(value) => update("cpuCores", value)} disabled={disabled || saving} /><NumberField label="Memory (MB)" value={draft.memoryMb} onChange={(value) => update("memoryMb", value)} disabled={disabled || saving} /><NumberField label="GPUs" value={draft.gpuCount} onChange={(value) => update("gpuCount", value)} disabled={disabled || saving} /><NumberField label="Context tokens" value={draft.contextTokens} onChange={(value) => update("contextTokens", value)} disabled={disabled || saving} /></div></section> : <section className="rw-provider-section"><div><h3>Budget guardrails</h3><p>Costs are estimated locally unless the provider reports an authoritative amount.</p></div><div className="rw-provider-fields rw-provider-budget-fields"><NumberField label="Monthly budget (USD)" value={draft.monthlyUsd} onChange={(value) => update("monthlyUsd", value)} disabled={disabled || saving} step="0.01" /><NumberField label="Session budget (USD)" value={draft.sessionUsd} onChange={(value) => update("sessionUsd", value)} disabled={disabled || saving} step="0.01" /><NumberField label="Warning at (%)" value={draft.warningPercent} onChange={(value) => update("warningPercent", value)} disabled={disabled || saving} max={100} /><label className="rw-provider-check"><input type="checkbox" checked={draft.hardStop} onChange={(event) => update("hardStop", event.target.checked)} disabled={disabled || saving} /> Stop new requests at the budget limit</label></div></section>}
			<footer className="rw-provider-actions"><button type="button" className="rw-text-action" onClick={() => void onRemove({ id: provider.id, kind: provider.kind, name: provider.name })} disabled={disabled || saving || testing}>Remove provider</button><span /><button type="button" className="rw-provider-secondary" onClick={testConnection} disabled={disabled || saving || testing}>{testing ? "Testing…" : "Test connection"}</button><button type="submit" className="rw-button" disabled={disabled || saving || testing}>{saving ? "Saving…" : "Save changes"}</button></footer>
		</form>
		</>}
	</article>;
}

function NumberField({ label, value, onChange, disabled, step, max }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean; step?: string; max?: number }) {
	return <label><span>{label}</span><input type="number" min="0" max={max} step={step ?? "1"} inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} /></label>;
}

const PROVIDER_MARKS: Record<AiProviderKind, string> = {
	"anthropic": "A",
	"openai": "◎",
	"gemini": "✦",
	"openrouter": "⌁",
	"lm-studio": "LM",
	"ollama": "O",
	"litellm": "L",
	"custom": "+",
};

function providerReady(provider: AiProviderRecord): boolean {
	return Boolean(provider.connectionStatus === "connected" || provider.inferenceKeyConfigured || ((provider.kind === "ollama" || provider.kind === "lm-studio") && provider.defaultModel));
}

export function AiProviders({ providers, onSave, onTest, onRemove, savingProviderId, testingProviderId, disabled = false }: AiProvidersProps) {
	const [selectedKind, setSelectedKind] = useState<AiProviderKind>();
	const providerByKind = new Map(providers.map((provider) => [provider.kind, provider]));
	const cards = AI_PROVIDER_PRESETS.map((preset) => providerByKind.get(preset.kind) ?? {
		id: preset.kind,
		kind: preset.kind,
		name: preset.name,
		endpoint: preset.endpoint,
		supportsInferenceKey: preset.supportsInferenceKey,
		supportsUsageKey: preset.supportsUsageKey,
		connectionStatus: "untested" as const,
	});
	const extraProviders = providers.filter((provider) => !AI_PROVIDER_PRESETS.some((preset) => preset.kind === provider.kind));
	const allProviders = [...cards, ...extraProviders];
	const selectedProvider = allProviders.find((provider) => provider.kind === selectedKind) ?? allProviders.find(providerReady) ?? allProviders[0];

	return <section className="rw-page rw-providers-page" aria-labelledby="ai-providers-title"><div className="rw-page-intro"><span className="rw-kicker">SETTINGS / AI PROVIDERS</span><div className="rw-page-title-row"><div><h1 id="ai-providers-title">AI providers</h1><p>Choose a provider to configure. Configured providers light up automatically.</p></div></div></div><div className="rw-provider-security-note"><strong>Keys stay private.</strong> Saved key values are never rendered here; entering a key only replaces the secure credential held by the backend.</div><div className="rw-provider-logo-grid" aria-label="AI provider selection">{allProviders.map((provider) => { const ready = providerReady(provider); const selected = selectedProvider?.kind === provider.kind; return <button key={provider.id} type="button" className={`rw-provider-logo-tile ${ready ? "configured" : ""} ${selected ? "selected" : ""}`} aria-label={`Configure ${provider.name ?? provider.kind}`} aria-pressed={selected} title={`${provider.name ?? provider.kind}${ready ? " · configured" : " · not configured"}`} onClick={() => setSelectedKind(provider.kind)}><span className="rw-provider-logo-mark" aria-hidden="true">{PROVIDER_MARKS[provider.kind]}</span></button>; })}</div>{selectedProvider && <div className="rw-provider-selected"><div className="rw-provider-selected-label"><span className="rw-kicker">SELECTED PROVIDER</span><strong>{selectedProvider.name ?? selectedProvider.kind}</strong></div><ProviderCard key={selectedProvider.id} provider={selectedProvider} onSave={onSave} onTest={onTest} onRemove={onRemove} saving={savingProviderId === selectedProvider.id} testing={testingProviderId === selectedProvider.id} disabled={disabled} initialExpanded /></div>}</section>;
}
