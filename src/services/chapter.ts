/**
 * 章服务：章正文以 cards 数组为唯一事实来源，txt 视图由其生成。
 *
 * 数据流（计划书 §6.3）：
 *   卡片数组 鈫? 生成 txt 视图 鈫? 落盘 chapters/<id>.json + texts/<id>.txt
 */

import { createFs, joinRel } from "./fs";
import {
  chapterFile,
  chapterIndexFile,
  chapterTextFile,
  zhuqueDetectionFile,
} from "./paths";
import {
  cardSchema,
  chapterIndexSchema,
  chapterSchema,
  type Chapter,
  type Card,
  type ChapterMeta,
} from "@/shared/schema";
import { createLogger } from "@/lib/logger";
import { paragraphsFromText } from "@/lib/chinese-paragraphs";
import { AppError, RevisionConflictError } from "@/application/errors";

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

export type { ChapterMeta } from "@/shared/schema";

export interface ChapterMetaLoadProgress {
  phase: "scan" | "write";
  done: number;
  total: number;
  chapterId?: string;
  title?: string;
}

interface ChapterMetaLoadEntry {
  force: boolean;
  listeners: Set<(progress: ChapterMetaLoadProgress) => void>;
  promise: Promise<Record<string, ChapterMeta>>;
}

const chapterMetaLoads = new Map<string, ChapterMetaLoadEntry>();

function chapterMetaLoadKey(root: string, workId: string): string {
  return `${root}\u0000${workId}`;
}

async function readChapterIndex(
  root: string,
  workId: string
): Promise<Record<string, ChapterMeta> | null> {
  const fs2 = createFs(root);
  const file = chapterIndexFile(workId);
  if (!(await fs2.exists(file))) return null;
  try {
    return chapterIndexSchema.parse(JSON.parse(await fs2.readText(file)))
      .chapters;
  } catch (err) {
    log.warn("chapter index unreadable, rebuilding", { workId, err });
    return null;
  }
}

async function writeChapterIndex(
  root: string,
  workId: string,
  chapters: Record<string, ChapterMeta>
): Promise<void> {
  const fs2 = createFs(root);
  const index = chapterIndexSchema.parse({ chapters });
  await fs2.writeText(chapterIndexFile(workId), JSON.stringify(index, null, 2));
}

async function updateChapterIndexEntry(
  root: string,
  workId: string,
  meta: ChapterMeta & { id: string }
): Promise<void> {
  const chapters = await readChapterIndex(root, workId);
  if (!chapters) return;
  chapters[meta.id] = {
    title: meta.title,
    updatedAt: meta.updatedAt,
    words: meta.words,
  };
  await writeChapterIndex(root, workId, chapters);
}

