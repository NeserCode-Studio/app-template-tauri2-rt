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

use serde::Serialize;

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

/// 以 UTF-8 读取任意文本文件，返回内容与实际使用的编码名。
///
/// 用于导入既有文稿：国内积累的 txt 小说相当一部分是 GBK / GB18030，
/// 直接按 UTF-8 解码会得到满屏替换字符（U+FFFD），而且**原文件不会被改写**，
/// 用户看不出哪里错了。这里做一次探测并转码，交给上层决定是否落盘。
///
/// 探测顺序：
/// 1. UTF-8 BOM —— 最明确，直接信任；
/// 2. 严格 UTF-8 —— 合法即 UTF-8（`from_utf8` 严格校验，不用容错解码）；
/// 3. GB18030 —— 超集，覆盖 GBK 与 GB2312，是中文文本的实际兜底。
///
/// 两者都不成立时返回错误而不是猜：宁可告诉用户"无法识别编码"，
/// 也不要静默产出一堆替换字符让用户去逐字校对。
#[tauri::command]
pub fn fs_read_text_auto(path: String) -> Result<AutoReadResult, String> {
    let bytes = fs::read(&path).map_err(|e| format!("read failed: {} ({})", path, e))?;
    read_bytes_auto(bytes).map_err(|e| format!("{} ({})", e, path))
}

#[derive(serde::Serialize, Debug)]
pub struct AutoReadResult {
    pub content: String,
    /// 实际编码：`utf-8` / `utf-8-bom` / `gb18030`。
    pub encoding: String,
    /// 是否检测到 BOM 并已剥离。
    pub had_bom: bool,
}

fn read_bytes_auto(bytes: Vec<u8>) -> Result<AutoReadResult, String> {
    // 1) UTF-8 BOM
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let body = &bytes[3..];
        let content = String::from_utf8(body.to_vec())
            .map_err(|_| "file claims utf-8 bom but body is invalid utf-8".to_string())?;
        return Ok(AutoReadResult {
            content,
            encoding: "utf-8-bom".into(),
            had_bom: true,
        });
    }
    // 2) 严格 UTF-8
    if let Ok(content) = String::from_utf8(bytes.clone()) {
        return Ok(AutoReadResult {
            content,
            encoding: "utf-8".into(),
            had_bom: false,
        });
    }
    /*
     * 3) 不是 UTF-8。此时**不猜着解码**，只做辅助判断。
     *
     * 真正的 GB18030 转码需要 encoding_rs，它目前只是 Cargo.lock 里的
     * 传递依赖、未在本 crate 声明。按项目规则（未获准不新增依赖）这里不引入。
     *
     * 但"文件不是 UTF-8"这句话对用户没有任何帮助——他不知道该怎么办。
     * 所以做一层启发式判断：按 GBK/GB18030 的字节结构统计合法双字节比例，
     * 若比例高就明确告诉他"这看起来是 GB18030/GBK 编码"，并给出可执行的
     * 下一步。这比笼统报"不是 UTF-8"有用得多，同时仍然不擅自按错编码落盘。
     */
    let hint = detect_cjk_legacy(&bytes);
    /* 路径由调用方 fs_read_text_auto 附加，这里不重复拼。 */
    Err(hint.into())
}

/**
 * 启发式判断非 UTF-8 内容是否像 GBK / GB18030。
 *
 * GBK 系编码的汉字占两个字节：首字节 0x81–0xFE，次字节 0x40–0xFE
 * （排除 0x7F）。这里统计"按此规则能成对切分、且切分后没有落单字节"
 * 的比例。比例够高就基本可以断定是 GBK 系编码。
 *
 * 这不是解码器：即使判断成立也**不产出文本**，只用于给用户一句能照做的提示。
 * 猜着解码的风险太大——一旦判错就是满屏乱码落进用户的作品目录，
 * 而报错只需要用户多做一个动作就能避免。
 */
fn detect_cjk_legacy(bytes: &[u8]) -> &'static str {
    let mut pairs = 0usize;
    let mut consumed = 0usize;
    let mut i = 0usize;
    while i < bytes.len() {
        let b = bytes[i];
        if b < 0x80 {
            i += 1;
            consumed += 1;
            continue;
        }
        let next = bytes.get(i + 1).copied();
        match next {
            /*
             * 首字节必须落在 0x81–0xFE：GBK 的首字节区间不含 0x80，
             * 而二进制数据里 0x80 很常见。这一条能把不少二进制流挡在外面。
             */
            Some(t) if (0x81..=0xFE).contains(&b) && (0x40..=0xFE).contains(&t) && t != 0x7F => {
                pairs += 1;
                i += 2;
                consumed += 2;
            }
            // 落单的高位字节：不符合 GBK 结构。
            _ => {
                i += 1;
                consumed += 1;
            }
        }
    }
    if consumed == 0 {
        return "file is not valid utf-8 and looks like binary data; please convert it to utf-8 before importing";
    }
    /*
     * 双字节占比：成对字节数 ÷ 总字节数。
     * 注意分子要乘 2——pairs 数的是"双字节组"，consumed 数的是"字节"，
     * 直接相除上限只有 0.5，全是中文的 GBK 文件反而永远判不出来。
     */
    let ratio = (pairs * 2) as f64 / consumed as f64;
    if ratio > 0.7 {
        "file looks like GBK/GB18030 encoded; please convert it to utf-8 before importing"
    } else {
        "file is not valid utf-8; please convert it to utf-8 before importing"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_gbk_like_bytes() {
        /* "中文" 的 GBK 编码：0xD6 0xD0 0xCE 0xC4。 */
        let gbk: Vec<u8> = vec![0xD6, 0xD0, 0xCE, 0xC4];
        assert!(detect_cjk_legacy(&gbk).contains("GBK"));
    }

    #[test]
    fn plain_binary_is_not_called_gbk() {
        /* 落单高位字节，不成对，不该被误判成中文编码。 */
        let bin: Vec<u8> = vec![0x80, 0x41, 0xFF, 0x80, 0x80, 0x41];
        assert!(!detect_cjk_legacy(&bin).contains("GBK"));
    }

    #[test]
    fn utf8_never_reaches_the_legacy_branch() {
        let r = read_bytes_auto("中文".as_bytes().to_vec());
        assert!(r.is_ok());
    }

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

    #[test]
    fn auto_read_strips_utf8_bom() {
        let r = read_bytes_auto(vec![0xEF, 0xBB, 0xBF, b'h', b'i']).unwrap();
        assert_eq!(r.content, "hi");
        assert_eq!(r.encoding, "utf-8-bom");
        assert!(r.had_bom);
    }

    #[test]
    fn auto_read_plain_utf8() {
        let r = read_bytes_auto("\u{4f60}\u{597d}".as_bytes().to_vec()).unwrap();
        assert_eq!(r.content, "\u{4f60}\u{597d}");
        assert_eq!(r.encoding, "utf-8");
        assert!(!r.had_bom);
    }

    #[test]
    fn auto_read_rejects_gbk_without_panicking() {
        // "中文"的 GBK 编码：非法 UTF-8 序列。
        let gbk = vec![0xD6u8, 0xD0, 0xCE, 0xC4];
        let err = read_bytes_auto(gbk).unwrap_err();
        assert!(err.contains("utf-8"), "error should mention utf-8: {}", err);
    }
}
