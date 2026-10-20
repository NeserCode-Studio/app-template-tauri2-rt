/**
 * 导入既有文稿：把外部 txt / md 拆成卡片写进某一章。
 *
 * 编码探测放在 Rust 侧（`fs_read_text_auto`）：JS 侧无 BOM 解码
 * GBK 需要整张映射表，自实现既容易错也不可能比 Rust 侧快。
 *
 * txt 与 md 的段落语义不同：txt 优先按空行分段、无空行时退回逐行；
 * md 的标题单独成卡，其余按空行分段，并保留段内显式换行。
 */

import { invoke } from "@tauri-apps/api/core";

import { cardSchema, type Card } from "@/shared/schema";
import { saveChapter } from "./chapter";
import { createLogger } from "@/lib/logger";
import type { Chapter } from "@/shared/schema";

const log = createLogger("ImportService");

/**
 * 把解析出的卡片追加进指定章并落盘。
 *
 * 追加而非覆盖：导入是"把外部稿子并进来"，用户已有的卡片不该被冲掉。
 * 想要替换全文时，用户可以先删空再导入。
 */
export async function appendCardsToChapter(
  root: string,
  workId: string,
  chapter: Chapter,
  cards: Card[]
): Promise<Chapter> {
  const next: Chapter = { ...chapter, cards: [...chapter.cards, ...cards] };
  await saveChapter(root, workId, next);
  log.info("imported cards", { chapterId: chapter.id, added: cards.length });
  return next;
}

export interface AutoReadResult {
  content: string;
  /** `utf-8` / `utf-8-bom` / `gb18030`。 */
  encoding: string;
  hadBom: boolean;
}

/** 读取文本并探测编码。 */
export async function readTextAuto(path: string): Promise<AutoReadResult> {
  return invoke<AutoReadResult>("fs_read_text_auto", { path });
}

/**
 * 可导入格式。doc / docx / rtf 不做伪支持：拿不到结构化正文时明确拒绝，
 * 比把乱码写进作品目录更安全。
 */
export type ImportFormat = "txt" | "md";

export class ImportFileError extends Error {
  constructor(
    public readonly code: "unsupported" | "empty",
    public readonly detail?: string
  ) {
    super(code);
    this.name = "ImportFileError";
  }
}

/** 文件路径最后一段，兼容 Windows 与 Unix 路径。 */
export function importFileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** 从文件名生成新作品标题，去掉扩展名并清理首尾空白。 */
export function importTitleFromPath(path: string): string {
  const fileName = importFileName(path);
  const dot = fileName.lastIndexOf(".");
  return (dot > 0 ? fileName.slice(0, dot) : fileName).trim();
}

function importFormat(path: string): ImportFormat {
  const fileName = importFileName(path);
  const dot = fileName.lastIndexOf(".");
  const extension = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
  if (extension === "txt" || extension === "md") return extension;
  throw new ImportFileError("unsupported", extension || fileName);
}

function cardsFromBlocks(blocks: string[]): Card[] {
  const now = Date.now();
  return blocks
    .map((block) => block.trim())
    .filter(Boolean)
    .map((p, i) =>
      cardSchema.parse({
        id: crypto.randomUUID(),
        text: p,
        createdAt: now + i,
        updatedAt: now + i,
      })
    );
}

function normalizeLines(text: string): string[] {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
}

function txtBlocks(text: string): string[] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const paragraphs = normalized.split(/\n[ \t]*\n+/);
  /*
   * 没有任何空行时按单行切。中文 txt 常见的两种排版分别是
   * “一段一行”和“段落之间空行”，这个兜底比把整本书塞进一张卡可靠。
   */
  if (paragraphs.length === 1) {
    return normalized.split("\n");
  }
  return paragraphs;
}

/**
 * Markdown 只实现文稿导入需要的结构：
 * - ATX 标题独立成卡；
 * - 空行分段；
 * - 段内换行保留，避免硬换行或中文排版被静默吞掉。
 */
function markdownBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const block = current.join("\n").trim();
    if (block) blocks.push(block);
    current = [];
  };

  for (const rawLine of normalizeLines(text)) {
    const line = rawLine.trimEnd();
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flush();
      const title = heading[1]?.trim();
      if (title) blocks.push(title);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flush();
      continue;
    }
    current.push(line.trimStart());
  }
  flush();
  return blocks;
}

export interface ParsedImport {
  format: ImportFormat;
  cards: Card[];
}

/** 按扩展名选择切分规则；不支持的类型会抛出可本地化的错误码。 */
export function parseImportText(path: string, text: string): ParsedImport {
  const format = importFormat(path);
  const blocks = format === "md" ? markdownBlocks(text) : txtBlocks(text);
  const cards = cardsFromBlocks(blocks);
  if (!cards.length) throw new ImportFileError("empty");
  return { format, cards };
}

/**
 * 兼容旧调用：按 txt 规则把纯文本切成卡片。
 *
 * 新导入流程应使用 `parseImportText`，避免 Markdown 被套用 txt 规则。
 */
export function textToCards(text: string): Card[] {
  return cardsFromBlocks(txtBlocks(text));
}
