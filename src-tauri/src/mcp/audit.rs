use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use sha2::{Digest, Sha256};

const MAX_AUDIT_BYTES: u64 = 10 * 1024 * 1024;
const AUDIT_RETENTION: std::time::Duration = std::time::Duration::from_secs(30 * 24 * 60 * 60);

#[derive(Debug, Serialize)]
pub struct AuditEntry<'a> {
    pub timestamp_ms: u128,
    pub request_id: &'a str,
    pub client: &'a str,
    pub tool: &'a str,
    pub arguments_hash: &'a str,
    pub status: &'a str,
    pub duration_ms: u128,
}

pub struct AuditWriter {
    path: Option<PathBuf>,
    lock: Mutex<()>,
}

impl AuditWriter {
    pub fn new(path: Option<PathBuf>) -> Self {
        if let Some(path) = path.as_ref() {
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
        }
        Self {
            path,
            lock: Mutex::new(()),
        }
    }

    pub fn record(&self, entry: AuditEntry<'_>) {
        let Some(path) = self.path.as_ref() else {
            return;
        };
        let Ok(_guard) = self.lock.lock() else {
            return;
        };
        rotate_if_needed(path);
        prune_expired(path);
        let Ok(line) = serde_json::to_string(&entry) else {
            return;
        };
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{line}");
        }
    }

    pub fn record_tool(
        &self,
        request_id: &str,
        client: &str,
        tool: &str,
        arguments: &serde_json::Value,
        status: &str,
        duration_ms: u128,
    ) {
        let arguments_hash = hash_json(arguments);
        self.record(AuditEntry {
            timestamp_ms: now_ms(),
            request_id,
            client,
            tool,
            arguments_hash: &arguments_hash,
            status,
            duration_ms,
        });
    }
}

pub fn hash_json(value: &serde_json::Value) -> String {
    let serialized = serde_json::to_vec(value).unwrap_or_default();
    let digest = Sha256::digest(serialized);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn rotate_if_needed(path: &Path) {
    let Ok(metadata) = fs::metadata(path) else {
        return;
    };
    if metadata.len() < MAX_AUDIT_BYTES {
        return;
    }
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("audit");
    let rotated = path.with_file_name(format!("{stem}.{}.jsonl", now_ms()));
    let _ = fs::rename(path, rotated);
}

fn prune_expired(path: &Path) {
    let Some(parent) = path.parent() else {
        return;
    };
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("audit");
    let prefix = format!("{stem}.");
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !name.starts_with(&prefix) || !name.ends_with(".jsonl") {
            continue;
        }
        let expired = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > AUDIT_RETENTION);
        if expired {
            let _ = fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_without_exposing_content() {
        let hash = hash_json(&serde_json::json!({"chapter": "secret body"}));
        assert_eq!(hash.len(), 64);
        assert!(!hash.contains("secret"));
    }
}
