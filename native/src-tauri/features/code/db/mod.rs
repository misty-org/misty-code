mod access;
mod pg_pool;
mod pg_values;
mod postgres;
mod running;
mod sqlite;
mod store;
mod types;

use std::time::Instant;

use serde_json::{Map, Value};

use crate::project::person_window;

use access::{
    blocking, misty_store, normalize, refuse_misty_data, saved_connection, saved_postgres,
    saved_sqlite, sqlite_file, sqlite_standing, BROKEN,
};
use running::{running_key, RunGuard, Stopper};
use store::{Connection, ConnectionInfo, DbKind, PostgresTarget, Saved};
use types::{DbSchema, QueryResult, TableRef};

const DEFAULT_LIMIT: u32 = 500;
const MOST_ROWS: u32 = 10_000;

#[tauri::command]
pub async fn code_db_list(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
) -> Result<Vec<ConnectionInfo>, String> {
    person_window(&webview)?;
    let store = misty_store(&app);
    let saved = blocking(move || store::list(&store, &account)).await?;
    Ok(saved.iter().map(ConnectionInfo::from).collect())
}

#[tauri::command]
pub async fn code_db_save(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    connection: Connection,
    password: Option<String>,
) -> Result<ConnectionInfo, String> {
    person_window(&webview)?;
    let mut connection = normalize(connection)?;
    let store = misty_store(&app);
    let existing = if connection.id.is_empty() {
        connection.id = uuid::Uuid::new_v4().to_string();
        None
    } else {
        let (store, account, id) = (store.clone(), account.clone(), connection.id.clone());
        Some(blocking(move || store::find(&store, &account, &id)).await?)
    };

    let mut picked = false;
    if let Some(target) = &connection.sqlite {
        picked = sqlite_standing(&app, &account, &target.path, existing.as_ref()).await?;
        sqlite_file(&app, &account, &target.path, picked).await?;
    }

    let had_password = existing.as_ref().is_some_and(|saved| saved.has_password);
    let saved = blocking(move || {
        let id = connection.id.clone();
        let has_password = match (connection.kind, password.as_deref()) {
            (DbKind::Postgres, Some("")) => {
                store::delete_password(&account, &id)?;
                false
            }
            (DbKind::Postgres, Some(password)) => {
                store::store_password(&account, &id, password)?;
                true
            }
            (DbKind::Postgres, None) => had_password,
            (DbKind::Sqlite, _) => {
                if had_password {
                    store::delete_password(&account, &id)?;
                }
                false
            }
        };
        let saved = Saved {
            connection,
            has_password,
            picked,
        };
        store::put(&store, &account, saved.clone())?;
        Ok((saved, account))
    })
    .await?;
    let (saved, account) = saved;
    postgres::forget(&account, &saved.connection.id);
    Ok(ConnectionInfo::from(&saved))
}

#[tauri::command]
pub async fn code_db_remove(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    id: String,
) -> Result<(), String> {
    person_window(&webview)?;
    postgres::forget(&account, &id);
    let store = misty_store(&app);
    blocking(move || {
        store::remove(&store, &account, &id)?;
        store::delete_password(&account, &id)
    })
    .await
}

#[tauri::command]
pub async fn code_db_test(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    connection: Connection,
    password: Option<String>,
) -> Result<(), String> {
    person_window(&webview)?;
    let connection = normalize(connection)?;
    let existing = if connection.id.is_empty() {
        None
    } else {
        saved_connection(&app, &account, &connection.id).await.ok()
    };
    match connection.kind {
        DbKind::Sqlite => {
            let path = connection.sqlite.as_ref().ok_or(BROKEN)?.path.clone();
            let picked = sqlite_standing(&app, &account, &path, existing.as_ref()).await?;
            let file = sqlite_file(&app, &account, &path, picked).await?;
            blocking(move || sqlite::test(&sqlite::open(&file)?)).await
        }
        DbKind::Postgres => {
            let target: PostgresTarget = connection.postgres.clone().ok_or(BROKEN)?;
            let password = match password.filter(|typed| !typed.is_empty()) {
                Some(typed) => Some(zeroize::Zeroizing::new(typed)),
                None if existing.as_ref().is_some_and(|saved| saved.has_password) => {
                    let (owner, id) = (account.clone(), connection.id.clone());
                    blocking(move || store::load_password(&owner, &id)).await?
                }
                None => None,
            };
            let client =
                postgres::connect(&target, password.as_deref().map(String::as_str)).await?;
            client
                .simple_query("SELECT 1")
                .await
                .map(|_| ())
                .map_err(|error| postgres::error_text(&error))
        }
    }
}

