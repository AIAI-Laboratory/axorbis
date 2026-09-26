use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    env, fs,
    fs::OpenOptions,
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{command, AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

static KEY_FILE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Default)]
struct ActiveReview {
    child: Option<Child>,
    directory: Option<PathBuf>,
}
#[derive(Clone, Default)]
pub struct ReviewState {
    active: Arc<Mutex<ActiveReview>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewEnvironment {
    python: String,
    installed: bool,
    version: Option<String>,
    default_workspace: String,
    key_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleKeyInfo {
    id: String,
    source: String,
    variable: Option<String>,
    manageable: bool,
}

struct GoogleKeyEntry {
    value: String,
    source: &'static str,
    variable: Option<String>,
    manageable: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewInput {
    title: String,
    objective: String,
    #[serde(default)]
    core_concepts: String,
    #[serde(default)]
    related_concepts: String,
    inclusion: String,
    exclusion: String,
    date_start: String,
    date_end: String,
    max_results: u32,
}

fn default_workspace() -> PathBuf {
    env::var_os("SYNTHSCHOLAR_WORKSPACE")
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("HOME").map(|home| PathBuf::from(home).join("SynthScholar Reviews"))
        })
        .unwrap_or_else(|| PathBuf::from("SynthScholar Reviews"))
}

fn axorbis_env_key(agent_dir: &Path, name: &str) -> Option<GoogleKeyEntry> {
    if let Some(value) = env::var(name).ok().filter(|value| !value.trim().is_empty()) {
        return Some(GoogleKeyEntry {
            value,
            source: "Process environment",
            variable: Some(name.into()),
            manageable: false,
        });
    }
    let value = fs::read_to_string(agent_dir.join(".env"))
        .ok()?
        .lines()
        .filter(|line| !line.trim_start().starts_with('#'))
        .filter_map(|line| line.split_once('='))
        .find_map(|(key, value)| (key.trim() == name).then(|| value.trim().to_string()))
        .filter(|value| !value.is_empty())?;
    Some(GoogleKeyEntry {
        value,
        source: "Local key file",
        variable: Some(name.into()),
        manageable: true,
    })
}

fn axorbis_google_key_entries() -> Vec<GoogleKeyEntry> {
    let Some(home) = env::var_os("HOME") else {
        return Vec::new();
    };
    let agent_dir = PathBuf::from(home).join(".axorbis/agent");
    let path = agent_dir.join("models.json");
    let mut keys = Vec::new();
    if let Ok(bytes) = fs::read(path) {
        if let Ok(config) = serde_json::from_slice::<Value>(&bytes) {
            if let Some(configured) = config["providers"]["google"]["apiKey"].as_str() {
                let key = if let Some(name) = configured.trim().strip_prefix('$') {
                    axorbis_env_key(&agent_dir, name)
                } else {
                    Some(GoogleKeyEntry {
                        value: configured.trim().to_string(),
                        source: "Axorbis configuration",
                        variable: None,
                        manageable: false,
                    })
                };
                if let Some(key) = key.filter(|key| !key.value.is_empty()) {
                    keys.push(key);
                }
            }
        }
    }
    let key_number = |name: &str| {
        name.strip_prefix("GEMINI_API_KEY_")
            .and_then(|suffix| suffix.parse::<usize>().ok())
            .filter(|number| *number >= 2)
    };
    let mut numbers = BTreeSet::new();
    for (name, _) in env::vars_os() {
        if let Some(number) = name.to_str().and_then(key_number) {
            numbers.insert(number);
        }
    }
    if let Ok(contents) = fs::read_to_string(agent_dir.join(".env")) {
        for line in contents
            .lines()
            .filter(|line| !line.trim_start().starts_with('#'))
        {
            if let Some((name, _)) = line.split_once('=') {
                if let Some(number) = key_number(name.trim()) {
                    numbers.insert(number);
                }
            }
        }
    }
    for number in numbers {
        let name = format!("GEMINI_API_KEY_{number}");
        if let Some(key) = axorbis_env_key(&agent_dir, &name) {
            if !keys
                .iter()
                .any(|entry: &GoogleKeyEntry| entry.value == key.value)
            {
                keys.push(key);
            }
        }
    }
    keys
}

fn axorbis_google_keys() -> Vec<String> {
    axorbis_google_key_entries()
        .into_iter()
        .map(|entry| entry.value)
        .collect()
}

fn openalex_api_key() -> Option<String> {
    let agent_dir = PathBuf::from(env::var_os("HOME")?).join(".axorbis/agent");
    axorbis_env_key(&agent_dir, "OPENALEX_API_KEY").map(|entry| entry.value)
}

fn provider_api_key(name: &str) -> Option<String> {
    let agent_dir = PathBuf::from(env::var_os("HOME")?).join(".axorbis/agent");
    axorbis_env_key(&agent_dir, name).map(|entry| entry.value)
}

fn google_key_info() -> Vec<GoogleKeyInfo> {
    axorbis_google_key_entries()
        .into_iter()
        .enumerate()
        .map(|(index, entry)| GoogleKeyInfo {
            id: format!("Key {}", index + 1),
            source: entry.source.into(),
            variable: entry.variable,
            manageable: entry.manageable,
        })
        .collect()
}

fn agent_key_file() -> Result<PathBuf, String> {
    let home = env::var_os("HOME").ok_or("Home folder is unavailable.")?;
    Ok(PathBuf::from(home).join(".axorbis/agent/.env"))
}

fn read_managed_key_file(path: &Path) -> Result<String, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err("The local key file must be a regular file.".into())
        }
        Ok(_) => fs::read_to_string(path).map_err(|_| "Could not read the local key file.".into()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(String::new()),
        Err(_) => Err("Could not inspect the local key file.".into()),
    }
}