/** 从索引中移除若干章；批量删除结构时避免下次打开触发全量重建。 */
export async function removeChapterIndexEntries(
  root: string,
  workId: string,
  chapterIds: string[]
): Promise<void> {
  if (!chapterIds.length) return;
  const chapters = await readChapterIndex(root, workId);
  if (!chapters) return;
  let changed = false;
  for (const chapterId of chapterIds) {
    if (chapters[chapterId]) {
      delete chapters[chapterId];
      changed = true;
    }
  }
  if (changed) await writeChapterIndex(root, workId, chapters);
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
export async function loadChapter(
  root: string,
  workId: string,
  chapterId: string
): Promise<Chapter | null> {
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
  snapshot = true,
  /** 批量导入时先跳过逐章索引更新，结束后统一重建，避免 O(n²) 写盘。 */
  updateIndex = true,
  /**
   * 调用方读取时的 revision。
   *
   * UI 自动保存可以省略；MCP 等外部写入必须提供。校验基于磁盘当前值，
   * 而不是调用方对象，否则两个并发保存会各自从旧 revision 加一。
   */
  expectedRevision?: number
): Promise<Chapter> {
  const startedAt = performance.now();
  const fs2 = createFs(root);
  const now = Date.now();
  const jsonFile = chapterFile(workId, chapter.id);
  let currentRevision = chapter.revision;
  if (await fs2.exists(jsonFile)) {
    try {
      const current = chapterSchema.parse(
        JSON.parse(await fs2.readText(jsonFile))
      );
      currentRevision = current.revision;
      if (
        expectedRevision !== undefined &&
        currentRevision !== expectedRevision
      ) {
        throw new RevisionConflictError(currentRevision, current.updatedAt);
      }
    } catch (err) {
      if (err instanceof RevisionConflictError) throw err;
      log.error("chapter revision check failed", chapter.id, err);
      if (expectedRevision !== undefined) {
        throw new AppError(
          "operation_failed",
          "The current chapter file could not be read, so the write was not applied.",
          { chapterId: chapter.id }
        );
      }
    }
  } else if (
    expectedRevision !== undefined &&
    expectedRevision !== currentRevision
  ) {
    throw new RevisionConflictError(currentRevision, chapter.updatedAt);
  }
  /*
   * 快照策略：每次保存把**保存前**的正文压入 history，再写新正文。
   * 这样任何一次保存都能退回去，包括"误删了一段"之后的下一次自动保存。
   * 上限由 HISTORY_LIMIT 控制，防止长章反复保存把章文件撑到不可接受的大小。
   */
  const history = [...(chapter.history ?? [])];
  const meaningful = chapter.cards.some((c) => c.text.trim());
  if (
    snapshot &&
    meaningful &&
    !sameCards(history[history.length - 1]?.cards, chapter.cards)
  ) {
    history.push({ at: now, savedAt: chapter.updatedAt, cards: chapter.cards });
    if (history.length > HISTORY_LIMIT)
      history.splice(0, history.length - HISTORY_LIMIT);
  }
  const validated = chapterSchema.parse({
    ...chapter,
    history,
    revision: currentRevision + 1,
    updatedAt: now,
  });
  const preparedAt = performance.now();
  const json = JSON.stringify(validated, null, 2);
  const text = cardsToText(validated.cards);
  const serializedAt = performance.now();
  await fs2.writeText(jsonFile, json);
  const jsonWrittenAt = performance.now();
  await fs2.writeText(chapterTextFile(workId, validated.id), text);
  const textWrittenAt = performance.now();
  if (updateIndex) {
    try {
      await updateChapterIndexEntry(root, workId, {
        id: validated.id,
        title: validated.title,
        updatedAt: validated.updatedAt,
        words: countWords(text),
      });
    } catch (err) {
      log.warn("chapter index update failed", {
        workId,
        chapterId: validated.id,
        err,
      });
    }
  }
  const indexUpdatedAt = performance.now();
  log.info("chapter files written", {
    id: validated.id,
    cards: validated.cards.length,
    jsonBytes: json.length,
    textChars: text.length,
    prepareMs: Math.round(preparedAt - startedAt),
    serializeMs: Math.round(serializedAt - preparedAt),
    jsonWriteMs: Math.round(jsonWrittenAt - serializedAt),
    textWriteMs: Math.round(textWrittenAt - jsonWrittenAt),
    indexUpdateMs: Math.round(indexUpdatedAt - textWrittenAt),
    totalMs: Math.round(indexUpdatedAt - startedAt),
  });
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
 * 取某个版本的完整正文（预览用）。
 *
 * 列表里的两段预览只能让人大致认出"是这一版"，无法确认内容是不是要的。
 * 真正决定回不回滚要看全文，所以这里单独取——不在 HistoryEntry 里塞全文，
 * 20 个版本各带一份正文会让列表渲染白白多出几十 KB 字符串。
 *
 * `index === -1` 取当前正文。
 */
export function historyText(chapter: Chapter, index: number): string[] {
  const cards =
    index < 0 ? chapter.cards : (chapter.history ?? [])[index]?.cards;
  if (!cards) return [];
  return cards.map((c) => c.text.trim()).filter(Boolean);
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
  return chapterSchema.parse({
    ...chapter,
    history: next,
    updatedAt: Date.now(),
  });
}

/**
 * 回滚到某个历史快照。
 *
 * 语义是**消费**掉目标版本：它变成了当前正文，就不该同时还挂在历史里，
 * 否则同一个内容在列表里出现两次（一次作为历史、一次作为当前）。
 * 与此同时把回滚前的正文压入 history，所以"回滚"本身同样可撤销——
 * 误点了还能再滚回来，且回滚前后历史条目总数不变。
 */
export function rollbackTo(chapter: Chapter, index: number): Chapter {
  const history = chapter.history ?? [];
  const target = history[index];
  if (!target) return chapter;
  /* 目标版本被消费掉，取出后不再保留在历史里。 */
  const nextHistory = history.filter((_, i) => i !== index);
  /* 已经在这一版上（内容相同）则无需存档，否则历史会塞满重复条目。 */
  if (!sameCards(chapter.cards, target.cards)) {
    nextHistory.push({
      at: Date.now(),
      savedAt: chapter.updatedAt,
      cards: chapter.cards,
    });
  }
  if (nextHistory.length > HISTORY_LIMIT)
    nextHistory.splice(0, nextHistory.length - HISTORY_LIMIT);
  return chapterSchema.parse({
    ...chapter,
    cards: target.cards,
    history: nextHistory,
    updatedAt: Date.now(),
  });
}

/** 新建并保存空章。 */
export async function createChapter(
  root: string,
  workId: string,
  title: string
): Promise<Chapter> {
  const chapter = emptyChapter(crypto.randomUUID(), title);
  return saveChapter(root, workId, chapter);
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
  return saveChapter(root, workId, next);
}

export interface ReparagraphProgress {
  done: number;
  total: number;
  chapterId: string;
  title: string;
}

export interface ReparagraphReport {
  chapters: number;
  changedChapters: number;
  cardsBefore: number;
  cardsAfter: number;
}

/**
 * 重新整理整部作品的段落。
 *
 * 以现有卡片为边界逐张处理：短段原样保留，长段和硬换行重新组织。
 * 因此这个动作不会把用户已经分开的相邻段落重新粘在一起；真正改动的
 * 章会通过 saveChapter 留下正文快照，可在历史版本里回滚。
 */
export async function reparagraphWork(
  root: string,
  workId: string,
  onProgress?: (progress: ReparagraphProgress) => void
): Promise<ReparagraphReport> {
  const fs2 = createFs(root);
  const dir = joinRel("works", workId, "chapters");
  const files = (await fs2.readDir(dir))
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

  const report: ReparagraphReport = {
    chapters: 0,
    changedChapters: 0,
    cardsBefore: 0,
    cardsAfter: 0,
  };

  for (let index = 0; index < files.length; index += 1) {
    const name = files[index];
    let chapterTitle = name;
    try {
      const parsed = chapterSchema.safeParse(
        JSON.parse(await fs2.readText(joinRel(dir, name)))
      );
      if (!parsed.success) {
        log.warn("reparagraph: chapter unreadable", name);
        onProgress?.({
          done: index + 1,
          total: files.length,
          chapterId: name.slice(0, -".json".length),
          title: chapterTitle,
        });
        continue;
      }
      const chapter = parsed.data;
      chapterTitle = chapter.title;
      report.chapters += 1;
      report.cardsBefore += chapter.cards.length;

      const cards = chapter.cards.flatMap((card) => {
        if (!card.text.trim()) return [card];
        const paragraphs = paragraphsFromText(card.text);
        if (!paragraphs.length) return [card];
        return paragraphs.map((text, paragraphIndex) =>
          paragraphIndex === 0
            ? { ...card, text }
            : cardSchema.parse({
                id: crypto.randomUUID(),
                text,
                createdAt: card.createdAt + paragraphIndex,
                updatedAt: card.updatedAt + paragraphIndex,
              })
        );
      });
      report.cardsAfter += cards.length;

      if (!sameCards(chapter.cards, cards)) {
        await saveChapter(root, workId, { ...chapter, cards }, true, false);
        report.changedChapters += 1;
      }
    } catch (err) {
      log.warn("reparagraph: chapter failed", name, err);
    }

    onProgress?.({
      done: index + 1,
      total: files.length,
      chapterId: name.slice(0, -".json".length),
      title: chapterTitle,
    });
  }

  await loadChapterMetas(
    root,
    workId,
    (progress) => {
      onProgress?.({
        done: progress.done,
        total: progress.total,
        chapterId: progress.chapterId ?? "",
        title: progress.title ?? "",
      });
    },
    true
  );
  log.info("work reparagraphed", { workId, ...report });
  return report;
}

/** 删除章：同时清掉 json 与 txt 视图。 */
export async function deleteChapter(
  root: string,
  workId: string,
  chapterId: string
): Promise<void> {
  const fs2 = createFs(root);
  await fs2.remove(chapterFile(workId, chapterId));
  await fs2.remove(chapterTextFile(workId, chapterId));
  await fs2.remove(zhuqueDetectionFile(workId, chapterId));
  await removeChapterIndexEntries(root, workId, [chapterId]);
  log.debug("chapter deleted", { id: chapterId });
}

/** 统计整部作品的字数：从章节索引读取轻量元信息后累加。 */
export async function countWorkWords(
  root: string,
  workId: string,
  onProgress?: (progress: ChapterMetaLoadProgress) => void
): Promise<number> {
  const startedAt = performance.now();
  const chapters = await loadChapterMetas(root, workId, onProgress);
  const total = Object.values(chapters).reduce(
    (sum, chapter) => sum + chapter.words,
    0
  );
  log.info("work words counted", {
    workId,
    chapters: Object.keys(chapters).length,
    total,
    ms: Math.round(performance.now() - startedAt),
  });
  return total;
}

/**
 * 批量读取章的轻量元信息：标题、更新时间、字数。
 *
 * 结构树里只有节点的 updatedAt（结构操作时更新），不反映正文何时写过；
 * 侧栏卡片要显示"最近更新时间"和字数，只能从章文件取。这里一次性读完，
 * 换来的是列表渲染时零 IO。
 */
async function loadChapterMetasUncached(
  root: string,
  workId: string,
  onProgress?: (progress: ChapterMetaLoadProgress) => void,
  force = false
): Promise<Record<string, ChapterMeta>> {
  const startedAt = performance.now();
  const fs2 = createFs(root);
  let files: string[];
  try {
    files = await fs2.readDir(joinRel("works", workId, "chapters"));
  } catch {
    return {};
  }
  const jsonFiles = files
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const diskIds = jsonFiles.map((name) => name.slice(0, -".json".length));
  const cached = await readChapterIndex(root, workId);
  if (
    !force &&
    cached &&
    Object.keys(cached).length === diskIds.length &&
    diskIds.every((id) => Boolean(cached[id]))
  ) {
    log.info("chapter index hit", {
      workId,
      chapters: diskIds.length,
      ms: Math.round(performance.now() - startedAt),
    });
    return cached;
  }

  const out: Record<string, ChapterMeta> = {};
  onProgress?.({
    phase: "scan",
    done: 0,
    total: jsonFiles.length,
  });
  for (let index = 0; index < jsonFiles.length; index += 1) {
    const name = jsonFiles[index];
    try {
      const parsed = chapterSchema.safeParse(
        JSON.parse(
          await fs2.readText(joinRel("works", workId, "chapters", name))
        )
      );
      if (!parsed.success) {
        log.warn("chapter meta: invalid", name);
        onProgress?.({
          phase: "scan",
          done: index + 1,
          total: jsonFiles.length,
          chapterId: name.slice(0, -".json".length),
        });
        continue;
      }
      out[parsed.data.id] = {
        title: parsed.data.title,
        updatedAt: parsed.data.updatedAt,
        words: chapterWords(parsed.data),
      };
      onProgress?.({
        phase: "scan",
        done: index + 1,
        total: jsonFiles.length,
        chapterId: parsed.data.id,
        title: parsed.data.title,
      });
    } catch (err) {
      log.warn("chapter meta: unreadable", name, err);
      onProgress?.({
        phase: "scan",
        done: index + 1,
        total: jsonFiles.length,
        chapterId: name.slice(0, -".json".length),
      });
    }
  }
  onProgress?.({
    phase: "write",
    done: jsonFiles.length,
    total: jsonFiles.length,
  });
  await writeChapterIndex(root, workId, out);
  log.info("chapter metas loaded", {
    workId,
    files: jsonFiles.length,
    readable: Object.keys(out).length,
    indexed: true,
    ms: Math.round(performance.now() - startedAt),
  });
  return out;
}

export async function loadChapterMetas(
  root: string,
  workId: string,
  onProgress?: (progress: ChapterMetaLoadProgress) => void,
  force = false
): Promise<Record<string, ChapterMeta>> {
  const key = chapterMetaLoadKey(root, workId);
  for (;;) {
    const active = chapterMetaLoads.get(key);
    if (active) {
      if (onProgress) active.listeners.add(onProgress);
      if (!force || active.force) return active.promise;
      await active.promise.catch(() => undefined);
      continue;
    }

    const entry: ChapterMetaLoadEntry = {
      force,
      listeners: new Set(onProgress ? [onProgress] : []),
      promise: Promise.resolve({}),
    };
    entry.promise = loadChapterMetasUncached(
      root,
      workId,
      (progress) => {
        for (const listener of entry.listeners) {
          try {
            listener(progress);
          } catch (err) {
            log.warn("chapter meta progress listener failed", err);
          }
        }
      },
      force
    ).finally(() => {
      if (chapterMetaLoads.get(key) === entry) {
        chapterMetaLoads.delete(key);
      }
    });
    chapterMetaLoads.set(key, entry);
    return entry.promise;
  }
}

/** 只读取一章的轻量元信息；保存后用它替代整部作品的元信息重扫。 */
export async function loadChapterMeta(
  root: string,
  workId: string,
  chapterId: string
): Promise<ChapterMeta | null> {
  const startedAt = performance.now();
  const fs2 = createFs(root);
  try {
    const parsed = chapterSchema.safeParse(
      JSON.parse(await fs2.readText(chapterFile(workId, chapterId)))
    );
    if (!parsed.success) {
      log.warn("chapter meta: invalid", chapterId);
      return null;
    }
    const meta = {
      title: parsed.data.title,
      updatedAt: parsed.data.updatedAt,
      words: chapterWords(parsed.data),
    };
    log.info("chapter meta loaded", {
      workId,
      chapterId,
      ms: Math.round(performance.now() - startedAt),
    });
    return meta;
  } catch (err) {
    log.warn("chapter meta: unreadable", chapterId, err);
    return null;
  }
}

/** 仅取 id 的小工具（避免上面把参数名写错）。 */
