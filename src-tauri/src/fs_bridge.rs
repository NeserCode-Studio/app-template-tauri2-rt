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

/// 工作区迁移结果。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMigrationResult {
    /// 迁移后的新工作区根目录。
    pub root: String,
    /// 旧目录是否已成功移除。跨磁盘复制后若旧目录被占用，这里会是 false。
    pub source_removed: bool,
}

/// 将相对路径解析为工作区内的绝对路径，并做越界 / 软链校验。
///
/// `rel` 必须是相对路径（以工作区根为基准）。返回的绝对路径保证
/// 以 `root` 为前缀，否则返回错误。
fn resolve_inside(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() {
        return Err("empty path".into());
    }
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
    //
    // 注意：Windows 上 canonicalize 返回 `\\?\Z:\...` 这类 verbatim 前缀路径，
    // 与调用方传入的 `Z:\...` 直接比较必然不相等。因此必须先把 root 也
    // canonicalize 成同一种形式，再比较前缀，否则所有路径都会被误判为越界。
    // 统一以 canonicalize 后的 root 为基准判断是否越界。
    let real_root =
        normalize(&fs::canonicalize(root).map_err(|e| format!("resolve root failed: {}", e))?);
    if let Ok(real) = fs::canonicalize(&checked) {
        let real = normalize(&real);
        if !real.starts_with(&real_root) {
            return Err(format!("path escapes workspace: {}", rel));
        }
        return Ok(real);
    }

    // 目标尚不存在（写入新文件的常见情形）。逐级向上找到第一个已存在的
    // 祖先目录，在那里做越界校验：新建 `works/abc/work.json` 时中间目录
    // 也可能尚未创建，直接 canonicalize 整条路径会失败。
    let mut ancestor = checked.parent();
    while let Some(dir) = ancestor {
        if dir.exists() {
            let real = normalize(
                &fs::canonicalize(dir).map_err(|e| format!("resolve failed: {} ({})", rel, e))?,
            );
            if !real.starts_with(&real_root) {
                return Err(format!("path escapes workspace: {}", rel));
            }
            break;
        }
        ancestor = dir.parent();
    }

    Ok(checked)
}

/// 去掉 Windows verbatim 前缀（`\\?\`），让 canonicalize 的结果
/// 与调用方传入的普通路径可比较。UNC 前缀（`\\?\UNC\`）单独还原。
fn normalize(path: &Path) -> PathBuf {
    let s = path.as_os_str().to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{}", rest));
    }
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

/// 校验并规范化工作区根目录。
///
/// 删除与迁移都是不可轻率执行的操作，因此只接受真实存在、带
/// `novels-yes.json` 的目录，并拒绝磁盘根目录。
fn validated_workspace_root(root: &str) -> Result<PathBuf, String> {
    if root.trim().is_empty() {
        return Err("workspace root is empty".into());
    }
    let raw = PathBuf::from(root);
    let root = normalize(
        &fs::canonicalize(&raw)
            .map_err(|e| format!("resolve workspace root failed: {} ({})", root, e))?,
    );
    if root.parent().is_none() || root.file_name().is_none() {
        return Err("refusing to operate on a filesystem root".into());
    }
    if !root.join("novels-yes.json").is_file() {
        return Err(format!(
            "refusing to operate on a non-workspace directory: {}",
            root.display()
        ));
    }
    Ok(root)
}

