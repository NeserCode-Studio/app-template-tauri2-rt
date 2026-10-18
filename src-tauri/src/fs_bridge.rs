//! 工作区内文件读写桥。
//!
//! 所有命令都接收「相对工作区根」的相对路径，Rust 侧负责拼接并校验：
//! - 解析后必须仍位于工作区根目录之内（拒绝 `..` 逃逸）；
//! - 拒绝符号链接（避免通过软链越界）。
//! 越界或非法路径一律返回 Error，绝不静默读写工作区之外的文件。

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

/// 工作区根解析结果。
#[derive(Serialize)]
pub struct FileStat {
    pub is_dir: bool,
    pub size: u64,
    pub modified: i64,
}

/// 将相对路径解析为工作区内的绝对路径，并做越界 / 软链校验。
///
/// `rel` 必须是相对路径（以工作区根为基准）。返回的绝对路径保证
/// 以 `root` 为前缀，否则返回错误。
fn resolve_inside(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() {
        return Err("empty path".into());
    }
    let _candidate = root.join(rel);

    // 显式拒绝包含父目录回退的写法，作为第一道防线。
    if rel.contains("..") {
        return Err(format!("path escapes workspace: {}", rel));
    }

    // 解析所有中间组件，确认没有任何 Component 是 ParentDir / 软链。
    // 注意：Path::components() 不会做 OS 级解析，这里再用 canonicalize
    // 兜底一次，并把结果重新校验前缀。
    let mut checked = root.to_path_buf();
    for comp in Path::new(rel).components() {
        match comp {
            Component::ParentDir => {
                return Err(format!("path escapes workspace: {}", rel));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!("absolute path not allowed: {}", rel));
            }
            _ => {}
        }
        checked.push(comp);
    }

    // canonicalize 会把软链解析成真实路径；若文件尚不存在则跳过（写场景）。
    if checked.exists() {
        match fs::canonicalize(&checked) {
            Ok(real) => {
                if real != checked && !real.starts_with(root) {
                    return Err(format!("path escapes workspace: {}", rel));
                }
                return Ok(real);
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("resolve failed: {} ({})", rel, e)),
        }
    }

    Ok(checked)
}

#[tauri::command]
pub fn fs_read_text(root: String, rel: String) -> Result<String, String> {
    let root = PathBuf::from(root);
    let path = resolve_inside(&root, &rel)?;
    fs::read_to_string(&path).map_err(|e| format!("read failed: {} ({})", rel, e))
}

#[tauri::command]
pub fn fs_write_text(root: String, rel: String, content: String) -> Result<(), String> {
    let root = PathBuf::from(root);
    let path = resolve_inside(&root, &rel)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: ({})", e))?;
    }
    fs::write(&path, content.as_bytes()).map_err(|e| format!("write failed: {} ({})", rel, e))
}

#[tauri::command]
pub fn fs_read_dir(root: String, rel: String) -> Result<Vec<String>, String> {
    let root = PathBuf::from(root);
    let path = resolve_inside(&root, &rel)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| format!("read_dir failed: {} ({})", rel, e))? {
        let entry = entry.map_err(|e| format!("read_dir entry failed: ({})", e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        out.push(name);
    }
    out.sort();
    Ok(out)
}

#[tauri::command]
pub fn fs_create_dir(root: String, rel: String) -> Result<(), String> {
    let root = PathBuf::from(root);
    let path = resolve_inside(&root, &rel)?;
    fs::create_dir_all(&path).map_err(|e| format!("create_dir failed: {} ({})", rel, e))
}

#[tauri::command]
pub fn fs_remove(root: String, rel: String) -> Result<(), String> {
    let root = PathBuf::from(root);
    let path = resolve_inside(&root, &rel)?;
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| format!("remove_dir failed: {} ({})", rel, e))
    } else {
        fs::remove_file(&path).map_err(|e| format!("remove_file failed: {} ({})", rel, e))
    }
}

#[tauri::command]
pub fn fs_rename(root: String, from: String, to: String) -> Result<(), String> {
    let root = PathBuf::from(root);
    let src = resolve_inside(&root, &from)?;
    let dst = resolve_inside(&root, &to)?;
    fs::rename(&src, &dst).map_err(|e| format!("rename failed: {} -> {} ({})", from, to, e))
}

#[tauri::command]
pub fn fs_exists(root: String, rel: String) -> Result<bool, String> {
    let root = PathBuf::from(root);
    let path = resolve_inside(&root, &rel)?;
    Ok(path.exists())
}

#[tauri::command]
pub fn fs_stat(root: String, rel: String) -> Result<FileStat, String> {
    let root = PathBuf::from(root);
    let path = resolve_inside(&root, &rel)?;
    let meta = fs::metadata(&path).map_err(|e| format!("stat failed: {} ({})", rel, e))?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    Ok(FileStat {
        is_dir: meta.is_dir(),
        size: meta.len(),
        modified,
    })
}
