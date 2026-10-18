import { useEffect, useMemo, useState } from "react";
import { Settings2 } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useI18n } from "@/composables";
import { useWorkspace } from "@/contexts/workspace";
import { useLibrary } from "@/contexts/library";
import { loadStats, saveStats, todayKey } from "@/services/stats";
import { countWorkWords } from "@/services/chapter";
import type { Stats } from "@/shared/schema";

/** 曲线天数：与计划书 §M6 的"近 14 天"一致。 */
const CURVE_DAYS = 14;

/** 目标为空时的占位曲线高度，避免整条曲线因除零塌成 0。 */
const FALLBACK_PEAK = 1000;

/**
 * 目标设置对话框。
 *
 * 目标与曲线口径都是"用户该按自己的节奏定"的东西，写死成常量既不现实
 * 也不礼貌：日更 500 和日更 5000 是两种完全不同的作息。
 */
function GoalDialog({
  open,
  stats,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  stats: Stats | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const { root } = useWorkspace();
  const { currentWorkId } = useLibrary();
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState<"net" | "total">("net");

  /* 打开时用当前值填表，不覆盖用户正在输入的内容。 */
  useEffect(() => {
    if (!open) return;
    setGoal(stats?.dailyGoal ? String(stats.dailyGoal) : "");
    setMode(stats?.curveMode ?? "net");
  }, [open, stats]);

  const save = async () => {
    if (!root || !currentWorkId) return;
    const n = Number(goal);
    await saveStats(root, currentWorkId, {
      ...(stats ?? ({} as Stats)),
      dailyGoal: Number.isFinite(n) && n > 0 ? Math.round(n) : 0,
      curveMode: mode,
    } as Stats);
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("Progress.goal.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="progress-goal">{t("Progress.goal.daily")}</Label>
            <Input
              id="progress-goal"
              type="number"
              min={0}
              step={100}
              value={goal}
              placeholder={t("Progress.goal.unset")}
              onChange={(e) => setGoal(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("Progress.goal.curveMode")}</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as "net" | "total")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="net">{t("Progress.goal.modeNet")}</SelectItem>
                <SelectItem value="total">{t("Progress.goal.modeTotal")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Editor.split.cancel")}
          </Button>
          <Button onClick={() => void save()}>{t("Progress.goal.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
  /** 目标设置对话框开关。 */
  const [goalOpen, setGoalOpen] = useState(false);
  /** 目标保存后自增，触发 stats 重读（否则写盘了界面也不会变）。 */
  const [goalRev, setGoalRev] = useState(0);

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
  }, [root, currentWorkId, chapterWords, goalRev]);

  /** 近 14 天曲线：从今天往回补齐，没写的日子填 0。 */
  const curve = useMemo(() => {
    const daily = stats?.daily ?? {};
    const netMode = (stats?.curveMode ?? "net") === "net";
    const out: { key: string; day: string; label: string | null; words: number }[] = [];
    let running = 0;
    for (let i = CURVE_DAYS - 1; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = todayKey(d);
      const net = daily[key] ?? 0;
      /*
       * 两种口径：
       * - `net` 直接取当日净增，回答"我当天推进了多少"。
       * - `total` 从窗口起点累加，回答"这 14 天里哪天偷懒了"——
       *   它是一条上升曲线，斜率突变的日子就是停笔的日子。
       *
       * 注意 `total` 是窗口内累加而非"历史总量"：daily 只存每日增量，
       * 没有全量水位线，跨窗口累加需要从作品总字数倒推，容易出错。
       */
      running += net;
      const dayOfMonth = d.getDate();
      /*
       * 日期标注要稀疏。
       *
       * 右栏约 250px，14 列每列不到 20px。原来每列都写 "1/1" 这种
       * 月/日，两字符在 9px 下既被截断又长得像数字，读起来是"一堆 1..1.."，
       * 完全看不出是日期。改为：只标每 3 天（跨月那天额外标出月份），
       * 单日只写日号——"3" 不可能被误读成别的东西。
       */
      const isMonthStart = dayOfMonth === 1;
      const showLabel = isMonthStart || dayOfMonth % 3 === 0;
      out.push({
        key,
        day: `${d.getMonth() + 1}/${d.getDate()}`,
        label: showLabel ? (isMonthStart ? `${d.getMonth() + 1}月` : String(dayOfMonth)) : null,
        words: netMode ? net : running,
      });
    }
    return out;
  }, [stats]);

  const peak = Math.max(1, ...curve.map((c) => c.words));
  const dailyGoal = stats?.dailyGoal ?? 0;
  const goalPct = dailyGoal
    ? Math.min(100, Math.round(((stats?.todayWords ?? 0) / dailyGoal) * 100))
    : 0;

  /*
   * 柱高标尺。
   *
   * 之前用 `peak = max(words, 1)` 做分母，于是只要所有日子字数相同
   * （典型情况：连着几天都写 1000 字），每根柱都正好 100%，
   * 14 根一样高的柱子连成一片——用户看到的是"图坏了"。
   * 标尺留出余量（峰值只占 80%），并给每根柱一个最低可见高度，
   * 这样"都一样"也能看出是一排柱子而不是一块色带。
   */
  const scaleMax = Math.max(dailyGoal, peak, FALLBACK_PEAK) * 1.2;

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <h3 className="row-label">{t("Progress.today")}</h3>
          <div className="flex items-center gap-1.5">
            <span className="text-xs tabular-nums text-muted-foreground">
              {stats?.todayWords ?? 0}
              {dailyGoal ? ` / ${dailyGoal}` : ""}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              aria-label={t("Progress.goal.title")}
              title={t("Progress.goal.title")}
              onClick={() => setGoalOpen(true)}
            >
              <Settings2 className="icon-sm" />
            </Button>
          </div>
        </div>
        {/* 未设目标时不画进度条：一根恒为 0% 的条只会被读成"坏了"。 */}
        {dailyGoal ? <Progress value={goalPct} className="h-1.5" /> : null}
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
        <div className="flex items-baseline justify-between">
          <h3 className="row-label">{t("Progress.curve")}</h3>
          <span className="text-[10px] tabular-nums text-muted-foreground/60">
            {t("Progress.goal.peak")}: {Math.round(scaleMax / 1.2)}
          </span>
        </div>
        {/* 相对容器定位，标尺线才能盖在柱子上做参照。 */}
        <div className="relative h-16">
          {dailyGoal ? (
            <div
              className="pointer-events-none absolute inset-x-0 border-t border-dashed border-primary/40"
              style={{ bottom: `${Math.round((dailyGoal / scaleMax) * 100)}%` }}
            >
              <span className="absolute right-0 -top-4 text-[9px] text-primary/70">
                {t("Progress.goal.line")}
              </span>
            </div>
          ) : null}
          {/*
           * 柱区与标签行拆成两个独立行：这样基线可以直接画在柱区容器自身的
           * 底边上，不需要靠绝对定位去猜标签占多高（猜错就会错位）。
           */}
          <div className="flex h-12 items-end gap-0.5 border-b border-border/60">
            {curve.map((c) => (
              <div key={c.key} className="flex h-full min-w-0 flex-1 items-end">
                <div
                  className={[
                    /*
                     * 柱形只做极轻微的圆角（2px）。原来的 rounded-sm 在
                     * 细柱子上会让两端变成半圆，读起来像胶囊而不是柱子；
                     * 数据图不该有这种装饰。
                     */
                    "w-full rounded-[2px] transition-[height]",
                    c.key === todayKey() ? "bg-primary" : "bg-primary/40",
                  ].join(" ")}
                  style={{
                    /* 零字数的日子留空即可——"那天没写"本就该是空的。
                       之前给过一个 2% 的底条，但它和内联的 height: 0 冲突
                       （min-height 优先），于是本该空着的格子全被画出 2px，
                       十几根连在基线上像一段断续的坐标轴。
                       柱区改为单独画一条基线，零日柱子自然与之齐平。 */
                    height: `${Math.max(
                      c.words === 0 ? 0 : 6,
                      Math.round((c.words / scaleMax) * 100)
                    )}%`,
                  }}
                  title={`${c.day} · ${c.words} ${t("Editor.history.words")}`}
                />
              </div>
            ))}
          </div>
          {/* 标签单独一行：与柱区同宽同列，稀疏标注。 */}
          <div className="mt-1 flex gap-0.5">
            {curve.map((c) => (
              <div
                key={c.key}
                className="min-w-0 flex-1 truncate text-center text-[9px] text-muted-foreground/70"
              >
                {c.label ?? ""}
              </div>
            ))}
          </div>
        </div>
      </section>
      <GoalDialog
        open={goalOpen}
        stats={stats}
        onOpenChange={setGoalOpen}
        onSaved={() => setGoalRev((n) => n + 1)}
      />
    </div>
  );
}
