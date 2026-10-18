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

/**
 * 保存章：同时落盘 json 与 txt 视图（原子替换）。
 *
 * 返回落盘后的完整章对象（含新压入的 history）——历史快照是保存动作的
 * 副产物，调用方要拿回最新的 history 才能刷新版本列表界面。
 */
export async function saveChapter(
  root: string,
  workId: string,
  chapter: Chapter,
  /**
   * 是否为正文改动而留快照。
   *
   * 删除某个历史版本这类**只改元数据**的保存不该留快照：正文一个字没动，
   * 却会凭空多出一个和当前正文重复的版本，把历史列表越撑越脏。
   * 只有正文真的变了才值得留档。
   */
  snapshot = true
): Promise<Chapter> {
  const fs2 = createFs(root);
  const now = Date.now();
  /*
   * 快照策略：每次保存把**保存前**的正文压入 history，再写新正文。
   * 这样任何一次保存都能退回去，包括"误删了一段"之后的下一次自动保存。
   * 上限由 HISTORY_LIMIT 控制，防止长章反复保存把章文件撑到不可接受的大小。
   */
  const history = [...(chapter.history ?? [])];
  const meaningful = chapter.cards.some((c) => c.text.trim());
  if (snapshot && meaningful && !sameCards(history[history.length - 1]?.cards, chapter.cards)) {
    history.push({ at: now, savedAt: chapter.updatedAt, cards: chapter.cards });
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
  }
  const validated = chapterSchema.parse({ ...chapter, history, updatedAt: now });
  const jsonFile = chapterFile(workId, validated.id);
  await fs2.writeText(jsonFile, JSON.stringify(validated, null, 2));
  await fs2.writeText(chapterTextFile(workId, validated.id), cardsToText(validated.cards));
  log.debug("chapter saved", { id: validated.id, cards: validated.cards.length });
  return validated;
}

/** 卡片数组是否逐字段相同（快照去重靠它，避免无改动的保存堆出一串空版本）。 */
function sameCards(a: Card[] | undefined, b: Card[]): boolean {
  if (!a) return false;
  if (a.length !== b.length) return false;
  return a.every((c, i) => c.id === b[i].id && c.text === b[i].text);
}

/**
 * 历史快照上限。
 *
 * 每份快照是整章 cards 的完整拷贝。20 份对一部长篇的单章来说体积可接受，
 * 再多会让每次保存都重写越来越大的 JSON，得不偿失——超出后丢最旧的。
 */
const HISTORY_LIMIT = 20;

/** 可回滚的历史时间点：最新在前。 */
export interface HistoryEntry {
  index: number;
  at: number;
  savedAt: number;
  words: number;
  preview: string;
  /**
   * 预览用的分段文本，通常取前两段。
   *
   * 原先只给 `slice(0, 40)` 的单行前缀，长章的前 40 字常常挤在同一段里，
   * 看不出这一版到底写了什么。分段预览能看出结构，也便于界面上折行展示。
   */
  paragraphs: string[];
  /** 段落总数，用于在界面上补"共 N 段"。 */
  cardCount: number;
}

/** 列出可回滚的历史，供界面展示。当前正文作为固定的第一项。 */
export function listHistory(chapter: Chapter): HistoryEntry[] {
  const toEntry = (index: number, cards: Card[], at: number): HistoryEntry => {
    const texts = cards.map((c) => c.text.trim()).filter(Boolean);
    return {
      index,
      at,
      savedAt: at,
      words: countWords(cardsToText(cards)),
      preview: texts[0]?.slice(0, 40) ?? "",
      paragraphs: texts.slice(0, 2),
      cardCount: cards.length,
    };
  };
  /*
   * 第一项是"当前正文"，用 index -1 表示"不是历史、不可删除"。
   *
   * 把它和历史并列显示，用户才能一眼看出"我现在在第几版、
   * 往前还有几版可回"。若只列历史，就无法回答"现在这版是什么时候的"。
   */
  const current = toEntry(-1, chapter.cards, chapter.updatedAt);
  const past = [...(chapter.history ?? [])]
    .map((h, i) => toEntry(i, h.cards, h.at))
    .reverse();
  return [current, ...past];
}

/**
 * 删除某个历史快照。
 *
 * 快照占章文件的体积，上限 20 份之外还会被静默挤出。删除单个快照的价值在于
 * **用户主动清掉不想要的版本**（比如推翻重写时把那 19 版草稿都丢掉），
 * 否则淘汰 oldest 的策略替他做决定。
 *
 * `index === -1` 表示当前正文，不可删——删掉它等于清空本章。
 */
export function dropHistory(chapter: Chapter, index: number): Chapter {
  const history = chapter.history ?? [];
  if (index < 0 || index >= history.length) return chapter;
  const next = history.filter((_, i) => i !== index);
  return chapterSchema.parse({ ...chapter, history: next, updatedAt: Date.now() });
}

/**
 * 回滚到某个历史快照。
 *
 * 当前正文也会被压入 history 再切换，所以"回滚"本身同样可撤销——
 * 误点了回滚还能再滚回来。
 */
export function rollbackTo(chapter: Chapter, index: number): Chapter {
  const history = chapter.history ?? [];
  const target = history[index];
  if (!target) return chapter;
  const nextHistory = [...history];
  nextHistory.push({
    at: Date.now(),
    savedAt: chapter.updatedAt,
    cards: chapter.cards,
  });
  if (nextHistory.length > HISTORY_LIMIT) nextHistory.splice(0, nextHistory.length - HISTORY_LIMIT);
  return chapterSchema.parse({
    ...chapter,
    cards: target.cards,
    history: nextHistory,
    updatedAt: Date.now(),
  });
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

/**
 * 批量读取章的轻量元信息：标题、更新时间、字数。
 *
 * 结构树里只有节点的 updatedAt（结构操作时更新），不反映正文何时写过；
 * 侧栏卡片要显示"最近更新时间"和字数，只能从章文件取。这里一次性读完，
 * 换来的是列表渲染时零 IO。
 */
export async function loadChapterMetas(
  root: string,
  workId: string
): Promise<Record<string, ChapterMeta>> {
  const fs2 = createFs(root);
  const out: Record<string, ChapterMeta> = {};
  let files: string[];
  try {
    files = await fs2.readDir(joinRel("works", workId, "chapters"));
  } catch {
    return out;
  }
  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = chapterSchema.safeParse(
        JSON.parse(await fs2.readText(joinRel("works", workId, "chapters", name)))
      );
      if (!parsed.success) continue;
      out[parsed.data.id] = {
        title: parsed.data.title,
        updatedAt: parsed.data.updatedAt,
        words: chapterWords(parsed.data),
      };
    } catch (err) {
      log.warn("chapter meta: unreadable", name, err);
    }
  }
  return out;
}

export interface ChapterMeta {
  title: string;
  updatedAt: number;
  words: number;
}

/** 仅取 id 的小工具（避免上面把参数名写错）。 */
