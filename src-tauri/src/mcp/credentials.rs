use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use super::auth::generate_token;
use super::error::{McpResult, McpRuntimeError};

#[derive(Debug, Default, Deserialize, Serialize)]
struct CredentialsFile {
    workspaces: BTreeMap<String, String>,
}

pub fn workspace_key(root: &str) -> String {
    let normalized = root.replace('\\', "/").to_lowercase();
    let digest = Sha256::digest(normalized.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn load_or_create_token(app: &AppHandle, root: &str, rotate: bool) -> McpResult<String> {
    let path = credentials_path(app)?;
    let mut credentials = read_credentials(&path);
    let key = workspace_key(root);
    if !rotate {
        if let Some(token) = credentials.workspaces.get(&key) {
            if !token.trim().is_empty() {
                return Ok(token.clone());
            }
        }
    }
    let token = generate_token();
    credentials.workspaces.insert(key, token.clone());
    write_credentials(&path, &credentials)?;
    Ok(token)
}

fn credentials_path(app: &AppHandle) -> McpResult<PathBuf> {
    let base = app
        .path()
        .app_config_dir()
        .map_err(|err| McpRuntimeError::Credentials(err.to_string()))?;
    Ok(base.join("mcp").join("credentials.json"))
}

fn read_credentials(path: &Path) -> CredentialsFile {
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

fn write_credentials(path: &Path, credentials: &CredentialsFile) -> McpResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| McpRuntimeError::Credentials("invalid credential path".into()))?;
    fs::create_dir_all(parent).map_err(|err| McpRuntimeError::Credentials(err.to_string()))?;
    let temp = path.with_extension("json.tmp");
    let content = serde_json::to_vec_pretty(credentials)
        .map_err(|err| McpRuntimeError::Credentials(err.to_string()))?;
    let mut options = fs::OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temp)
        .map_err(|err| McpRuntimeError::Credentials(err.to_string()))?;
    file.write_all(&content)
        .map_err(|err| McpRuntimeError::Credentials(err.to_string()))?;
    file.sync_all()
        .map_err(|err| McpRuntimeError::Credentials(err.to_string()))?;
    drop(file);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&temp, fs::Permissions::from_mode(0o600));
    }
    if fs::rename(&temp, path).is_err() {
        // Windows does not consistently replace an existing destination.
        if path.exists() {
            fs::remove_file(path).map_err(|err| McpRuntimeError::Credentials(err.to_string()))?;
        }
        fs::rename(&temp, path).map_err(|err| McpRuntimeError::Credentials(err.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_keys_are_stable_and_opaque() {
        let first = workspace_key(r"Z:\Novels\Demo");
        let second = workspace_key("z:/novels/demo");
        assert_eq!(first, second);
        assert_eq!(first.len(), 64);
        assert!(!first.contains("novels"));
    }
}