#[tauri::command]
pub async fn code_db_pick_sqlite(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    person_window(&webview)?;
    let _ = account;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose a SQLite database")
        .pick_file(move |file| {
            let _ = send.send(file);
        });
    let Some(file) = receive.await.ok().flatten() else {
        return Ok(None);
    };
    let path = file
        .into_path()
        .map_err(|_| "Choose a file on this computer.".to_string())?;
    refuse_misty_data(&app, &path)?;
    file_access::allow_picked_file(&path, file_access::Access::Write);
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn code_db_schema(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    id: String,
) -> Result<DbSchema, String> {
    person_window(&webview)?;
    let saved = saved_connection(&app, &account, &id).await?;
    match saved.connection.kind {
        DbKind::Sqlite => {
            let file = saved_sqlite(&app, &account, &saved).await?;
            blocking(move || sqlite::schema(&sqlite::open(&file)?)).await
        }
        DbKind::Postgres => {
            let mut lease = saved_postgres(&account, &saved).await?;
            postgres::schema(lease.client()).await
        }
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn code_db_query(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    id: String,
    sql: String,
    limit: Option<u32>,
    query_id: Option<String>,
) -> Result<QueryResult, String> {
    person_window(&webview)?;
    if sql.trim().is_empty() {
        return Err("Write a query to run.".into());
    }
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MOST_ROWS) as usize;
    let window = webview.label().to_string();
    let key = query_id
        .as_deref()
        .map(|query| running_key(&account, query));
    let saved = saved_connection(&app, &account, &id).await?;
    let started = Instant::now();
    let mut result = match saved.connection.kind {
        DbKind::Sqlite => {
            let file = saved_sqlite(&app, &account, &saved).await?;
            blocking(move || {
                let connection = sqlite::open(&file)?;
                let _running = RunGuard::start(
                    key,
                    &window,
                    Stopper::Sqlite(connection.get_interrupt_handle()),
                );
                sqlite::query(&connection, &sql, limit)
            })
            .await?
        }
        DbKind::Postgres => {
            let mut lease = saved_postgres(&account, &saved).await?;
            let _running = RunGuard::start(key, &window, Stopper::Postgres(lease.cancel_token()));
            postgres::query(&mut lease, &sql, limit).await?
        }
    };
    result.elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    Ok(result)
}

#[tauri::command]
pub async fn code_db_cancel(
    webview: tauri::Webview,
    account: String,
    query_id: String,
) -> Result<(), String> {
    person_window(&webview)?;
    if let Some(token) = running::stop(&running_key(&account, &query_id), webview.label()) {
        postgres::cancel(token).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn code_db_update_row(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    id: String,
    table: TableRef,
    key: Map<String, Value>,
    changes: Map<String, Value>,
) -> Result<(), String> {
    person_window(&webview)?;
    let saved = saved_connection(&app, &account, &id).await?;
    match saved.connection.kind {
        DbKind::Sqlite => {
            let file = saved_sqlite(&app, &account, &saved).await?;
            blocking(move || {
                let mut connection = sqlite::open(&file)?;
                sqlite::update_row(&mut connection, &table, &key, &changes)
            })
            .await
        }
        DbKind::Postgres => {
            let mut lease = saved_postgres(&account, &saved).await?;
            postgres::update_row(&mut lease, &table, &key, &changes).await
        }
    }
}
