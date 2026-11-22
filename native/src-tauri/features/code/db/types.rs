use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaColumn {
    pub name: String,
    #[serde(rename = "type")]
    pub type_name: String,
    pub nullable: bool,
    pub primary_key: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TableKind {
    Table,
    View,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaTable {
    pub name: String,
    pub kind: TableKind,
    pub columns: Vec<SchemaColumn>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaGroup {
    pub name: String,
    pub tables: Vec<SchemaTable>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbSchema {
    pub schemas: Vec<SchemaGroup>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryColumn {
    pub name: String,
    #[serde(rename = "type")]
    pub type_name: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<QueryColumn>,
    pub rows: Vec<Vec<Value>>,
    pub rows_affected: u64,
    pub elapsed_ms: u64,
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRef {
    #[serde(default)]
    pub schema: Option<String>,
    pub name: String,
}

pub fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

pub const SAFE_INTEGER: i64 = (1 << 53) - 1;

pub fn integer(value: i64) -> Value {
    if (-SAFE_INTEGER..=SAFE_INTEGER).contains(&value) {
        Value::from(value)
    } else {
        Value::String(value.to_string())
    }
}

pub fn float(value: f64) -> Value {
    serde_json::Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or_else(|| Value::String(value.to_string()))
}

pub fn bytes(value: &[u8]) -> Value {
    Value::String(format!("\\x{}", hex::encode(value)))
}

pub fn sentence(text: &str) -> String {
    let text = text.trim();
    let mut chars = text.chars();
    let mut out = match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect::<String>(),
        None => return "Something went wrong.".to_string(),
    };
    if !out.ends_with(&['.', '!', '?'][..]) {
        out.push('.');
    }
    out
}

pub fn check_edit(
    primary: &[&str],
    columns: &[&str],
    key: &serde_json::Map<String, Value>,
    changes: &serde_json::Map<String, Value>,
) -> Result<(), String> {
    if primary.is_empty() {
        return Err(
            "This table has no primary key, so Misty can't tell which row to change.".into(),
        );
    }
    if key.len() != primary.len() || primary.iter().any(|name| !key.contains_key(*name)) {
        return Err("The table's primary key has changed. Open the table again.".into());
    }
    if primary.iter().any(|name| key[*name].is_null()) {
        return Err("This row has no key, so Misty can't tell which row to change.".into());
    }
    if changes.is_empty() {
        return Err("There's nothing to save.".into());
    }
    if let Some(missing) = changes
        .keys()
        .find(|name| !columns.contains(&name.as_str()))
    {
        return Err(format!("The column {missing} isn't in the table any more."));
    }
    Ok(())
}

pub fn matched_error(changed: u64) -> String {
    if changed == 0 {
        "No row matched, so nothing was saved. It may have changed or been deleted; run the query again."
            .to_string()
    } else {
        format!("That would have changed {changed} rows, so nothing was saved.")
    }
}