/// 递归复制工作区内容。符号链接会被拒绝，避免通过工作区内的链接越界复制。
fn copy_dir_contents(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if file_type.is_symlink() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("symlink is not supported: {}", entry.path().display()),
            ));
        }
        if file_type.is_dir() {
            copy_dir_contents(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
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

/// 永久删除整个工作区目录。
///
/// 工作区删除与作品 / 章节删除语义不同：作品删除有回收站，而工作区本身
/// 被删除后连回收站也一并消失，因此这里不提供恢复路径。
#[tauri::command]
pub fn workspace_delete(root: String) -> Result<(), String> {
    let root = validated_workspace_root(&root)?;
    fs::remove_dir_all(&root)
        .map_err(|e| format!("workspace delete failed: {} ({})", root.display(), e))
}

/// 把整个工作区迁移到用户选择的目标目录。
///
/// 目标必须是空目录。优先使用同盘 rename 保留文件时间；跨盘时退化为
/// 递归复制，复制完整后才删除旧目录。若旧目录删除失败，仍返回新根路径，
/// 由前端提示用户手动清理残留副本。
#[tauri::command]
pub fn workspace_migrate(root: String, target: String) -> Result<WorkspaceMigrationResult, String> {
    let source = validated_workspace_root(&root)?;
    let target = normalize(
        &fs::canonicalize(&target)
            .map_err(|e| format!("resolve migration target failed: {} ({})", target, e))?,
    );
    if !target.is_dir() {
        return Err(format!(
            "migration target is not a directory: {}",
            target.display()
        ));
    }
    if source == target {
        return Err("migration target must differ from the current workspace".into());
    }
    if target.starts_with(&source) || source.starts_with(&target) {
        return Err("migration target must not contain or be inside the current workspace".into());
    }
    if fs::read_dir(&target)
        .map_err(|e| format!("read migration target failed: {} ({})", target.display(), e))?
        .next()
        .is_some()
    {
        return Err("migration target must be empty".into());
    }

    /*
     * 同一磁盘上先尝试直接改名：这是最快且保留全部文件元数据的路径。
     * 目录选择器只会返回已存在目录，所以先移除这个空目标目录。
     */
    let rename_result = fs::remove_dir(&target).and_then(|_| fs::rename(&source, &target));
    if rename_result.is_ok() {
        return Ok(WorkspaceMigrationResult {
            root: target.display().to_string(),
            source_removed: true,
        });
    }

    copy_dir_contents(&source, &target).map_err(|e| {
        let _ = fs::remove_dir_all(&target);
        format!(
            "workspace copy failed: {} -> {} ({})",
            source.display(),
            target.display(),
            e
        )
    })?;

    let source_removed = fs::remove_dir_all(&source).is_ok();
    Ok(WorkspaceMigrationResult {
        root: target.display().to_string(),
        source_removed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 父目录回退必须被拒绝，无论它是否真的能解析到工作区内。
    #[test]
    fn rejects_parent_traversal() {
        let root = std::env::temp_dir();
        let err = resolve_inside(&root, "../outside.txt");
        assert!(err.is_err(), "expected traversal to be rejected");
    }

    /// 绝对路径输入必须被拒绝（命令约定只接受相对路径）。
    #[test]
    fn rejects_absolute_path() {
        let root = std::env::temp_dir();
        let err = resolve_inside(&root, r"C:\Windows\System32\drivers\etc\hosts");
        assert!(err.is_err(), "expected absolute path to be rejected");
    }

    /// 空路径必须被拒绝。
    #[test]
    fn rejects_empty_path() {
        let root = std::env::temp_dir();
        assert!(resolve_inside(&root, "").is_err());
    }

    /// 正常相对路径应当能解析出，且位于工作区之内。
    #[test]
    fn resolves_normal_relative_path() {
        let root = std::env::temp_dir();
        let path = resolve_inside(&root, "works/abc/work.json").expect("should resolve");
        assert!(path.starts_with(normalize(&fs::canonicalize(&root).unwrap())));
    }

    /// Windows 下 canonicalize 返回 `\\?\` 前缀，normalize 应当剥掉它，
    /// 使其与普通路径可比较（这正是"创建后看不到文件"那个 bug 的根因）。
    #[test]
    fn normalize_strips_verbatim_prefix() {
        let p = PathBuf::from(r"\\?\C:\Users\test");
        assert_eq!(normalize(&p), PathBuf::from(r"C:\Users\test"));

        let unc = PathBuf::from(r"\\?\UNC\server\share");
        assert_eq!(normalize(&unc), PathBuf::from(r"\\server\share"));
    }
}