fn save_managed_key_file(path: &Path, contents: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("Local key folder is unavailable.")?;
    fs::create_dir_all(parent).map_err(|_| "Could not create the local key folder.")?;
    let temporary = parent.join(format!(".env.tmp-{}-{}", std::process::id(), now_ms()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(&temporary)
        .map_err(|_| "Could not prepare the local key file.")?;
    let result = file
        .write_all(contents.as_bytes())
        .and_then(|_| file.sync_all());
    drop(file);
    let result = result.and_then(|_| fs::rename(&temporary, path));
    if result.is_err() {
        let _ = fs::remove_file(temporary);
        return Err("Could not save the local key file.".into());
    }
    Ok(())
}

fn is_google_key_variable(name: &str) -> bool {
    name == "GEMINI_API_KEY"
        || name
            .strip_prefix("GEMINI_API_KEY_")
            .and_then(|suffix| suffix.parse::<usize>().ok())
            .is_some_and(|number| number >= 2)
}

fn select_google_keys(configured: Vec<String>, selection: &str) -> Result<Vec<String>, String> {
    if selection == "auto" {
        return Ok(configured);
    }
    let index = selection
        .strip_prefix("key-")
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|index| *index > 0)
        .ok_or("Invalid Google key selection.")?;
    Ok(vec![configured
        .get(index - 1)
        .ok_or("The selected Google key is unavailable. Refresh the app and choose another key.")?
        .clone()])
}

fn python_program() -> PathBuf {
    if let Some(path) = env::var_os("SYNTHSCHOLAR_PYTHON") {
        return PathBuf::from(path);
    }
    if cfg!(debug_assertions) {
        #[cfg(windows)]
        let local = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.venv/Scripts/python.exe");
        #[cfg(not(windows))]
        let local = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.venv/bin/python");
        if local.is_file() {
            return local;
        }
    }
    PathBuf::from("python3")
}

fn runner_path(app: &AppHandle) -> Result<PathBuf, String> {
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../integration/review_runner.py");
    if cfg!(debug_assertions) && source.is_file() {
        return Ok(source);
    }
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("integration/review_runner.py");
    if bundled.is_file() {
        Ok(bundled)
    } else {
        Err("The SynthScholar runner is missing from this desktop build.".into())
    }
}

fn workspace_path(value: Option<String>) -> Result<PathBuf, String> {
    let path = value
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_workspace);
    fs::create_dir_all(&path)
        .map_err(|error| format!("Could not create the review workspace: {error}"))?;
    path.canonicalize().map_err(|error| error.to_string())
}

