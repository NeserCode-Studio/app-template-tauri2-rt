/**
 * 章服务：章正文以 cards 数组为唯一事实来源，txt 视图由其生成。
 *
 * 数据流（计划书 §6.3）：
 *   卡片数组 鈫? 生成 txt 视图 鈫? 落盘 chapters/<id>.json + texts/<id>.txt
 */

import { createFs } from "./fs";
import { chapterFile, chapterTextFile } from "./paths";
import { chapterSchema, type Chapter, type Card } from "@/shared/schema";
import { createLogger } from "@/lib/logger";

const log = createLogger("ChapterService");

/** 由 cards 生成纯文本：每张卡片一行，空卡也是一行。 */
export function cardsToText(cards: Card[]): string {
  return cards.map((c) => c.text).join("\n");
}

/** 字数统计：汉字与中文标点各计 1，连续英文/数字按词计 1（计划书 §3.2）。 */
export function countWords(text: string): number {
  let count = 0;
  let asciiRun = false;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const isCjk = code >= 0x4e00 && code <= 0x9fff;
    const isCjkPunct =
      (code >= 0x3000 && code <= 0x303f) || (code >= 0xff00 && code <= 0xffef);
    const isAsciiWord = /[A-Za-z0-9]/.test(ch);
    if (isCjk || isCjkPunct) {
      count += 1;
      asciiRun = false;
    } else if (isAsciiWord) {
      if (!asciiRun) {
        count += 1;
        asciiRun = true;
      }
    } else {
      asciiRun = false;
    }
  }
  return count;
}

export function chapterWords(chapter: Chapter): number {
  return countWords(cardsToText(chapter.cards));
}

/** 新建空章。 */
export function emptyChapter(id: string, title: string): Chapter {
  const now = Date.now();
  return chapterSchema.parse({
    id,
    title,
    cards: [],
    createdAt: now,
    updatedAt: now,
  });
}

/** 读取章；文件不存在时返回 null（懒加载场景）。 */
export async function loadChapter(root: string, workId: string, chapterId: string): Promise<Chapter | null> {
  const fs2 = createFs(root);
  const file = chapterFile(workId, chapterId);
  if (!(await fs2.exists(file))) return null;
  const raw = await fs2.readText(file);
  try {
    return chapterSchema.parse(JSON.parse(raw));
  } catch (err) {
    log.error("chapter parse failed", chapterId, err);
    return null;
  }
}

/** 保存章：同时落盘 json 与 txt 视图（原子替换）。 */
export async function saveChapter(root: string, workId: string, chapter: Chapter): Promise<void> {
  const fs2 = createFs(root);
  const validated = chapterSchema.parse({ ...chapter, updatedAt: Date.now() });
  const jsonFile = chapterFile(workId, validated.id);
  await fs2.writeText(jsonFile, JSON.stringify(validated, null, 2));
  await fs2.writeText(chapterTextFile(workId, validated.id), cardsToText(validated.cards));
  log.debug("chapter saved", { id: validated.id, cards: validated.cards.length });
}

/** 新建并保存空章。 */
export async function createChapter(root: string, workId: string, title: string): Promise<Chapter> {
  const chapter = emptyChapter(crypto.randomUUID(), title);
  await saveChapter(root, workId, chapter);
  return chapter;
}

/** 仅取 id 的小工具（避免上面把参数名写错）。 */
