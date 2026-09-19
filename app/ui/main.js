const invoke = window.__TAURI__?.core?.invoke;
const loadingView = document.querySelector("#loading-view");
const providerView = document.querySelector("#provider-view");
const workspaceView = document.querySelector("#workspace-view");
const statusElement = document.querySelector("#status");
const workspaceStatusElement = document.querySelector("#workspace-status");
const errorElement = document.querySelector("#error");
const loadingErrorElement = document.querySelector("#loading-error");
const providerErrorElement = document.querySelector("#provider-error");
const versionElement = document.querySelector("#version");
const workspaceElement = document.querySelector("#workspace");
const chooseButton = document.querySelector("#choose");
const launchButton = document.querySelector("#launch");
const themeButton = document.querySelector("#theme");
const appElement = document.querySelector(".desktop-app");
const providerForm = document.querySelector("#provider-form");
const providerSelect = document.querySelector("#setup-provider");
const apiKeyInput = document.querySelector("#setup-api-key");
const modelSelect = document.querySelector("#setup-model-select");
const customModelRow = document.querySelector("#custom-model-row");
const modelInput = document.querySelector("#setup-model");
const endpointRow = document.querySelector("#endpoint-row");
const endpointInput = document.querySelector("#setup-endpoint");
const keyHint = document.querySelector("#key-hint");
const providerSubmit = document.querySelector("#provider-submit");
const searchProviderSelect = document.querySelector("#setup-search-provider");
const searchApiKeyInput = document.querySelector("#setup-search-api-key");
const searchKeyHint = document.querySelector("#search-key-hint");
const alphaLoginInput = document.querySelector("#setup-alpha-login");
const setupSecurity = document.querySelector("#setup-security");

async function loadRandomQuote() {
  try {
    const response = await fetch('./quotes.csv');
    if (!response.ok) return;
    const text = await response.text();
    
    const lines = text.trim().split('\n').slice(1); // Skip header
    if (lines.length === 0) return;
    
    const quotes = lines.map(line => {
      const match = line.match(/^"(.*)","(.*)","(.*)"$/);
      if (match) {
        return { en: match[1], vi: match[2], source: match[3] };
      }
      return null;
    }).filter(Boolean);
    
    if (quotes.length > 0) {
      const quote = quotes[Math.floor(Math.random() * quotes.length)];
      const h1 = loadingView.querySelector('.page-intro h1');
      const p = loadingView.querySelector('.page-intro p');
      
      if (h1 && p) {
        h1.textContent = quote.en;
        p.innerHTML = `${quote.vi}<br><small style="opacity: 0.7; margin-top: 8px; display: block;">${quote.source}</small>`;
      }
    }
  } catch (err) {
    console.error("Failed to load quotes:", err);
  }
}
loadRandomQuote();

