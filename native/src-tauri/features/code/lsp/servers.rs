use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};
use std::time::Duration;

use serde_json::json;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot};

use super::catalog::Language;
use super::framing;
use super::install::Launch;

const MOST_RUNNING: usize = 12;
const STOP_GRACE: Duration = Duration::from_secs(2);
const KEEP_STDERR: usize = 2048;
pub(super) const MESSAGE: &str = "misty://code-lsp-message";
pub(super) const CLOSED: &str = "misty://code-lsp-closed";
pub(super) const GONE: &str = "That language server has stopped.";

struct Server {
    language: Language,
    root: PathBuf,
    window: String,
    page: String,
    dir: PathBuf,
    input: Mutex<Option<mpsc::UnboundedSender<String>>>,
    stop: Mutex<Option<oneshot::Sender<()>>>,
}

impl Server {
    fn end(&self) {
        lock(&self.input).take();
        if let Some(stop) = lock(&self.stop).take() {
            let _ = stop.send(());
        }
    }
}

struct Entry {
    server: Arc<Server>,
    users: usize,
}

static RUNNING: LazyLock<Mutex<HashMap<String, Entry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static STARTING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn running() -> MutexGuard<'static, HashMap<String, Entry>> {
    lock(&RUNNING)
}

fn end_all(ended: Vec<Entry>) {
    for entry in ended {
        entry.server.end();
    }
}

pub(super) async fn start(
    app: &tauri::AppHandle,
    window: &str,
    page: &str,
    language: Language,
    root: PathBuf,
    launch: Launch,
) -> Result<String, String> {
    let _starting = STARTING.lock().await;
    {
        let mut held = running();
        let stale: Vec<String> = held
            .iter()
            .filter(|(_, entry)| entry.server.window == window && entry.server.page != page)
            .map(|(id, _)| id.clone())
            .collect();
        let stale: Vec<Entry> = stale.iter().filter_map(|id| held.remove(id)).collect();
        let found = held.iter_mut().find(|(_, entry)| {
            entry.server.window == window
                && entry.server.language == language
                && entry.server.root == root
        });
        if let Some((id, entry)) = found {
            entry.users += 1;
            let id = id.clone();
            drop(held);
            end_all(stale);
            return Ok(id);
        }
        let full = held.len() >= MOST_RUNNING;
        drop(held);
        end_all(stale);
        if full {
            return Err("Too many language servers are running. Close some files first.".into());
        }
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    let server = spawn(app, &id, window, page, language, root, launch)?;
    running().insert(id.clone(), Entry { server, users: 1 });
    Ok(id)
}

fn spawn(
    app: &tauri::AppHandle,
    id: &str,
    window: &str,
    page: &str,
    language: Language,
    root: PathBuf,
    launch: Launch,
) -> Result<Arc<Server>, String> {
    let mut command = tokio::process::Command::new(&launch.program);
    command
        .args(&launch.args)
        .current_dir(&root)
        .env("PATH", &launch.path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    crate::engines::hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("{} couldn't be started: {error}", language.server()))?;
    let (Some(mut stdin), Some(stdout), Some(stderr)) =
        (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        let _ = child.start_kill();
        return Err(format!("{} couldn't be started.", language.server()));
    };
    let (input, mut outgoing) = mpsc::unbounded_channel::<String>();
    let (stop, stopped) = oneshot::channel::<()>();
    let server = Arc::new(Server {
        language,
        root,
        window: window.to_string(),
        page: page.to_string(),
        dir: launch.dir,
        input: Mutex::new(Some(input)),
        stop: Mutex::new(Some(stop)),
    });

    tauri::async_runtime::spawn(async move {
        while let Some(body) = outgoing.recv().await {
            let header = framing::header(&body);
            let written = async {
                stdin.write_all(header.as_bytes()).await?;
                stdin.write_all(body.as_bytes()).await?;
                stdin.flush().await
            }
            .await;
            if written.is_err() {
                break;
            }
        }
    });

    {
        let app = app.clone();
        let id = id.to_string();
        let server = Arc::clone(&server);
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stdout);
            loop {
                match framing::read_message(&mut reader).await {
                    Ok(Some(message)) => {
                        let _ = app.emit_to(
                            server.window.as_str(),
                            MESSAGE,
                            json!({ "id": id, "message": message }),
                        );
                    }
                    Ok(None) => break,
                    Err(_) => {
                        server.end();
                        break;
                    }
                }
            }
        });
    }

    let said = Arc::new(Mutex::new(String::new()));
    {
        let said = Arc::clone(&said);
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut line = Vec::new();
            loop {
                line.clear();
                match reader.read_until(b'\n', &mut line).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
                let mut kept = lock(&said);
                kept.push_str(&String::from_utf8_lossy(&line));
                if kept.len() > KEEP_STDERR {
                    let cut = kept.len() - KEEP_STDERR;
                    let cut = (cut..kept.len())
                        .find(|at| kept.is_char_boundary(*at))
                        .unwrap_or(kept.len());
                    kept.drain(..cut);
                }
            }
        });
    }

    {
        let app = app.clone();
        let id = id.to_string();
        let server = Arc::clone(&server);
        tauri::async_runtime::spawn(async move {
            let asked = tokio::select! {
                _ = child.wait() => false,
                _ = stopped => true,
            };
            if asked
                && tokio::time::timeout(STOP_GRACE, child.wait())
                    .await
                    .is_err()
            {
                let _ = child.kill().await;
            }
            let ended_by_itself = {
                let mut held = running();
                let current = held
                    .get(&id)
                    .is_some_and(|entry| Arc::ptr_eq(&entry.server, &server));
                if current {
                    held.remove(&id);
                }
                current && !asked
            };
            if ended_by_itself {
                let last = lock(&said)
                    .lines()
                    .rev()
                    .find(|line| !line.trim().is_empty())
                    .map(|line| line.trim().chars().take(300).collect::<String>());
                let message = match last {
                    Some(last) => format!("{} stopped: {last}", server.language.server()),
                    None => format!("{} stopped.", server.language.server()),
                };
                let _ = app.emit_to(
                    server.window.as_str(),
                    CLOSED,
                    json!({ "id": id, "message": message }),
                );
            }
        });
    }
    Ok(server)
}

