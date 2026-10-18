/**
 * 导入既有文稿：把外部 txt 拆成卡片写进某一章。
 *
 * 编码探测放在 Rust 侧（`fs_read_text_auto`）：JS 侧无 BOM 解码
 * GBK 需要整张映射表，自实现既容易错也不可能比 Rust 侧快。
 *
 * 切分规则：空行分段，其次按行。中文小说的段落几乎都用空行分隔，
 * 只按 `\n` 切会把排版换行误当成段落边界，正文被切得稀碎。
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
  /** `utf-8` / `utf-8-bom`；GBK 等需先转码，见 .agent/findings.md F6。 */
  encoding: string;
  hadBom: boolean;
}

/** 读取文本并探测编码。 */
export async function readTextAuto(path: string): Promise<AutoReadResult> {
  return invoke<AutoReadResult>("fs_read_text_auto", { path });
}

/**
 * 把纯文本切成段落卡片。
 *
 * 连续空行视为一个分隔（`\n\s*\n`），行尾空白与行首缩进去掉——
 * 源文件里的空格缩进不该原样变成正文内容。
 */
export function textToCards(text: string): Card[] {
  const now = Date.now();
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, "").trim())
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