const PROVIDERS = [
  { kind: "anthropic", name: "Anthropic", endpoint: "https://api.anthropic.com", requiresKey: true, models: ["claude-sonnet-4-20250514", "claude-3-7-sonnet-latest", "claude-3-5-haiku-latest"] },
  { kind: "openai", name: "OpenAI", endpoint: "https://api.openai.com/v1", requiresKey: true, models: ["gpt-4.1", "gpt-4o", "o3-mini"] },
  { kind: "gemini", name: "Gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta", requiresKey: true, models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"] },
  { kind: "openrouter", name: "OpenRouter", endpoint: "https://openrouter.ai/api/v1", requiresKey: true, models: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet", "google/gemini-2.5-flash"] },
  { kind: "lm-studio", name: "LM Studio", endpoint: "http://localhost:1234/v1", requiresKey: false, models: ["local-model"] },
  { kind: "ollama", name: "Ollama", endpoint: "http://localhost:11434", requiresKey: false, models: ["llama3.2", "qwen2.5:7b", "deepseek-r1:7b"] },
  { kind: "litellm", name: "LiteLLM", endpoint: "http://localhost:4000/v1", requiresKey: true, models: ["gpt-4o-mini"] },
  { kind: "custom", name: "Custom provider", endpoint: "", requiresKey: true, models: [] },
];

const SEARCH_PROVIDERS = [
  { kind: "auto", name: "Auto", requiresKey: false },
  { kind: "exa", name: "Exa", requiresKey: true },
  { kind: "perplexity", name: "Perplexity", requiresKey: true },
  { kind: "gemini", name: "Gemini", requiresKey: true },
];

let workspace = localStorage.getItem("feynman.desktop.workspace") || "";
let theme = localStorage.getItem("feynman.research.theme") || "system";
let backendUrl = "";
let busy = false;

function applyTheme() {
  appElement.dataset.theme = theme;
  themeButton.setAttribute("aria-label", `Theme: ${theme}. Change theme`);
  themeButton.title = `Theme: ${theme}`;
}

function setView(view) {
  const loading = view === "loading";
  appElement.classList.toggle("loading-only", loading);
  document.documentElement.classList.toggle("loading-only", loading);
  document.body.classList.toggle("loading-only", loading);
  loadingView.hidden = view !== "loading";
  providerView.hidden = view !== "provider";
  workspaceView.hidden = view !== "workspace";
}

function setError(message = "") {
  errorElement.textContent = message;
  errorElement.hidden = !message;
  loadingErrorElement.textContent = message;
  loadingErrorElement.hidden = !message;
}

function setProviderError(message = "") {
  providerErrorElement.textContent = message;
  providerErrorElement.hidden = !message;
}

function setBusy(nextBusy) {
  busy = nextBusy;
  chooseButton.disabled = nextBusy;
  launchButton.disabled = nextBusy || !workspace;
  providerSubmit.disabled = nextBusy;
  providerSelect.disabled = nextBusy;
  apiKeyInput.disabled = nextBusy;
  modelSelect.disabled = nextBusy;
  modelInput.disabled = nextBusy;
  endpointInput.disabled = nextBusy;
  searchProviderSelect.disabled = nextBusy;
  searchApiKeyInput.disabled = nextBusy || searchProviderSelect.value === "auto";
  alphaLoginInput.disabled = nextBusy;
  statusElement.classList.toggle("busy", nextBusy);
  workspaceStatusElement.classList.toggle("busy", nextBusy);
}

function currentSearchProvider() {
  return SEARCH_PROVIDERS.find((provider) => provider.kind === searchProviderSelect.value) || SEARCH_PROVIDERS[0];
}

function renderSearchFields() {
  const provider = currentSearchProvider();
  searchApiKeyInput.disabled = busy || !provider.requiresKey;
  searchApiKeyInput.required = provider.requiresKey;
  searchApiKeyInput.placeholder = provider.requiresKey ? `Paste your ${provider.name} API key` : "Choose a provider first";
  searchKeyHint.textContent = provider.requiresKey ? "Required when this search provider is selected" : "Auto uses available providers without a new key";
  setupSecurity.textContent = provider.requiresKey
    ? "Model key encrypted · search key saved locally in a user-only file"
    : "Model key is encrypted at rest";
}

function currentProvider() {
  return PROVIDERS.find((provider) => provider.kind === providerSelect.value) || PROVIDERS[0];
}

function renderProviderFields() {
  const provider = currentProvider();
  keyHint.textContent = provider.requiresKey ? "Required for hosted providers" : "Not required for local providers";
  apiKeyInput.required = provider.requiresKey;
  apiKeyInput.placeholder = provider.requiresKey ? "Paste your API key" : "Optional local provider key";
  endpointRow.hidden = provider.kind !== "custom";
  endpointInput.value = provider.endpoint;
  const options = provider.models.map((model) => {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    return option;
  });
  modelSelect.replaceChildren(...options);
  const customOption = document.createElement("option");
  customOption.value = "__custom__";
  customOption.textContent = "Custom model…";
  modelSelect.append(customOption);
  modelSelect.value = provider.models[0] || "__custom__";
  customModelRow.hidden = provider.models.length > 0;
  modelInput.required = provider.models.length === 0;
  modelInput.value = "";
}

function showProviderSetup() {
  setView("provider");
  statusElement.textContent = "A model is needed before opening your workspace.";
  setProviderError();
  renderProviderFields();
  providerSelect.focus();
}

function selectedModel() {
  return modelSelect.value === "__custom__" ? modelInput.value.trim() : modelSelect.value;
}

function apiUrl(path) {
  const url = new URL(backendUrl);
  url.pathname = path;
  return url.toString();
}

async function request(path, options) {
  const response = await fetch(apiUrl(path), options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

async function saveProvider(event) {
  event.preventDefault();
  if (busy) return;
  const provider = currentProvider();
  const model = selectedModel();
  const endpoint = provider.kind === "custom" ? endpointInput.value.trim() : provider.endpoint;
  if (!model) { setProviderError("Choose or enter a model id."); return; }
  if (provider.kind === "custom" && !endpoint) { setProviderError("Enter the custom provider endpoint."); return; }
  setBusy(true);
  setProviderError();
  try {
    const result = await request("/api/ai-providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "upsert",
        record: {
          id: provider.kind,
          kind: provider.kind,
          name: provider.name,
          endpoint,
          defaultModel: model,
          models: [model],
          ...(apiKeyInput.value ? { inferenceApiKey: apiKeyInput.value } : {}),
        },
      }),
    });
    apiKeyInput.value = "";
    if (!result.state?.aiProviders?.some((item) => item.kind === provider.kind && item.defaultModel === model)) {
      throw new Error("The provider was not saved. Check the endpoint and model, then try again.");
    }
    const searchProvider = currentSearchProvider();
    if (searchProvider.kind !== "auto") {
      await request("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "upsert",
          provider: searchProvider.kind,
          apiKey: searchApiKeyInput.value,
        }),
      });
      searchApiKeyInput.value = "";
    }
    if (alphaLoginInput.checked) {
      providerSubmit.textContent = "Waiting for alphaXiv sign-in…";
      await request("/api/alpha-auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "login" }),
      });
    }
    setView("workspace");
    workspaceStatusElement.textContent = "Research access saved securely. Choose a workspace to continue.";
    launchButton.focus();
  } catch (error) {
    setProviderError(String(error));
  } finally {
    providerSubmit.innerHTML = 'Save and continue <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path></svg>';
    setBusy(false);
  }
}

