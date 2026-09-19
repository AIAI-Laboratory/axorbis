use serde::Serialize;
use std::{
    env,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{command, AppHandle, Manager, State, Url};
use tauri_plugin_dialog::DialogExt;

const BACKEND_START_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Default)]
struct BackendProcess {
    child: Option<Child>,
    url: Option<String>,
    workspace: Option<PathBuf>,
    bootstrap_url: Option<Url>,
}

#[derive(Clone, Default)]
pub struct BackendState {
    process: Arc<Mutex<BackendProcess>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopInfo {
    app_version: String,
    default_workspace: String,
    platform: String,
    architecture: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendLaunch {
    url: String,
    workspace: String,
}

struct LaunchSpec {
    program: PathBuf,
    prefix_args: Vec<String>,
}

impl BackendState {
    pub fn set_bootstrap_url(&self, url: Url) {
        if let Ok(mut process) = self.process.lock() {
            process.bootstrap_url = Some(url);
        }
    }

    pub fn bootstrap_url(&self) -> Option<Url> {
        self.process.lock().ok()?.bootstrap_url.clone()
    }

    pub fn backend_is_running(&self) -> bool {
        let Ok(mut process) = self.process.lock() else {
            return false;
        };
        let running = process
            .child
            .as_mut()
            .is_some_and(|child| !matches!(child.try_wait(), Ok(Some(_))));
        if !running {
            process.child = None;
            process.url = None;
            process.workspace = None;
        }
        running
    }

    pub fn stop(&self) {
        let Ok(mut process) = self.process.lock() else {
            return;
        };
        if let Some(child) = process.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        process.child = None;
        process.url = None;
        process.workspace = None;
    }
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn default_workspace_path() -> PathBuf {
    env::var_os("AXORBIS_DESKTOP_WORKSPACE")
        .or_else(|| env::var_os("FEYNMAN_DESKTOP_WORKSPACE"))
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn normalize_workspace(value: Option<String>) -> Result<PathBuf, String> {
    let workspace = value
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_workspace_path);
    let workspace = workspace
        .canonicalize()
        .map_err(|error| format!("Workspace does not exist or cannot be opened: {error}"))?;
    if !workspace.is_dir() {
        return Err("The selected workspace is not a directory.".into());
    }
    Ok(workspace)
}

fn executable_candidate(path: impl AsRef<Path>) -> Option<PathBuf> {
    let path = path.as_ref();
    path.is_file().then(|| path.to_path_buf())
}

fn configured_launch_spec(app: &AppHandle) -> Result<LaunchSpec, String> {
    if let Some(configured) = env::var_os("AXORBIS_DESKTOP_CLI")
        .or_else(|| env::var_os("FEYNMAN_DESKTOP_CLI"))
        .filter(|value| !value.is_empty())
    {
        let program = PathBuf::from(configured);
        if !program.is_file() {
            return Err(format!(
                "FEYNMAN_DESKTOP_CLI points to a missing file: {}",
                program.display()
            ));
        }
        if program.extension().and_then(|value| value.to_str()) == Some("js") {
            return Ok(LaunchSpec {
                program: PathBuf::from(
                    env::var_os("AXORBIS_DESKTOP_NODE")
                        .or_else(|| env::var_os("FEYNMAN_DESKTOP_NODE"))
                        .unwrap_or_else(|| "node".into()),
                ),
                prefix_args: vec![program.to_string_lossy().into_owned()],
            });
        }
        return Ok(LaunchSpec {
            program,
            prefix_args: Vec::new(),
        });
    }

    // In development, always launch the current checkout. A bundled runtime
    // may be present in a Tauri debug resource directory and would otherwise
    // mask fresh TypeScript/frontend changes.
    if cfg!(debug_assertions) {
        let repository_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let source_entry = repository_root.join("bin/feynman.js");
        if source_entry.is_file() {
            return Ok(LaunchSpec {
                program: PathBuf::from(
                    env::var_os("AXORBIS_DESKTOP_NODE")
                        .or_else(|| env::var_os("FEYNMAN_DESKTOP_NODE"))
                        .unwrap_or_else(|| "node".into()),
                ),
                prefix_args: vec![source_entry.to_string_lossy().into_owned()],
            });
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        #[cfg(windows)]
        let bundled = resource_dir.join("runtime").join("feynman.cmd");
        #[cfg(not(windows))]
        let bundled = resource_dir.join("runtime").join("feynman");
        if let Some(program) = executable_candidate(bundled) {
            return Ok(LaunchSpec {
                program,
                prefix_args: Vec::new(),
            });
        }
    }

    let mut candidates = Vec::new();
    if let Some(home) = home_dir() {
        candidates.push(home.join(".local/bin/feynman"));
        candidates.push(home.join(".npm-global/bin/feynman"));
    }
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin/feynman"));
        candidates.push(PathBuf::from("/usr/local/bin/feynman"));
    }
    if let Some(program) = candidates.into_iter().find_map(executable_candidate) {
        return Ok(LaunchSpec {
            program,
            prefix_args: Vec::new(),
        });
    }

    #[cfg(windows)]
    let program = PathBuf::from("feynman.cmd");
    #[cfg(not(windows))]
    let program = PathBuf::from("feynman");
    Ok(LaunchSpec {
        program,
        prefix_args: Vec::new(),
    })
}

fn validate_backend_url(value: &str) -> Result<String, String> {
    let parsed =
        Url::parse(value).map_err(|_| "Feynman returned an invalid workbench URL.".to_string())?;
    let local_host = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    if parsed.scheme() != "http" || !local_host {
        return Err("Feynman returned a non-local workbench URL.".into());
    }
    Ok(parsed.to_string())
}

fn spawn_backend(app: &AppHandle, workspace: PathBuf) -> Result<(Child, String), String> {
    let launch = configured_launch_spec(app)?;
    let mut args = launch.prefix_args;
    args.extend([
        "serve".into(),
        "--no-open".into(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        "0".into(),
    ]);

    let mut command = Command::new(&launch.program);
    command
        .args(args)
        .current_dir(&workspace)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    // `tauri dev` starts Vite before this local backend. Production never receives
    // this variable, so its bundled workbench remains self-contained.
    #[cfg(debug_assertions)]
    command.env("AXORBIS_WORKBENCH_DEV_URL", "http://127.0.0.1:1420/app-shell/");

    let mut child = command
        .spawn()
        .map_err(|error| {
            format!(
                "Could not start Feynman with {}: {error}. Install the Feynman CLI or set AXORBIS_DESKTOP_CLI.",
                launch.program.display()
            )
        })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not read the Feynman startup output.".to_string())?;
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let mut sent = false;
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) if line.starts_with("URL: ") => {
                    if !sent {
                        let _ = sender.send(Ok(line[5..].trim().to_string()));
                        sent = true;
                    }
                }
                Ok(line) => eprintln!("[feynman] {line}"),
                Err(error) => {
                    if !sent {
                        let _ = sender.send(Err(format!(
                            "Could not read Feynman startup output: {error}"
                        )));
                    }
                    return;
                }
            }
        }
        if !sent {
            let _ = sender.send(Err("Feynman stopped before the workbench was ready.".into()));
        }
    });

    let url = match receiver.recv_timeout(BACKEND_START_TIMEOUT) {
        Ok(Ok(url)) => validate_backend_url(&url),
        Ok(Err(error)) => Err(error),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            Err("Feynman did not become ready within 45 seconds.".into())
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("Feynman stopped before the workbench was ready.".into())
        }
    };
    match url {
        Ok(url) => Ok((child, url)),
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(error)
        }
    }
}

