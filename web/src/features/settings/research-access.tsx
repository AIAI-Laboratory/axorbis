import { useEffect, useState, type FormEvent } from "react";

export type SearchProvider = "auto" | "exa" | "gemini" | "perplexity";

export type ResearchAccessStatus = {
	search: {
		searchProvider: SearchProvider;
		exaConfigured: boolean;
		geminiApiConfigured: boolean;
		perplexityConfigured: boolean;
	};
	alpha: { authenticated: boolean; name?: string };
};

const PROVIDERS: Array<{ value: SearchProvider; label: string }> = [
	{ value: "auto", label: "Auto" },
	{ value: "exa", label: "Exa" },
	{ value: "perplexity", label: "Perplexity" },
	{ value: "gemini", label: "Gemini" },
];

function hasConfiguredKey(status: ResearchAccessStatus["search"], provider: SearchProvider): boolean {
	return provider === "exa" ? status.exaConfigured
		: provider === "gemini" ? status.geminiApiConfigured
			: provider === "perplexity" ? status.perplexityConfigured : false;
}

export function ResearchAccess({ status, onSaveSearch, onConnectAlpha, saving = false, connectingAlpha = false }: {
	status: ResearchAccessStatus;
	onSaveSearch: (input: { provider: SearchProvider; apiKey?: string }) => Promise<void>;
	onConnectAlpha: () => Promise<void>;
	saving?: boolean;
	connectingAlpha?: boolean;
}) {
	const [provider, setProvider] = useState<SearchProvider>(status.search.searchProvider);
	const [apiKey, setApiKey] = useState("");

	useEffect(() => { setProvider(status.search.searchProvider); }, [status.search.searchProvider]);
	const configured = hasConfiguredKey(status.search, provider);
	const requiresKey = provider !== "auto" && !configured;
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		void onSaveSearch({ provider, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }).finally(() => setApiKey(""));
	};

	return <section className="rw-page rw-providers-page rw-research-access" aria-labelledby="research-access-title">
		<div className="rw-settings-section-head"><div><span className="rw-kicker">SETTINGS / RESEARCH ACCESS</span><h2 id="research-access-title">Search and alphaXiv</h2><p>Configure evidence search independently from your AI model.</p></div></div>
		<div className="rw-provider-security-note"><strong>Search keys stay local.</strong> Their values are never rendered back to the browser; Feynman stores them in a user-only local configuration file.</div>
		<article className="rw-provider-card rw-research-access-card">
			<form onSubmit={submit}>
				<div className="rw-provider-fields">
					<label><span>Web search provider</span><select value={provider} onChange={(event) => setProvider(event.target.value as SearchProvider)} disabled={saving || connectingAlpha}>{PROVIDERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
					{provider !== "auto" && <label><span>Search API key <em>{configured ? "Saved — enter a new key to replace it" : "Required"}</em></span><input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={configured ? "••••••••••••••••" : `Enter a ${PROVIDERS.find((item) => item.value === provider)?.label} API key`} required={requiresKey} disabled={saving || connectingAlpha} /></label>}
				</div>
				<footer className="rw-provider-actions"><span>{provider === "auto" ? "Auto uses available configured providers." : configured ? "A saved key is available for this provider." : "Add a key to enable this provider."}</span><button type="submit" className="rw-button" disabled={saving || connectingAlpha}>{saving ? "Saving…" : "Save search"}</button></footer>
			</form>
		</article>
		<article className="rw-provider-card rw-research-access-card rw-alpha-access-card">
			<div className="rw-alpha-copy"><div><h3>alphaXiv</h3><p>{status.alpha.authenticated ? "Connected for paper search and reading." : "Connect an alphaXiv account for paper search and reading."}</p></div><span className={`rw-provider-status ${status.alpha.authenticated ? "connected" : ""}`}>{status.alpha.authenticated ? "Connected" : "Not connected"}</span></div>
			<p className="rw-alpha-note">alphaXiv uses a secure browser sign-in, not a static API key.</p>
			{!status.alpha.authenticated && <button type="button" className="rw-button" onClick={() => void onConnectAlpha()} disabled={saving || connectingAlpha}>{connectingAlpha ? "Waiting for sign-in…" : "Connect alphaXiv"}</button>}
		</article>
	</section>;
}
