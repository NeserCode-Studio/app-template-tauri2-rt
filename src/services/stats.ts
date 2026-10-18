/**
 * 统计服务：字数与写作日志，落盘为 stats.json。
 *
 * 提及索引在第一天就记录（成本几乎为零，计划书 §6.6），
 * 为 v2 增强导出预留反向索引能力。
 */

import { createFs } from "./fs";
import { statsFile } from "./paths";
import { statsSchema, type Stats, type MentionIndex } from "@/shared/schema";
import { createLogger } from "@/lib/logger";

const log = createLogger("StatsService");

export function emptyStats(): Stats {
  return statsSchema.parse({});
}

/** 读取统计；文件不存在或解析失败回退到空统计。 */
export async function loadStats(root: string, workId: string): Promise<Stats> {
  const fs2 = createFs(root);
  const file = statsFile(workId);
  if (!(await fs2.exists(file))) return emptyStats();
  try {
    return statsSchema.parse(JSON.parse(await fs2.readText(file)));
  } catch (err) {
    log.error("stats parse failed", workId, err);
    return emptyStats();
  }
}

/** 持久化统计。 */
export async function saveStats(root: string, workId: string, stats: Stats): Promise<void> {
  const fs2 = createFs(root);
  await fs2.writeText(statsFile(workId), JSON.stringify(statsSchema.parse(stats), null, 2));
}

/** 今天的日期串（本地时区 YYYY-MM-DD）。 */
export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 记录一次写作：更新今日字数、连续天数、作品字数。
 * @param delta 本次新增字数（可为负，表示删除）。
 */
export async function recordWrite(
  root: string,
  workId: string,
  workWords: number,
  delta: number
): Promise<Stats> {
  const stats = await loadStats(root, workId);
  const key = todayKey();

  const prevStreak = stats.streak;
  const prevDate = stats.lastWriteDate;
  let streak = stats.streak;
  if (prevDate !== key) {
    // 昨天写过则 +1，否则（包括首次）重置为 1。
    const yesterday = new Date(Date.now() - 86400000);
    streak = prevDate === todayKey(yesterday) ? prevStreak + 1 : 1;
  }

  const next: Stats = {
    ...stats,
    totalWords: Math.max(0, stats.totalWords + delta),
    todayWords: prevDate === key ? Math.max(0, stats.todayWords + delta) : Math.max(0, delta),
    streak,
    lastWriteDate: key,
    workWords: { ...stats.workWords, [workId]: workWords },
  };
  await saveStats(root, workId, next);
  return next;
}

/** 合并提及索引（提交卡片时调用）。 */
export function mergeMentions(
  base: MentionIndex,
  codexId: string,
  chapterId: string
): MentionIndex {
  const entry = base[codexId] ?? { chapters: [], count: 0 };
  const chapters = entry.chapters.includes(chapterId)
    ? entry.chapters
    : [...entry.chapters, chapterId];
  return { ...base, [codexId]: { chapters, count: entry.count + (entry.chapters.includes(chapterId) ? 0 : 1) } };
}
