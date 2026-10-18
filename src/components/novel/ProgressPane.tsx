import { useEffect, useMemo, useState } from "react";

import { Progress } from "@/components/ui/progress";

import { useI18n } from "@/composables";
import { useWorkspace } from "@/contexts/workspace";
import { useLibrary } from "@/contexts/library";
import { loadStats, todayKey } from "@/services/stats";
import { countWorkWords } from "@/services/chapter";
import type { Stats } from "@/shared/schema";

/** 曲线天数：与计划书 §M6 的"近 14 天"一致。 */
const CURVE_DAYS = 14;

/** 每日目标字数（可后续做成可配置项）。 */
const DAILY_GOAL = 1000;

/**
 * 写作进度面板。
 *
 * 数据现算而不建缓存表：作品总字数以磁盘章文件为准，stats.json 只提供
 * 「今日新增」「连续天数」这类需要历史状态的数据。
 */
export default function ProgressPane({ chapterWords }: { chapterWords: number }) {
  const { t } = useI18n();
  const { root } = useWorkspace();
  const { currentWorkId, works } = useLibrary();

  const [stats, setStats] = useState<Stats | null>(null);
  const [total, setTotal] = useState(0);

  /* chapterWords 变化即刷新：写作时进度要跟着动。 */
  useEffect(() => {
    if (!root || !currentWorkId) return;
    let alive = true;
    void (async () => {
      const [s, w] = await Promise.all([
        loadStats(root, currentWorkId),
        countWorkWords(root, currentWorkId),
      ]);
      if (!alive) return;
      setStats(s);
      setTotal(w);
    })();
    return () => {
      alive = false;
    };
  }, [root, currentWorkId, chapterWords]);

  /** 近 14 天曲线：从今天往回补齐，没写的日子填 0。 */
  const curve = useMemo(() => {
    const daily = stats?.daily ?? {};
    const out: { key: string; day: string; words: number }[] = [];
    for (let i = CURVE_DAYS - 1; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = todayKey(d);
      out.push({
        key,
        day: `${d.getMonth() + 1}/${d.getDate()}`,
        words: daily[key] ?? 0,
      });
    }
    return out;
  }, [stats]);

  const peak = Math.max(1, ...curve.map((c) => c.words));
  const goalPct = Math.min(100, Math.round(((stats?.todayWords ?? 0) / DAILY_GOAL) * 100));

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <h3 className="row-label">{t("Progress.today")}</h3>
          <span className="text-xs tabular-nums text-muted-foreground">
            {stats?.todayWords ?? 0} / {DAILY_GOAL}
          </span>
        </div>
        <Progress value={goalPct} className="h-1.5" />
      </section>

      <section className="grid grid-cols-2 gap-2">
        <div className="rounded-md border p-2">
          <p className="text-[11px] text-muted-foreground">{t("Progress.streak")}</p>
          <p className="text-lg font-semibold tabular-nums">{stats?.streak ?? 0}</p>
        </div>
        <div className="rounded-md border p-2">
          <p className="text-[11px] text-muted-foreground">{t("Progress.total")}</p>
          <p className="text-lg font-semibold tabular-nums">{total}</p>
        </div>
        <div className="rounded-md border p-2">
          <p className="text-[11px] text-muted-foreground">{t("Progress.chapter")}</p>
          <p className="text-lg font-semibold tabular-nums">{chapterWords}</p>
        </div>
        <div className="rounded-md border p-2">
          <p className="text-[11px] text-muted-foreground">{t("Progress.work")}</p>
          <p className="truncate text-sm font-medium">{works[currentWorkId ?? ""]?.title ?? ""}</p>
        </div>
      </section>

      {/*
       * 字数曲线。
       *
       * 用 div 画柱而非图表库：14 根柱、单一数据序列，
       * 引库的体积与配置成本高于收益。
       */}
      <section className="flex flex-col gap-1.5">
        <h3 className="row-label">{t("Progress.curve")}</h3>
        <div className="flex h-16 items-end gap-0.5">
          {curve.map((c) => (
            <div key={c.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="flex h-full w-full items-end">
                <div
                  className={[
                    "w-full rounded-sm transition-[height]",
                    c.key === todayKey() ? "bg-primary" : "bg-primary/40",
                  ].join(" ")}
                  style={{ height: `${Math.round((c.words / peak) * 100)}%` }}
                  title={`${c.day}: ${c.words}`}
                />
              </div>
              <span className="w-full truncate text-center text-[9px] text-muted-foreground/70">
                {c.day}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