fn safe_slug(title: &str) -> String {
    let slug = title
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    let slug = slug
        .split('-')
        .filter(|part| !part.is_empty())
        .take(5)
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        "review".into()
    } else {
        slug
    }
}

fn review_directory(workspace: Option<String>, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id == "." || id == ".." {
        return Err("Invalid review id.".into());
    }
    let directory = workspace_path(workspace)?.join(id);
    if !directory.join("status.json").is_file() {
        return Err("Review folder does not exist.".into());
    }
    Ok(directory)
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
fn read_status(directory: &Path) -> Result<Value, String> {
    serde_json::from_slice(
        &fs::read(directory.join("status.json")).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}
fn write_status(directory: &Path, status: &Value) -> Result<(), String> {
    let temporary = directory.join("status.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(status).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    fs::rename(temporary, directory.join("status.json")).map_err(|error| error.to_string())
}

fn sync_active(state: &ReviewState) {
    let Ok(mut active) = state.active.lock() else {
        return;
    };
    let Some(child) = active.child.as_mut() else {
        return;
    };
    let Ok(Some(exit)) = child.try_wait() else {
        return;
    };
    if let Some(directory) = &active.directory {
        if let Ok(mut status) = read_status(directory) {
            if status["state"] == "running" {
                status["state"] = "failed".into();
                status["error"] = format!("Review process exited with {exit}.").into();
                let _ = write_status(directory, &status);
            }
        }
    }
    active.child = None;
    active.directory = None;
}

#[command]
pub fn review_environment() -> ReviewEnvironment {
    let python = python_program();
    let check = Command::new(&python)
        .args([
            "-c",
            "import importlib.metadata, synthscholar.pipeline, synthscholar.export; print(importlib.metadata.version('synthscholar'))",
        ])
        .output();
    let version = check.ok().and_then(|output| {
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
    });
    ReviewEnvironment {
        python: python.to_string_lossy().into_owned(),
        installed: version.is_some(),
        version,
        default_workspace: default_workspace().to_string_lossy().into_owned(),
        key_count: axorbis_google_keys().len(),
    }
}

#[command]
pub fn list_google_keys() -> Vec<GoogleKeyInfo> {
    google_key_info()
}

#[command]
pub fn add_google_key(api_key: String) -> Result<Vec<GoogleKeyInfo>, String> {
    let value = api_key.trim();
    if !(8..=512).contains(&value.len())
        || !value.chars().all(|character| character.is_ascii_graphic())
    {
        return Err("Enter a valid API key without spaces or line breaks.".into());
    }
    let _guard = KEY_FILE_LOCK
        .lock()
        .map_err(|_| "Key management is unavailable.")?;
    if axorbis_google_keys()
        .iter()
        .any(|existing| existing == value)
    {
        return Err("This API key is already configured.".into());
    }
    let path = agent_key_file()?;
    let mut contents = read_managed_key_file(&path)?;
    if contents
        .lines()
        .filter(|line| !line.trim_start().starts_with('#'))
        .filter_map(|line| line.split_once('='))
        .any(|(name, existing)| is_google_key_variable(name.trim()) && existing.trim() == value)
    {
        return Err("This API key is already configured.".into());
    }
    let mut occupied = BTreeSet::new();
    for (name, _) in env::vars_os() {
        if let Some(name) = name.to_str() {
            occupied.insert(name.to_string());
        }
    }
    for line in contents
        .lines()
        .filter(|line| !line.trim_start().starts_with('#'))
    {
        if let Some((name, _)) = line.split_once('=') {
            occupied.insert(name.trim().to_string());
        }
    }
    let mut number = 2usize;
    while occupied.contains(&format!("GEMINI_API_KEY_{number}")) {
        number = number
            .checked_add(1)
            .ok_or("Too many API keys are configured.")?;
    }
    if !contents.is_empty() && !contents.ends_with('\n') {
        contents.push('\n');
    }
    contents.push_str(&format!("GEMINI_API_KEY_{number}={value}\n"));
    save_managed_key_file(&path, &contents)?;
    Ok(google_key_info())
}

#[command]
pub fn remove_google_key(variable: String) -> Result<Vec<GoogleKeyInfo>, String> {
    let _guard = KEY_FILE_LOCK
        .lock()
        .map_err(|_| "Key management is unavailable.")?;
    if !is_google_key_variable(&variable)
        || !google_key_info()
            .iter()
            .any(|key| key.manageable && key.variable.as_deref() == Some(&variable))
    {
        return Err("This API key cannot be removed here.".into());
    }
    let path = agent_key_file()?;
    let contents = read_managed_key_file(&path)?;
    let mut removed = false;
    let remaining = contents
        .lines()
        .filter(|line| {
            let matches = !line.trim_start().starts_with('#')
                && line
                    .split_once('=')
                    .is_some_and(|(name, _)| name.trim() == variable);
            if matches {
                removed = true;
            }
            !matches
        })
        .collect::<Vec<_>>();
    if !removed {
        return Err("This API key is no longer in the local key file.".into());
    }
    let next = if remaining.is_empty() {
        String::new()
    } else {
        format!("{}\n", remaining.join("\n"))
    };
    save_managed_key_file(&path, &next)?;
    Ok(google_key_info())
}

#[command]
pub async fn choose_workspace(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Choose a literature review folder")
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
pub fn start_review(
    app: AppHandle,
    state: State<'_, ReviewState>,
    workspace: Option<String>,
    input: ReviewInput,
    key_selection: Option<String>,
    project: Option<String>,
    source_review_id: Option<String>,
    resume_checkpoint: Option<bool>,
) -> Result<Value, String> {
    sync_active(&state);
    if input.title.trim().is_empty() {
        return Err("Enter a review title.".into());
    }
    let _ = resume_checkpoint;
    let selection = key_selection.unwrap_or_else(|| "auto".into());
    let configured_keys = axorbis_google_keys();
    let api_keys = if configured_keys.is_empty() && selection == "auto" {
        Vec::new()
    } else {
        select_google_keys(configured_keys, &selection)?
    };
    let key_labels: Vec<String> = if selection == "auto" {
        (1..=api_keys.len())
            .map(|index| format!("Key {index}"))
            .collect()
    } else {
        vec![selection.replace("key-", "Key ")]
    };
    if !(1..=100).contains(&input.max_results) {
        return Err("Max results must be between 1 and 100.".into());
    }
    let mut active = state
        .active
        .lock()
        .map_err(|_| "Review state is unavailable.")?;
    if active.child.is_some() {
        return Err("A review is already running. Finish or cancel it first.".into());
    }
    let workspace = workspace_path(workspace)?;
    let id = format!("{}-{}", safe_slug(&input.title), now_ms());
    let directory = workspace.join(&id);
    fs::create_dir(&directory).map_err(|error| error.to_string())?;
    let project = project.unwrap_or_else(|| "Literature reviews".into());
    let project = project.trim();
    if project.is_empty() || project.len() > 100 {
        return Err("Enter a project name up to 100 characters.".into());
    }
    let started_at = now_ms();
    let status = json!({ "id": id, "title": input.title.trim(), "state": "running", "startedAt": started_at, "updatedAt": started_at,
        "workspace": workspace, "directory": directory, "progress": [], "error": null,
        "keySelection": selection, "keyCount": api_keys.len(),
        "keyUsage": key_labels.iter().map(|label| json!({ "id": label, "state": "idle", "active": false, "requests": 0, "tokens": 0 })).collect::<Vec<_>>(),
        "project": project, "input": input, "sourceReviewId": source_review_id });
    write_status(&directory, &status)?;
    let payload = json!({ "apiKeys": api_keys, "keyLabels": key_labels, "model": "gemini-3.5-flash-lite",
        "openalexApiKey": openalex_api_key(),
        "semanticScholarApiKey": provider_api_key("SEMANTIC_SCHOLAR_API_KEY"),
        "coreApiKey": provider_api_key("CORE_API_KEY"),
        "maxResults": input.max_results,
        "protocol": { "title": input.title.trim(), "objective": input.objective.trim(),
            "core_concepts": input.core_concepts.trim(), "related_concepts": input.related_concepts.trim(),
            "inclusion_criteria": input.inclusion.trim(), "exclusion_criteria": input.exclusion.trim(),
            "date_range_start": input.date_start,
            "date_range_end": input.date_end
        }
    });
    let log = fs::File::create(directory.join("runner.log")).map_err(|error| error.to_string())?;
    let errors = log.try_clone().map_err(|error| error.to_string())?;
    let mut command = Command::new(python_program());
    command
        .arg(runner_path(&app)?)
        .arg(&directory)
        .current_dir(&directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(errors));
    for name in [
        "OPENALEX_API_KEY",
        "SEMANTIC_SCHOLAR_API_KEY",
        "CORE_API_KEY",
        "GEMINI_API_KEY",
    ] {
        command.env_remove(name);
    }
    for (name, _) in env::vars_os() {
        if name
            .to_str()
            .is_some_and(|name| name.starts_with("GEMINI_API_KEY_"))
        {
            command.env_remove(name);
        }
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start SynthScholar: {error}"))?;
    let bytes = serde_json::to_vec(&payload).map_err(|error| error.to_string())?;
    if let Err(error) = child
        .stdin
        .take()
        .ok_or("Could not pass the review protocol to SynthScholar")?
        .write_all(&bytes)
    {
        let _ = child.kill();
        return Err(format!(
            "Could not pass the review protocol to SynthScholar: {error}"
        ));
    }
    active.directory = Some(directory);
    active.child = Some(child);
    Ok(status)
}

#[command]
pub fn review_input(workspace: Option<String>, id: String) -> Result<ReviewInput, String> {
    let directory = review_directory(workspace, &id)?;
    let status = read_status(&directory)?;
    if let Some(input) = status.get("input") {
        return serde_json::from_value(input.clone()).map_err(|error| error.to_string());
    }
    let protocol: Value =
        serde_json::from_slice(&fs::read(directory.join("protocol.json")).map_err(|_| {
            "This older review has no saved protocol to edit or rerun.".to_string()
        })?)
        .map_err(|error| error.to_string())?;
    let field = |name: &str| protocol[name].as_str().unwrap_or("").to_string();
    Ok(ReviewInput {
        title: status["title"].as_str().unwrap_or("").to_string(),
        objective: field("objective"),
        core_concepts: field("core_concepts"),
        related_concepts: field("related_concepts"),
        inclusion: field("inclusion_criteria"),
        exclusion: field("exclusion_criteria"),
        date_start: field("date_range_start"),
        date_end: field("date_range_end"),
        max_results: 20,
    })
}

#[command]
pub async fn reference_graph(
    app: AppHandle,
    workspace: Option<String>,
    id: String,
    refresh: Option<bool>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let directory = review_directory(workspace, &id)?;
        let cache = directory.join("citation-graph.json");
        if !refresh.unwrap_or(false) && cache.is_file() {
            return serde_json::from_slice(&fs::read(&cache).map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string());
        }
        let status = read_status(&directory)?;
        let mut articles: Vec<Value> = status["articles"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter(|item| item["state"] == "include")
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        if let Ok(bytes) = fs::read(directory.join("review.json")) {
            if let Ok(review) = serde_json::from_slice::<Value>(&bytes) {
                if let Some(included) = review["included_articles"].as_array() {
                    articles.extend(included.iter().cloned());
                }
            }
        }
        let payload = json!({ "articles": articles });
        let mut child = Command::new(python_program())
            .arg(runner_path(&app)?)
            .arg("--citation-graph")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Could not start Crossref lookup.".to_string())?;
        child
            .stdin
            .take()
            .ok_or("Could not send article identifiers.")?
            .write_all(&serde_json::to_vec(&payload).map_err(|error| error.to_string())?)
            .map_err(|_| "Could not send article identifiers.".to_string())?;
        let output = child
            .wait_with_output()
            .map_err(|_| "Crossref lookup did not finish.".to_string())?;
        if !output.status.success() {
            return Err("Crossref lookup failed. Try again later.".into());
        }
        let graph: Value = serde_json::from_slice(&output.stdout)
            .map_err(|_| "Crossref returned invalid graph metadata.".to_string())?;
        if graph["failed"].as_u64() == Some(0) {
            let temporary = directory.join("citation-graph.tmp");
            fs::write(&temporary, &output.stdout).map_err(|error| error.to_string())?;
            fs::rename(temporary, cache).map_err(|error| error.to_string())?;
        }
        Ok(graph)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[command]
pub fn update_review(
    state: State<'_, ReviewState>,
    workspace: Option<String>,
    id: String,
    input: ReviewInput,
    project: String,
) -> Result<Value, String> {
    sync_active(&state);
    let directory = review_directory(workspace, &id)?;
    let mut status = read_status(&directory)?;
    if status["state"] == "running" {
        return Err("Stop this review before editing it.".into());
    }
    if input.title.trim().is_empty() || !(1..=100).contains(&input.max_results) {
        return Err("Enter a title and a maximum result count from 1 to 100.".into());
    }
    let project = project.trim();
    if project.is_empty() || project.len() > 100 {
        return Err("Enter a project name up to 100 characters.".into());
    }
    status["title"] = input.title.trim().into();
    status["input"] = serde_json::to_value(input).map_err(|error| error.to_string())?;
    status["project"] = project.into();
    status["updatedAt"] = json!(now_ms());
    write_status(&directory, &status)?;
    Ok(status)
}

#[command]
pub fn delete_review(
    state: State<'_, ReviewState>,
    workspace: Option<String>,
    id: String,
) -> Result<(), String> {
    sync_active(&state);
    let directory = review_directory(workspace, &id)?;
    let status = read_status(&directory)?;
    if status["state"] == "running" {
        return Err("Stop this review before deleting it.".into());
    }
    fs::remove_dir_all(directory).map_err(|error| error.to_string())
}

#[command]
pub fn list_reviews(
    state: State<'_, ReviewState>,
    workspace: Option<String>,
) -> Result<Vec<Value>, String> {
    sync_active(&state);
    let workspace = workspace_path(workspace)?;
    let mut reviews = Vec::new();
    for entry in fs::read_dir(workspace).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            if let Ok(mut status) = read_status(&entry.path()) {
                if status["state"] == "running" {
                    let active = state
                        .active
                        .lock()
                        .map_err(|_| "Review state is unavailable.")?;
                    if active.directory.as_ref() != Some(&entry.path()) {
                        status["state"] = "interrupted".into();
                        status["completedAt"] = json!(now_ms());
                        status["error"] = "The review stopped when the application closed.".into();
                        let _ = write_status(&entry.path(), &status);
                    }
                }
                reviews.push(status);
            }
        }
    }
    reviews.sort_by(|left, right| right["id"].as_str().cmp(&left["id"].as_str()));
    Ok(reviews)
}

#[command]
pub fn read_review(
    state: State<'_, ReviewState>,
    workspace: Option<String>,
    id: String,
) -> Result<Value, String> {
    sync_active(&state);
    if id.contains('/') || id.contains('\\') || id == "." || id == ".." {
        return Err("Invalid review id.".into());
    }
    let directory = workspace_path(workspace)?.join(id);
    read_status(&directory)
}

#[command]
pub fn read_review_artifact(
    workspace: Option<String>,
    id: String,
    filename: String,
) -> Result<String, String> {
    if id.contains('/') || id.contains('\\') || id == "." || id == ".." {
        return Err("Invalid review id.".into());
    }
    if !matches!(
        filename.as_str(),
        "review.md"
            | "review.json"
            | "references.bib"
            | "protocol.json"
            | "status.json"
            | "runner.log"
    ) {
        return Err("This review file cannot be previewed.".into());
    }
    let directory = workspace_path(workspace)?.join(id);
    if !directory.join("status.json").is_file() {
        return Err("Review folder does not exist.".into());
    }
    let path = directory.join(filename);
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > 10 * 1024 * 1024 {
        return Err("This review file is too large to preview. Open its folder instead.".into());
    }
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[command]
pub fn cancel_review(state: State<'_, ReviewState>, id: String) -> Result<(), String> {
    let mut active = state
        .active
        .lock()
        .map_err(|_| "Review state is unavailable.")?;
    let directory = active.directory.clone().ok_or("No review is running.")?;
    if directory.file_name().and_then(|name| name.to_str()) != Some(id.as_str()) {
        return Err("This review is not running.".into());
    }
    if let Some(child) = active.child.as_mut() {
        child.kill().map_err(|error| error.to_string())?;
        let _ = child.wait();
    }
    let mut status = read_status(&directory)?;
    status["state"] = "cancelled".into();
    status["completedAt"] = json!(now_ms());
    status["error"] = Value::Null;
    write_status(&directory, &status)?;
    active.child = None;
    active.directory = None;
    Ok(())
}

#[command]
pub fn open_review_output(workspace: Option<String>, id: String) -> Result<(), String> {
    if id.contains('/') || id.contains('\\') || id == "." || id == ".." {
        return Err("Invalid review id.".into());
    }
    let directory = workspace_path(workspace)?.join(id);
    if !directory.join("status.json").is_file() {
        return Err("Review folder does not exist.".into());
    }
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "linux")]
    let mut command = Command::new("xdg-open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command
    };
    command
        .arg(directory)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

impl ReviewState {
    pub fn stop(&self) {
        let Ok(mut active) = self.active.lock() else {
            return;
        };
        if let Some(child) = active.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        active.child = None;
        active.directory = None;
    }
}

#[cfg(test)]
mod tests {
    use super::{
        is_google_key_variable, read_managed_key_file, safe_slug, save_managed_key_file,
        select_google_keys,
    };
    use std::{env, fs};
    #[test]
    fn slug_keeps_short_safe_name() {
        assert_eq!(
            safe_slug("CRISPR & sickle-cell review"),
            "crispr-sickle-cell-review"
        );
        assert_eq!(safe_slug("!!!"), "review");
    }

    #[test]
    fn key_selection_uses_only_the_chosen_credential() {
        let keys = vec!["first".to_string(), "second".to_string()];
        assert_eq!(select_google_keys(keys.clone(), "auto").unwrap(), keys);
        assert_eq!(
            select_google_keys(keys.clone(), "key-2").unwrap(),
            vec!["second"]
        );
        assert!(select_google_keys(keys.clone(), "key-0").is_err());
        assert!(select_google_keys(keys, "key-3").is_err());
    }

    #[test]
    fn key_variable_names_are_limited_to_the_gemini_pool() {
        assert!(is_google_key_variable("GEMINI_API_KEY"));
        assert!(is_google_key_variable("GEMINI_API_KEY_2"));
        assert!(!is_google_key_variable("GEMINI_API_KEY_1"));
        assert!(!is_google_key_variable("GEMINI_API_KEY_2_EXTRA"));
        assert!(!is_google_key_variable("OTHER_KEY"));
    }

    #[test]
    fn managed_key_file_preserves_other_entries() {
        let folder = env::temp_dir().join(format!(
            "axorbis-key-file-{}-{}",
            std::process::id(),
            super::now_ms()
        ));
        let path = folder.join(".env");
        save_managed_key_file(&path, "NCBI_API_KEY=other\nGEMINI_API_KEY_2=example\n").unwrap();
        assert_eq!(
            read_managed_key_file(&path).unwrap(),
            "NCBI_API_KEY=other\nGEMINI_API_KEY_2=example\n"
        );
        save_managed_key_file(&path, "NCBI_API_KEY=other\n").unwrap();
        assert_eq!(
            read_managed_key_file(&path).unwrap(),
            "NCBI_API_KEY=other\n"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        fs::remove_dir_all(folder).unwrap();
    }
}
