//! 导出桥：把内容写到用户指定的**工作区之外**的位置。
//!
//! 与 `fs_bridge` 的关键区别：那条桥的作用域被刻意限制在工作区内
//! （拒绝 `..` 逃逸与符号链接），因为它是应用读写自身数据的通道。
//! 导出恰恰相反——用户要把成品放到自己的文档目录、U 盘或网盘同步目录，
//! 目标由系统保存对话框给出，天然在应用控制之外。
//!
//! 因此这里不做工作区校验，只要求：
//! - 路径必须是绝对路径（相对路径的基准不确定，宁可拒绝）；
//! - 父目录必须已存在（不代替用户建目录，避免写错位置时留下垃圾目录）；
//! - 只写单个文件，不递归、不删除。

use std::fs;
use std::path::PathBuf;

/// 写入单个导出文件。成功返回实际字节数。
#[tauri::command]
pub fn fs_write_export(path: String, content: String) -> Result<u64, String> {
    let target = PathBuf::from(&path);
    if !target.is_absolute() {
        return Err(format!("export path must be absolute: {}", path));
    }
    match target.parent() {
        Some(dir) if dir.is_dir() => {}
        Some(dir) => return Err(format!("export directory does not exist: {:?}", dir)),
        None => return Err("export path has no parent".into()),
    }
    // 目标是已存在的目录：直接写会失败，给出更明确的提示。
    if target.is_dir() {
        return Err(format!("export target is a directory: {}", path));
    }
    // 换行风格由前端拼接时决定，这里按字节原样写入，不做平台转换。
    let bytes = content.as_bytes();
    fs::write(&target, bytes).map_err(|e| format!("export write failed: {} ({})", path, e))?;
    Ok(bytes.len() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_relative_path() {
        assert!(fs_write_export("out.txt".into(), "x".into()).is_err());
    }

    #[test]
    fn rejects_missing_directory() {
        let p = std::env::temp_dir().join("novels-yes-no-such-dir-xyz/out.txt");
        assert!(fs_write_export(p.to_string_lossy().into(), "x".into()).is_err());
    }

    #[test]
    fn writes_file_and_returns_size() {
        let dir = std::env::temp_dir().join("novels-yes-export-test");
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("out.txt");
        let n = fs_write_export(p.to_string_lossy().into(), "\u{4f60}\u{597d}".into()).unwrap();
        // 两个汉字在 UTF-8 下各占 3 字节。
        assert_eq!(n, 6);
        assert_eq!(fs::read_to_string(&p).unwrap(), "\u{4f60}\u{597d}");
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn writes_crlf_verbatim() {
        let dir = std::env::temp_dir().join("novels-yes-export-test");
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("crlf.txt");
        fs_write_export(p.to_string_lossy().into(), "a\r\nb".into()).unwrap();
        // 换行风格必须原样保留，不能被平台改写。
        assert_eq!(fs::read_to_string(&p).unwrap(), "a\r\nb");
        let _ = fs::remove_file(&p);
    }
}