async function launch() {
  if (busy || !workspace) return;
  setBusy(true);
  setError();
  workspaceStatusElement.textContent = "Opening your research workspace…";
  try {
    const result = await invoke("start_backend", { workspace });
    localStorage.setItem("feynman.desktop.workspace", result.workspace);
    workspaceStatusElement.textContent = "Opening the workbench…";
    window.location.replace(result.url);
  } catch (error) {
    workspaceStatusElement.textContent = "The workbench did not start.";
    setError(String(error));
    setBusy(false);
  }
}

chooseButton.addEventListener("click", async () => {
  if (busy) return;
  setBusy(true);
  setError();
  try {
    const selected = await invoke("choose_workspace");
    if (selected) {
      workspace = selected;
      workspaceElement.textContent = workspace;
      workspaceElement.title = workspace;
      launchButton.disabled = false;
    }
  } catch (error) {
    setError(String(error));
  }
  setBusy(false);
});

launchButton.addEventListener("click", launch);
providerForm.addEventListener("submit", saveProvider);
providerSelect.addEventListener("change", renderProviderFields);
searchProviderSelect.addEventListener("change", renderSearchFields);
modelSelect.addEventListener("change", () => {
  customModelRow.hidden = modelSelect.value !== "__custom__";
  modelInput.required = modelSelect.value === "__custom__";
  if (modelSelect.value === "__custom__") modelInput.focus();
});
themeButton.addEventListener("click", () => {
  theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  localStorage.setItem("feynman.research.theme", theme);
  applyTheme();
});

async function initialize() {
  if (!invoke) {
    setView("loading");
    statusElement.textContent = "Open this page from the Axorbis desktop application.";
    setError("The native desktop bridge is unavailable.");
    return;
  }
  try {
    const info = await invoke("desktop_info");
    const rememberedWorkspace = Boolean(workspace);
    workspace ||= info.defaultWorkspace;
    workspaceElement.textContent = workspace;
    workspaceElement.title = workspace;
    versionElement.textContent = `Axorbis ${info.appVersion} · ${info.platform}/${info.architecture}`;
    statusElement.textContent = "Starting Feynman and checking model setup…";
    setBusy(true);
    const result = await invoke("start_backend", { workspace });
    backendUrl = result.url;
    const state = await request("/api/state");
    const hasConfiguredModel = state.modelStatus?.currentValid === true
      || state.aiProviders?.some((provider) => provider.defaultModel && (provider.kind === "ollama" || provider.kind === "lm-studio" || provider.credentialRoles?.inference?.configured));
    setBusy(false);
    if (!hasConfiguredModel) {
      showProviderSetup();
      return;
    }
    if (rememberedWorkspace) {
      await launch();
      return;
    }
    setView("workspace");
    workspaceStatusElement.textContent = "Ready to open your workspace.";
    launchButton.focus();
  } catch (error) {
    setBusy(false);
    statusElement.textContent = "Desktop initialization failed.";
    setError(String(error));
  }
}

for (const provider of PROVIDERS) {
  const option = document.createElement("option");
  option.value = provider.kind;
  option.textContent = provider.name;
  providerSelect.append(option);
}
for (const provider of SEARCH_PROVIDERS) {
  const option = document.createElement("option");
  option.value = provider.kind;
  option.textContent = provider.name;
  searchProviderSelect.append(option);
}
applyTheme();
renderProviderFields();
renderSearchFields();
void initialize();
