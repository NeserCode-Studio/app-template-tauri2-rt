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
import { saveOutline } from "./outline";
import { loadWorkspace, createWork } from "./workspace";
import { emptyChapter } from "./chapter";
import { outlineSchema } from "@/shared/schema";
import { createLogger } from "@/lib/logger";
import type { Chapter, Work } from "@/shared/schema";

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

/**
 * 把本地 txt 导入成一部新作品。
 *
 * 只建「首卷 → 一章」这一层骨架：外部 txt 是扁平文本，硬造多卷多章
 * 是在猜用户意图。真正的章节切分留给用户在编辑器里做。
 *
 * 章 id 必须同时用于章文件与结构树节点——两处 id 不一致的话，
 * 结构树点得开、正文却按另一个 id 去找文件，读出来是空章。
 */
export async function importTextAsWork(
  root: string,
  path: string,
  options: { title: string; volumeTitle: string; chapterTitle: string }
): Promise<{ work: Work; chapterId: string; cardCount: number }> {
  const read = await readTextAuto(path);
  const cards = textToCards(read.content);

  const ws = await loadWorkspace(root);
  const { ws: nextWs, work } = await createWork(root, ws, options.title, "");

  const now = Date.now();
  const volumeId = crypto.randomUUID();
  const chapterId = crypto.randomUUID();

  const chapter: Chapter = {
    ...emptyChapter(chapterId, options.chapterTitle),
    cards,
    createdAt: now,
    updatedAt: now,
  };
  await saveChapter(root, work.id, chapter);

  const outline = outlineSchema.parse({
    nodes: [
      {
        id: volumeId,
        type: "volume",
        title: options.volumeTitle,
        parentId: null,
        order: 0,
        status: "draft",
        synopsis: "",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: chapterId,
        type: "chapter",
        title: options.chapterTitle,
        parentId: volumeId,
        order: 0,
        status: "draft",
        synopsis: "",
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
  await saveOutline(root, work.id, outline);

  log.info("work imported", {
    workId: work.id,
    cards: cards.length,
    encoding: read.encoding,
  });
  /* nextWs 已由 createWork 落盘；这里只把 work 交给调用方去刷新清单。 */
  void nextWs;
  return { work, chapterId, cardCount: cards.length };
}
