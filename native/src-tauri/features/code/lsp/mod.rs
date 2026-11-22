mod catalog;
mod download;
mod framing;
mod install;
mod node;
mod roots;
mod servers;
mod store;

use std::collections::HashSet;
use std::path::Path;
use std::sync::{LazyLock, Mutex};

use serde::Serialize;

use crate::project::{linked_path, person_window};
use catalog::Language;
use download::Progress;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspStatus {
    language: &'static str,
    server: &'static str,
    installed: bool,
    version: Option<String>,
    problem: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspStarted {
    id: String,
    root_uri: String,
    file_uri: String,
    folder_uri: String,
}

async fn status_of(base: &Path, language: Language) -> LspStatus {
    let record = install::current(base, language).await;
    LspStatus {
        language: language.id(),
        server: language.server(),
        installed: record.is_some(),
        version: record.map(|record| record.version),
        problem: install::missing(language),
    }
}

fn check_for_update(base: &Path, language: Language) {
    install::check_for_update(base.to_path_buf(), language, servers::dirs_in_use());
}

#[tauri::command]
pub async fn code_lsp_status(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    language: String,
) -> Result<LspStatus, String> {
    person_window(&webview)?;
    let _ = account;
    let language = Language::from_id(&language)?;
    let base = store::base(&app)?;
    let status = status_of(&base, language).await;
    if status.installed {
        check_for_update(&base, language);
    }
    Ok(status)
}

#[tauri::command]
pub async fn code_lsp_install(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    language: String,
) -> Result<LspStatus, String> {
    person_window(&webview)?;
    let _ = account;
    let language = Language::from_id(&language)?;
    if let Some(problem) = install::missing(language) {
        return Err(problem.into());
    }
    let base = store::base(&app)?;
    let progress = Progress {
        app: app.clone(),
        window: webview.label().to_string(),
        language: language.id(),
    };
    install::install(&base, language, Some(&progress)).await?;
    Ok(status_of(&base, language).await)
}

#[tauri::command]
pub async fn code_lsp_start(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    language: String,
    folder: String,
    file: String,
    page: String,
) -> Result<LspStarted, String> {
    person_window(&webview)?;
    let language = Language::from_id(&language)?;
    if page.is_empty() || page.len() > 64 {
        return Err("That page can't start a language server.".into());
    }
    let folder = linked_path(&app, &account, &folder).await?;
    let file = linked_path(&app, &account, &file).await?;
    if !file.starts_with(&folder) {
        return Err("That file isn't in this folder.".into());
    }
    let root = {
        let (folder, file) = (folder.clone(), file.clone());
        tokio::task::spawn_blocking(move || roots::workspace_root(language, &folder, &file))
            .await
            .map_err(|error| error.to_string())?
    };
    let base = store::base(&app)?;
    let record = install::current(&base, language)
        .await
        .ok_or_else(|| format!("{} isn't installed yet.", language.server()))?;
    let launch = install::launch(&base, language, &record).await?;
    watch_window(&webview);
    let id = servers::start(&app, webview.label(), &page, language, root.clone(), launch).await?;
    check_for_update(&base, language);
    Ok(LspStarted {
        id,
        root_uri: folder_uri(&root)?,
        file_uri: url::Url::from_file_path(&file)
            .map_err(|_| "That file has no address a language server can use.".to_string())?
            .to_string(),
        folder_uri: folder_uri(&folder)?,
    })
}

fn folder_uri(folder: &Path) -> Result<String, String> {
    let uri = url::Url::from_directory_path(folder)
        .map_err(|_| "That folder has no address a language server can use.".to_string())?;
    Ok(uri.as_str().trim_end_matches('/').to_string())
}

#[tauri::command]
pub async fn code_lsp_send(
    webview: tauri::Webview,
    id: String,
    messages: Vec<String>,
) -> Result<(), String> {
    person_window(&webview)?;
    servers::send(webview.label(), &id, messages)
}

#[tauri::command]
pub async fn code_lsp_stop(webview: tauri::Webview, id: String) -> Result<bool, String> {
    person_window(&webview)?;
    servers::release(webview.label(), &id)
}

static WATCHED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

fn watch_window(webview: &tauri::Webview) {
    let label = webview.label().to_string();
    let first = WATCHED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(label.clone());
    if !first {
        return;
    }
    webview.window().on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            close_window(&label);
        }
    });
}

pub fn close_window(window: &str) {
    servers::close_window(window);
    WATCHED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(window);
}

pub fn close_all() {
    servers::close_all();
}