#[command]
pub fn desktop_info(app: AppHandle) -> DesktopInfo {
    DesktopInfo {
        app_version: app.package_info().version.to_string(),
        default_workspace: default_workspace_path().to_string_lossy().into_owned(),
        platform: env::consts::OS.into(),
        architecture: env::consts::ARCH.into(),
    }
}

#[command]
pub async fn choose_workspace(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Choose a Feynman workspace")
            .blocking_pick_folder()
            .map(|path| {
                path.into_path()
                    .map(|path| path.to_string_lossy().into_owned())
                    .map_err(|error| error.to_string())
            })
            .transpose()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[command]
pub async fn start_backend(
    app: AppHandle,
    state: State<'_, BackendState>,
    workspace: Option<String>,
) -> Result<BackendLaunch, String> {
    let workspace = normalize_workspace(workspace)?;
    let backend = state.inner().clone();
    let app_for_start = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut process = backend
            .process
            .lock()
            .map_err(|_| "The desktop backend state is unavailable.".to_string())?;

        let active_url = process.url.clone();
        let active_workspace = process.workspace.clone();
        if let (Some(child), Some(url), Some(active_workspace)) =
            (process.child.as_mut(), active_url, active_workspace)
        {
            if child
                .try_wait()
                .map_err(|error| error.to_string())?
                .is_none()
                && active_workspace == workspace
            {
                return Ok(BackendLaunch {
                    url,
                    workspace: workspace.to_string_lossy().into_owned(),
                });
            }
            let _ = child.kill();
            let _ = child.wait();
        }

        let (child, url) = spawn_backend(&app_for_start, workspace.clone())?;
        process.child = Some(child);
        process.url = Some(url.clone());
        process.workspace = Some(workspace.clone());
        Ok(BackendLaunch {
            url,
            workspace: workspace.to_string_lossy().into_owned(),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[command]
pub fn stop_backend(state: State<'_, BackendState>) {
    state.stop();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_local_backend_urls() {
        assert!(validate_backend_url("http://127.0.0.1:6174/?token=secret").is_ok());
        assert!(validate_backend_url("http://localhost:6174/").is_ok());
        assert!(validate_backend_url("https://127.0.0.1:6174/").is_err());
        assert!(validate_backend_url("http://example.com:6174/").is_err());
    }
}
