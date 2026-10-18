/**
 * 全站搜索：章标题 + 正文 + 素材条目。
 *
 * 性能取向（数据量按 500 章 x 3 万字 ≈ 1500 万字估算）：
 *
 * 1. 一次读盘、之后全内存。每次按键重读几十 MB 的 json 不可接受，
 *    索引在工作区切换时构建一次，之后搜索只扫内存。
 * 2. 单次线性扫描 + 提前退出。不建倒排索引：中文分词不可靠，
 *    而子串搜索在千万字级仍是几十毫秒（V8 的 indexOf 走 SIMD），
 *    为此建分词索引得不偿失。
 * 3. 命中数上限 + 单章截断。全文搜索的结果天然是"前若干条够用"，
 *    全量返回会让 UI 卡在渲染上；这里在数据层就截断。
 * 4. 正文懒读并缓存。索引只存"章 id + 标题"，命中正文时再读那一个文件，
 *    同一文件在一次搜索里只读一次。
 */

import { createFs, joinRel, type FsBridge } from "./fs";
import { chapterSchema, type Chapter } from "@/shared/schema";
import { chapterFile } from "./paths";
import type { CodexEntry } from "./codex";
import { createLogger } from "@/lib/logger";

const log = createLogger("SearchService");

/** 单次搜索返回的命中条数上限。 */
export const MAX_HITS = 200;
/** 上下文片段的单侧字符数。 */
const CONTEXT = 32;

export type SearchHitKind = "chapter" | "codex";

export interface SearchHit {
  kind: SearchHitKind;
  /** chapter 为章 id，codex 为条目 id。 */
  id: string;
  title: string;
  /** 作品 id；素材条目为空。 */
  workId: string;
  /** 作品标题；素材条目为空。 */
  workTitle: string;
  /** 命中的上下文片段。 */
  snippet: string;
  /** 该条目的总命中数（不受截断影响）。 */
  count: number;
  /** 素材条目的类型。 */
  type?: string;
}

interface IndexEntry {
  workId: string;
  workTitle: string;
  title: string;
}

/**
 * 搜索索引：章标题常驻内存，正文按需读并缓存。
 */
export class SearchIndex {
  /** 章 id → 元信息。 */
  private readonly chapters = new Map<string, IndexEntry>();
  /** 章 id → 正文缓存，避免同一次搜索重复读同一文件。 */
  private readonly bodies = new Map<string, string>();
  private codex: CodexEntry[] = [];

  /** 用结构树节点重建章条目（章节增删改后调用）。 */
  syncChapters(
    nodes: { id: string; title: string }[],
    workId: string,
    workTitle: string
  ): void {
    this.chapters.clear();
    this.bodies.clear();
    for (const n of nodes) {
      this.chapters.set(n.id, { workId, workTitle, title: n.title });
    }
  }

  /** 素材条目变化后替换。 */
  syncCodex(entries: CodexEntry[]): void {
    this.codex = entries;
  }

  /** 清空（切换工作区时调用）。 */
  clear(): void {
    this.chapters.clear();
    this.bodies.clear();
    this.codex = [];
  }

  /**
   * 执行搜索。
   *
   * 命中上限触发后立即返回：结果列表渲染成本与条数线性相关，
   * 让用户先看到前 200 条远比卡住等他滚完更可用。
   */
  async search(root: string, query: string): Promise<SearchHit[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const hits: SearchHit[] = [];

    /* ---- 素材条目：全量常驻，直接扫 ---- */
    for (const e of this.codex) {
      const hay = `${e.name}\n${e.aliases.join("\n")}\n${e.tags.join("\n")}\n${e.body}`;
      const lower = hay.toLowerCase();
      const at = lower.indexOf(q);
      if (at < 0) continue;
      hits.push({
        kind: "codex",
        id: e.id,
        title: e.name,
        workId: "",
        workTitle: "",
        snippet: snippet(hay, at, q.length),
        count: countOccurrences(lower, q),
        type: e.type,
      });
      if (hits.length >= MAX_HITS) return hits;
    }

    /* ---- 章节：标题常驻，正文按需读 ---- */
    const fs2 = createFs(root);
    for (const [chapterId, entry] of this.chapters) {
      let count = 0;
      let text = "";
      if (entry.title.toLowerCase().includes(q)) {
        count += 1;
        text = entry.title;
      }

      const body = await this.bodyOf(fs2, chapterId, entry.workId);
      const bodyLower = body.toLowerCase();
      const at = bodyLower.indexOf(q);
      if (at >= 0) {
        count += countOccurrences(bodyLower, q);
        if (!text) text = snippet(body, at, q.length);
      }
      if (!count) continue;

      hits.push({
        kind: "chapter",
        id: chapterId,
        title: entry.title,
        workId: entry.workId,
        workTitle: entry.workTitle,
        snippet: text,
        count,
      });
      if (hits.length >= MAX_HITS) break;
    }
    return hits;
  }

  /** 取章正文（进程内缓存）。 */
  private async bodyOf(fs2: FsBridge, chapterId: string, workId: string): Promise<string> {
    const cached = this.bodies.get(chapterId);
    if (cached !== undefined) return cached;
    let text = "";
    try {
      const file = chapterFile(workId, chapterId);
      if (await fs2.exists(file)) {
        const parsed = chapterSchema.safeParse(JSON.parse(await fs2.readText(file)));
        if (parsed.success) text = cardsText(parsed.data);
      }
    } catch (err) {
      log.warn("search: chapter unreadable", chapterId, err);
    }
    this.bodies.set(chapterId, text);
    return text;
  }
}

function cardsText(chapter: Chapter): string {
  return chapter.cards.map((c) => c.text).join("\n");
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    count += 1;
    /* 从命中末尾继续：允许查询词自身重叠（"aa" 命中 "aaa" 两次）。 */
    from = at + needle.length;
  }
  return count;
}

/** 截出命中处上下文，两端补省略号。 */
function snippet(text: string, at: number, len: number): string {
  const start = Math.max(0, at - CONTEXT);
  const end = Math.min(text.length, at + len + CONTEXT);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end).replace(/\n/g, " ") + suffix;
}

/**
 * 在磁盘上直接搜一部作品（不经索引）。
 *
 * 索引只覆盖当前打开的作品；这个函数用于跨作品搜索与索引失效时的兜底。
 */
export async function searchWork(
  root: string,
  workId: string,
  workTitle: string,
  query: string,
  maxHits: number
): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const fs2 = createFs(root);
  let files: string[];
  try {
    files = await fs2.readDir(joinRel("works", workId, "chapters"));
  } catch {
    return [];
  }
  const out: SearchHit[] = [];
  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = chapterSchema.safeParse(
        JSON.parse(await fs2.readText(joinRel("works", workId, "chapters", name)))
      );
      if (!parsed.success) continue;
      const text = cardsText(parsed.data);
      const lower = text.toLowerCase();
      const at = lower.indexOf(q);
      const titleHit = parsed.data.title.toLowerCase().includes(q);
      if (at < 0 && !titleHit) continue;
      out.push({
        kind: "chapter",
        id: parsed.data.id,
        title: parsed.data.title,
        workId,
        workTitle,
        snippet: at >= 0 ? snippet(text, at, q.length) : parsed.data.title,
        count: countOccurrences(lower, q) + (titleHit ? 1 : 0),
      });
      if (out.length >= maxHits) break;
    } catch (err) {
      log.warn("searchWork: chapter unreadable", name, err);
    }
  }
  return out;
}
