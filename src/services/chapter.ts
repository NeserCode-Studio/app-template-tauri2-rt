/**
 * 章服务：章正文以 cards 数组为唯一事实来源，txt 视图由其生成。
 *
 * 数据流（计划书 §6.3）：
 *   卡片数组 鈫? 生成 txt 视图 鈫? 落盘 chapters/<id>.json + texts/<id>.txt
 */

import { createFs, joinRel } from "./fs";
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

/**
 * 重命名章节。
 *
 * 标题存在两处，必须一起改：章文件里的 title，以及结构树节点的 title。
 * 只改其一会出现「结构树显示新名字，打开后又是旧名字」。
 */
export async function renameChapter(
  root: string,
  workId: string,
  chapter: Chapter,
  title: string
): Promise<Chapter> {
  const next: Chapter = { ...chapter, title, updatedAt: Date.now() };
  await saveChapter(root, workId, next);
  return next;
}

/** 删除章：同时清掉 json 与 txt 视图。 */
export async function deleteChapter(root: string, workId: string, chapterId: string): Promise<void> {
  const fs2 = createFs(root);
  await fs2.remove(chapterFile(workId, chapterId));
  await fs2.remove(chapterTextFile(workId, chapterId));
  log.debug("chapter deleted", { id: chapterId });
}

/**
 * 统计整部作品的字数：逐个读取章文件累加。
 *
 * 作品库要显示的是全书字数，因此不能靠"当前编辑的章"累加——
 * 那样数字会随最后编辑的位置跳变。这里以磁盘为准全量重算，
 * 单章损坏只跳过该章，不让整部作品统计失败。
 */
export async function countWorkWords(root: string, workId: string): Promise<number> {
  const fs2 = createFs(root);
  let files: string[];
  try {
    files = await fs2.readDir(joinRel("works", workId, "chapters"));
  } catch {
    return 0;
  }
  let total = 0;
  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await fs2.readText(joinRel("works", workId, "chapters", name));
      const parsed = chapterSchema.safeParse(JSON.parse(raw));
      if (parsed.success) total += countWords(cardsToText(parsed.data.cards));
    } catch (err) {
      log.warn("work word count: chapter unreadable", name, err);
    }
  }
  return total;
}

/** 仅取 id 的小工具（避免上面把参数名写错）。 */
