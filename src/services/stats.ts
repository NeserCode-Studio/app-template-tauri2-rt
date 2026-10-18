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
    /* 负的日增量允许存在（回改旧文），但不把曲线拉到 0 以下。 */
    daily: {
      ...stats.daily,
      [key]: Math.max(0, (stats.daily[key] ?? 0) + delta),
    },
    workWords: { ...stats.workWords, [workId]: workWords },
  };
  await saveStats(root, workId, next);
  return next;
}

/**
 * 按作品新字数登记一次写作。
 *
 * **delta 必须由这里算，不能由调用方传。** 早期版本让调用方自己算差额，
 * 结果所有调用点都传了 0，于是 `totalWords` / `todayWords` 永远为 0，
 * 而 `workWords` 却在正常增长——统计面板看起来"有作品字数、没总字数"，
 * 排查起来毫无线索。
 *
 * 改为以 stats 里记录的上一版作品字数为基准求差，调用点只需给当前值，
 * 就不可能再忘记传 delta。首次登记（无历史）只更新作品字数，
 * 不把存量一次性算进"今日新增"——否则打开一天的作品会显示写了十万字。
 */
export async function recordWorkWords(
  root: string,
  workId: string,
  workWords: number
): Promise<Stats> {
  const stats = await loadStats(root, workId);
  const previous = stats.workWords[workId];
  const delta = previous === undefined ? 0 : workWords - previous;
  return recordWrite(root, workId, workWords, delta);
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