fn owned(window: &str, id: &str) -> Result<Option<Arc<Server>>, String> {
    let Some(server) = running().get(id).map(|entry| Arc::clone(&entry.server)) else {
        return Ok(None);
    };
    if server.window != window {
        return Err("That language server belongs to another window.".into());
    }
    Ok(Some(server))
}

pub(super) fn send(window: &str, id: &str, messages: Vec<String>) -> Result<(), String> {
    if messages
        .iter()
        .any(|message| message.len() > framing::MOST_BYTES)
    {
        return Err("That message is too large for the language server.".into());
    }
    let server = owned(window, id)?.ok_or(GONE)?;
    let input = lock(&server.input);
    let input = input.as_ref().ok_or(GONE)?;
    for message in messages {
        input.send(message).map_err(|_| GONE.to_string())?;
    }
    Ok(())
}

pub(super) fn release(window: &str, id: &str) -> Result<bool, String> {
    if owned(window, id)?.is_none() {
        return Ok(true);
    }
    let ended = {
        let mut held = running();
        let last = match held.get_mut(id) {
            Some(entry) => {
                entry.users = entry.users.saturating_sub(1);
                entry.users == 0
            }
            None => return Ok(true),
        };
        if last {
            held.remove(id)
        } else {
            None
        }
    };
    match ended {
        Some(entry) => {
            entry.server.end();
            Ok(true)
        }
        None => Ok(false),
    }
}

pub(super) fn dirs_in_use() -> Vec<PathBuf> {
    let dirs: HashSet<PathBuf> = running()
        .values()
        .map(|entry| entry.server.dir.clone())
        .collect();
    dirs.into_iter().collect()
}

pub(super) fn close_window(window: &str) {
    let ended: Vec<Entry> = {
        let mut held = running();
        let ids: Vec<String> = held
            .iter()
            .filter(|(_, entry)| entry.server.window == window)
            .map(|(id, _)| id.clone())
            .collect();
        ids.iter().filter_map(|id| held.remove(id)).collect()
    };
    end_all(ended);
}

pub(super) fn close_all() {
    let ended: Vec<Entry> = running().drain().map(|(_, entry)| entry).collect();
    end_all(ended);
}
