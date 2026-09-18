const invoke = window.__TAURI__?.core?.invoke;
const workspaceElement = document.querySelector("#workspace");
const statusElement = document.querySelector("#status");
const errorElement = document.querySelector("#error");
const versionElement = document.querySelector("#version");
const chooseButton = document.querySelector("#choose");
const launchButton = document.querySelector("#launch");
const themeButton = document.querySelector("#theme");
const appElement = document.querySelector(".desktop-app");

let workspace = localStorage.getItem("feynman.desktop.workspace") || "";
let theme = localStorage.getItem("feynman.research.theme") || "system";

function applyTheme() {
  appElement.dataset.theme = theme;
  themeButton.setAttribute("aria-label", `Theme: ${theme}. Change theme`);
  themeButton.title = `Theme: ${theme}`;
}

function setBusy(busy) {
  chooseButton.disabled = busy;
  launchButton.disabled = busy || !workspace;
  statusElement.classList.toggle("busy", busy);
}

function setError(message = "") {
  errorElement.textContent = message;
  errorElement.hidden = !message;
}

async function launch() {
  setBusy(true);
  setError();
  statusElement.textContent = "Starting the local research runtime…";
  try {
    const result = await invoke("start_backend", { workspace });
    localStorage.setItem("feynman.desktop.workspace", result.workspace);
    statusElement.textContent = "Opening the workbench…";
    window.location.replace(result.url);
  } catch (error) {
    statusElement.textContent = "The workbench did not start.";
    setError(String(error));
    setBusy(false);
  }
}

chooseButton.addEventListener("click", async () => {
  setBusy(true);
  setError();
  try {
    const selected = await invoke("choose_workspace");
    if (selected) {
      workspace = selected;
      workspaceElement.textContent = workspace;
      workspaceElement.title = workspace;
      localStorage.setItem("feynman.desktop.workspace", workspace);
    }
  } catch (error) {
    setError(String(error));
  }
  setBusy(false);
});

launchButton.addEventListener("click", launch);
themeButton.addEventListener("click", () => {
  theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  localStorage.setItem("feynman.research.theme", theme);
  applyTheme();
});

async function initialize() {
  if (!invoke) {
    chooseButton.disabled = true;
    launchButton.disabled = true;
    statusElement.textContent = "Open this page from the Feynman desktop application.";
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
    statusElement.textContent = "Ready to start a local, authenticated workbench.";
    setBusy(false);
    if (rememberedWorkspace) await launch();
  } catch (error) {
    statusElement.textContent = "Desktop initialization failed.";
    setError(String(error));
  }
}

applyTheme();
void initialize();
