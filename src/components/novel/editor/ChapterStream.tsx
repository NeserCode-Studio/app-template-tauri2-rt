import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { useI18n } from "@/composables";
import { useOutline } from "@/contexts/outline";
import {
  CHAPTER_TURN_THRESHOLD_MAX,
  CHAPTER_TURN_THRESHOLD_MIN,
  DEFAULT_CHAPTER_TURN_THRESHOLD,
  usePreferences,
} from "@/contexts/preferences";
import { useViewMode } from "@/contexts/viewmode";
import { createLogger } from "@/lib/logger";
import type { Card, Chapter, OutlineNode } from "@/shared/schema";
import ChapterBody from "./ChapterBody";
import ChapterHeader from "./ChapterHeader";
import ComposerInput from "./ComposerInput";
import HistoryDialog from "./HistoryDialog";
import SplitDialog from "./SplitDialog";
import { useChapterController } from "./useChapterController";

const log = createLogger("ChapterStream");

/**
 * 边界翻章需要连续、明确的滚动意图。
 *
 * 单次滚轮事件的 delta 在不同设备上差异很大：鼠标一格可能超过 100px，
 * 触控板则是一串很小的增量。因此累计值限制单次贡献，既避免鼠标动量
 * 一帧直接翻章，也让触控板能自然累积到同一门槛。
 */
const MAX_TURN_STEP = 72;
const TURN_IDLE_MS = 320;
const SCROLL_SAVE_DELAY_MS = 180;

function scrollMemoryKey(workId: string, chapterId: string): string {
  return `novels-yes:editor:scroll:${workId}:${chapterId}`;
}

function readScrollRatio(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
  } catch {
    return null;
  }
}

function writeScrollRatio(key: string, ratio: number): void {
  try {
    window.localStorage.setItem(
      key,
      String(Math.min(1, Math.max(0, ratio)))
    );
  } catch {
    /* 存储被禁用或已满时，滚动记忆退化为本次会话内不可用。 */
  }
}

/**
 * 编辑器主区：标题栏 + 单章正文 + 底部输入框。
 *
 * 界面三段固定，只有中间的正文滚动区随章节整体更换：
 * 滚到本章末尾再向下滑，整章换成下一章；滚到本章开头再向上滑，
 * 整章换成上一章。滚动容器里始终只有一章的内容。
 *
 * 为什么必须监听 wheel 而不是 scroll：滚到边界后 scrollTop 不再变化，
 * scroll 事件直接停止触发，"还想继续往下"这个意图根本传不出来。
 * wheel 在边界外仍然触发，deltaY 的符号就是方向。
 *
 * 为什么不能把多章接成一片往下滚（早期版本那么做过）：那样滚动区里
 * 同时存在好几章，标题栏描述的是活动章，正文却在滚动别的章，
 * 用户分不清"我在读哪章、我在写哪章"。单章 + 边界翻章没有这个歧义。
 */

export interface ChapterStreamProps {
  root: string;
  workId: string;
  /** 活动章（可写的那一章）。 */
  chapter: Chapter;
  /** 切到另一章，并声明新章应落在章首还是章尾。 */
  onSelectChapter: (id: string, landing: ChapterLanding) => void;
  /**
   * 切章后的落点。
   *
   * "end" 表示回退到上一章，"start" 表示前进到下一章。
   * 必须由父级传入：本组件随切章整体重挂（Editor 用 key={chapter.id}
   * 渲染它），组件内的 ref / state 都活不到新实例，"上滑落章尾"
   * 这个意图会在这里凭空蒸发。
   */
  landing?: ChapterLanding;
  onWordsChange: (words: number) => void;
  onSaved: (chapter: Chapter) => void;
  onWordsCommitted: (words: number) => void;
  onRename: () => void;
  onDelete: () => void;
  onOpenCodexEntry: (entryId: string) => void;
}

export type ChapterLanding = "remember" | "start" | "end";
type ChapterCueSide = "start" | "end";

export interface ChapterStreamHandle {
  appendText: (text: string) => boolean;
  /** 把已预览的导入卡片追加到当前章并触发自动保存。 */
  appendCards: (cards: Card[]) => number;
}

/** 章节边缘常驻提示；progress 只表示本次滚动手势的累计进度。 */
function ChapterTurnCue({
  side,
  progress,
  label,
  showProgress,
}: {
  side: ChapterCueSide;
  progress: number;
  label: string;
  showProgress: boolean;
}) {
  const percent = Math.max(0, Math.min(100, progress * 100));
  return (
    <div
      aria-hidden="true"
      className={[
        "pointer-events-none absolute inset-x-0 z-20 flex justify-center px-4",
        side === "start" ? "top-3" : "bottom-3",
      ].join(" ")}
    >
      <div className="animate-in fade-in relative max-w-full min-w-0 overflow-hidden rounded-full border border-border/60 bg-muted/45 text-xs text-muted-foreground shadow-none backdrop-blur-sm duration-150">
        {showProgress ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 origin-left bg-muted-foreground/15 transition-transform duration-100 ease-out"
            style={{ transform: `scaleX(${percent / 100})` }}
          />
        ) : null}
        <div className="relative z-10 flex min-w-0 items-center gap-2.5 px-3 py-1.5">
          {side === "start" ? (
            <ChevronUp className="icon-sm shrink-0 text-muted-foreground/60" />
          ) : (
            <ChevronDown className="icon-sm shrink-0 text-muted-foreground/60" />
          )}
          <span className="min-w-0 truncate">{label}</span>
        </div>
      </div>
    </div>
  );
}

const ChapterStream = forwardRef<ChapterStreamHandle, ChapterStreamProps>(
  function ChapterStream(
    {
      root,
      workId,
      chapter,
      landing: landingProp = "remember",
      onSelectChapter,
      onWordsChange,
      onSaved,
      onWordsCommitted,
      onRename,
      onDelete,
      onOpenCodexEntry,
    },
    ref
  ) {
  const { t } = useI18n();
  const { chapters, volumes, setReadingChapterId } = useOutline();
  const { prefs } = usePreferences();
  const { mode } = useViewMode();
  const turnEnabled = prefs.chapterTurnEnabled;
  const showTurnHints = turnEnabled && prefs.chapterTurnHintsEnabled;
  const turnThreshold = Number.isFinite(prefs.chapterTurnThreshold)
    ? Math.max(
        CHAPTER_TURN_THRESHOLD_MIN,
        Math.min(CHAPTER_TURN_THRESHOLD_MAX, prefs.chapterTurnThreshold)
      )
    : DEFAULT_CHAPTER_TURN_THRESHOLD;
  const c = useChapterController({
    chapter,
    root,
    workId,
    onWordsChange,
    onSaved,
    onWordsCommitted,
  });

  /*
   * 阅读顺序：与结构树的视觉顺序一致（游离章在前，再按卷展开）。
   *
   * volumes 必须从 context 取，不能从 chapters 里过滤——context 的
   * chapters 只含 chapter 节点（见 outline.provider 的 filter），
   * 从它里面找 volume 永远得到空数组，卷内章会整批从序列里消失。
   */
  const sequence = useMemo<OutlineNode[]>(() => {
    const byParent = new Map<string | null, OutlineNode[]>();
    for (const n of chapters) {
      const list = byParent.get(n.parentId);
      if (list) list.push(n);
      else byParent.set(n.parentId, [n]);
    }
    const ordered = [...volumes].sort((a, b) => a.order - b.order);
    return [
      ...(byParent.get(null) ?? []),
      ...ordered.flatMap((v) => byParent.get(v.id) ?? []),
    ];
  }, [chapters, volumes]);

  const activeId = chapter.id;
  const activeIndex = sequence.findIndex((n) => n.id === activeId);
  /*
   * 活动章不在序列里时必须当故障处理：那会让正文区一片空白，
   * 而用户只会以为"我的字丢了"。
   */
  if (activeIndex < 0) {
    log.error("active chapter missing from sequence", {
      activeId,
      sequence: sequence.map((n) => n.id),
      chapters: chapters.length,
    });
  }

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [turnProgress, setTurnProgress] = useState<{
    side: "start" | "end";
    progress: number;
  } | null>(null);
  const [boundaries, setBoundaries] = useState({
    atTop: false,
    atBottom: false,
  });
  const turnDistanceRef = useRef<{ direction: -1 | 1; distance: number }>({
    direction: 1,
    distance: 0,
  });
  const turnResetTimer = useRef<number | null>(null);
  const boundarySyncFrame = useRef<number | null>(null);
  const scrollSaveTimer = useRef<number | null>(null);
  const lastScrollRatio = useRef(0);
  /**
   * StrictMode 会执行一次“挂载 -> 清理 -> 再挂载”。
   * 首次清理时正文尚未恢复；若直接 flush，会把记忆位置覆盖成 0。
   */
  const scrollReadyRef = useRef(false);
  const scrollStorageKey = scrollMemoryKey(workId, activeId);

  const resetTurnProgress = useCallback(() => {
    if (turnResetTimer.current !== null) {
      window.clearTimeout(turnResetTimer.current);
      turnResetTimer.current = null;
    }
    turnDistanceRef.current = { direction: 1, distance: 0 };
    setTurnProgress(null);
  }, []);

  /** 读取真实滚动位置，只在边界状态变化时触发一次渲染。 */
  const syncBoundaries = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atTop = el.scrollTop <= 1;
    const atBottom =
      el.scrollHeight <= el.clientHeight + 1 ||
      el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    setBoundaries((prev) =>
      prev.atTop === atTop && prev.atBottom === atBottom
        ? prev
        : { atTop, atBottom }
    );
  }, []);

  /** 同一帧内多次 scroll / resize 只计算一次边界。 */
  const scheduleBoundarySync = useCallback(() => {
    if (boundarySyncFrame.current !== null) return;
    boundarySyncFrame.current = requestAnimationFrame(() => {
      boundarySyncFrame.current = null;
      syncBoundaries();
    });
  }, [syncBoundaries]);

  useEffect(
    () => () => {
      if (turnResetTimer.current !== null) {
        window.clearTimeout(turnResetTimer.current);
      }
      if (boundarySyncFrame.current !== null) {
        cancelAnimationFrame(boundarySyncFrame.current);
      }
    },
    []
  );

  /**
   * 阅读章上报：滚到哪里，结构树就高亮哪里。
   *
   * 单章渲染下这个值几乎恒等于活动章，保留它是为了让"滚动同步高亮"
   * 这条验收项有真实的实现，而不是靠切章顺手带出来的巧合。
   */
  useEffect(() => {
    setReadingChapterId(activeId);
  }, [activeId, setReadingChapterId]);

  /**
   * 切章后的落点。
   *
   * 往下去新一章要从**开头**读——下一章的内容用户还没看过；
   * 往上去旧一章要落到**末尾**——上滑的手势方向是"往回走"，
   * 若把它摆在开头，用户看到的是一章全新的内容，位置感和手势相反，
   * 而且会一路"快速过章"：每次上滑都落在新一章顶部，再滑就又走了。
   * 落在末尾则衔接自然：上一章的收尾接着上一章的结尾，继续上滑才再退一章。
   */
  /*
   * 落点只在这次挂载时取一次。
   *
   * 父级完成导航后会清掉“待落点”标记，后续普通重渲染会把 landing
   * 改回 remember。若 effect 继续监听 landing，它会把刚落到章尾的页面
   * 再拉回旧位置；组件本身以 chapter.id 为 key，挂载时捕获一次即可。
   */
  const initialLanding = useRef(landingProp);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    /*
     * 必须等新章完成布局：activeId 变化的同一帧里 DOM 仍可能保留旧章的
     * 内容高度。两帧后再应用落点，章尾与按比例恢复才不会被旧尺寸带偏。
     */
    const target = initialLanding.current;
    let secondFrame = 0;
    scrollReadyRef.current = false;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
        if (target === "end") {
          el.scrollTop = maxScroll;
          lastScrollRatio.current = 1;
        } else if (target === "start") {
          el.scrollTop = 0;
          lastScrollRatio.current = 0;
        } else {
          const ratio = readScrollRatio(scrollStorageKey) ?? 0;
          el.scrollTop = maxScroll * ratio;
          lastScrollRatio.current = ratio;
        }
        scrollReadyRef.current = true;
        log.debug("landing applied", {
          activeId,
          target,
          scrollHeight: el.scrollHeight,
          scrollTop: el.scrollTop,
        });
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame !== 0) cancelAnimationFrame(secondFrame);
    };
  }, [activeId, scrollStorageKey]);

  /*
   * 普通阅读位置的记忆与被动的翻章提示相互独立：
   * 即使关闭边缘提示，切去素材库再回来也应回到原来的段落附近。
   * 存归一化比例而不是像素值，窗口尺寸或栏宽变化后仍能落在大致同一行。
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const flush = () => {
      if (!scrollReadyRef.current) return;
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      const ratio = maxScroll > 0 ? el.scrollTop / maxScroll : 0;
      lastScrollRatio.current = Math.min(1, Math.max(0, ratio));
      writeScrollRatio(scrollStorageKey, lastScrollRatio.current);
    };

    const onScroll = () => {
      if (!scrollReadyRef.current) return;
      if (scrollSaveTimer.current !== null) {
        window.clearTimeout(scrollSaveTimer.current);
      }
      scrollSaveTimer.current = window.setTimeout(() => {
        scrollSaveTimer.current = null;
        flush();
      }, SCROLL_SAVE_DELAY_MS);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      if (scrollSaveTimer.current !== null) {
        window.clearTimeout(scrollSaveTimer.current);
        scrollSaveTimer.current = null;
      }
      flush();
    };
  }, [scrollStorageKey]);

  const hasPrevious = activeIndex > 0;
  const hasNext = activeIndex >= 0 && activeIndex < sequence.length - 1;
  const trackEdgeHints = showTurnHints && activeIndex >= 0;

  /*
   * 边缘提示只在“总开关 + 提示开关”都开启时监听滚动。
   *
   * scroll 用 passive 监听，并通过 rAF 合并到每帧一次；ResizeObserver
   * 负责正文变长、窗口缩放等不产生 scroll 事件的布局变化。任一开关关闭
   * 或组件卸载时，监听、观察器与尚未执行的帧都会完整回收。
   */
  useEffect(() => {
    if (!trackEdgeHints) {
      if (boundarySyncFrame.current !== null) {
        cancelAnimationFrame(boundarySyncFrame.current);
        boundarySyncFrame.current = null;
      }
      setBoundaries((prev) =>
        !prev.atTop && !prev.atBottom
          ? prev
          : { atTop: false, atBottom: false }
      );
      return;
    }

    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => scheduleBoundarySync();
    el.addEventListener("scroll", onScroll, { passive: true });

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => scheduleBoundarySync());
    observer?.observe(el);
    if (el.firstElementChild instanceof HTMLElement) {
      observer?.observe(el.firstElementChild);
    }
    scheduleBoundarySync();

    return () => {
      el.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      if (boundarySyncFrame.current !== null) {
        cancelAnimationFrame(boundarySyncFrame.current);
        boundarySyncFrame.current = null;
      }
    };
  }, [trackEdgeHints, scheduleBoundarySync]);

  useEffect(() => {
    if (!showTurnHints) resetTurnProgress();
  }, [showTurnHints, resetTurnProgress]);

  /** 守护期间忽略 scroll：把 focus 引起的回弹挡掉，真人手势不受影响。 */

  /**
   * 边界翻章。
   *
   * 只在"已经贴在本章边界 + 仍朝边界外滑"时翻页。贴边状态每次 wheel
   * 都重新判定，所以不存在"隔了半屏还生效"的问题；而 wheel 本身
   * 要求一个持续手势，一次轻扫不会误翻。
   *
   * 本章还没滚到头时不拦默认行为；贴边且确有目标章时才接管滚轮，
   * 让累计进度和最终翻章都由同一个手势决定。
   */
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const el = scrollRef.current;
      if (!el || activeIndex < 0 || e.deltaY === 0) return;
      if (!turnEnabled) {
        resetTurnProgress();
        return;
      }

      const atTop = el.scrollTop <= 0;
      /*
       * 留 1px 容差：浏览器在缩放、亚像素布局下极少恰好等于 0，
       * 用 <= 0 判断会把"差 0.4px 到头"当成没贴边，翻页时灵时不灵。
       */
      const atBottom =
        el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      const direction = e.deltaY > 0 ? 1 : -1;
      const canTurn =
        direction > 0
          ? atBottom && activeIndex < sequence.length - 1
          : atTop && activeIndex > 0;

      if (!canTurn) {
        resetTurnProgress();
        return;
      }

      e.preventDefault();
      const unit =
        e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      const step = Math.min(
        Math.abs(e.deltaY * unit),
        MAX_TURN_STEP
      );
      const previous = turnDistanceRef.current;
      const distance =
        previous.direction === direction ? previous.distance + step : step;
      const side = direction > 0 ? "end" : "start";
      const progress = Math.min(1, distance / turnThreshold);

      turnDistanceRef.current = { direction, distance };
      if (showTurnHints) setTurnProgress({ side, progress });
      if (turnResetTimer.current !== null) {
        window.clearTimeout(turnResetTimer.current);
      }

      if (distance >= turnThreshold) {
        turnResetTimer.current = null;
        turnDistanceRef.current = { direction, distance: 0 };
        if (direction > 0) {
          const nextId = sequence[activeIndex + 1].id;
          log.debug("wheel advances to next chapter", { nextId, activeIndex });
          onSelectChapter(nextId, "start");
        } else {
          const prevId = sequence[activeIndex - 1].id;
          log.debug("wheel returns to previous chapter", { prevId, activeIndex });
          onSelectChapter(prevId, "end");
        }
        return;
      }

      turnResetTimer.current = window.setTimeout(() => {
        turnResetTimer.current = null;
        turnDistanceRef.current = { direction, distance: 0 };
        if (showTurnHints) setTurnProgress(null);
      }, TURN_IDLE_MS);
    },
    [
      activeIndex,
      sequence,
      onSelectChapter,
      resetTurnProgress,
      showTurnHints,
      turnEnabled,
      turnThreshold,
    ]
  );

  const appendText = useCallback(
    (text: string) => {
      const composer = c.composerRef.current;
      const value = text.trim();
      if (!composer || !value) return false;
      composer.load(`${composer.read()}${value}`, "end");
      return true;
    },
    [c.composerRef]
  );

  const appendCards = useCallback(
    (cards: Card[]) => c.importCards(cards),
    [c]
  );

  useImperativeHandle(
    ref,
    () => ({ appendText, appendCards }),
    [appendText, appendCards]
  );

  const showPreviousCue = trackEdgeHints && boundaries.atTop;
  const showNextCue = trackEdgeHints && boundaries.atBottom;
  const previousProgress =
    hasPrevious && turnProgress?.side === "start" ? turnProgress.progress : 0;
  const nextProgress =
    hasNext && turnProgress?.side === "end" ? turnProgress.progress : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SplitDialog
        open={c.splitTarget !== null}
        cardIndex={c.splitTarget ?? -1}
        text={c.splitTarget !== null ? (c.cards[c.splitTarget]?.text ?? "") : ""}
        onOpenChange={(o) => {
          if (!o) c.setSplitTarget(null);
        }}
        onConfirm={c.confirmSplit}
      />
      <HistoryDialog
        open={c.historyOpen}
        chapter={c.chapterWithHistory}
        onOpenChange={c.setHistoryOpen}
        onRollback={(i) => void c.rollback(i)}
        onDelete={(i) => void c.dropVersion(i)}
      />

      {/* 固定顶部：永远描述当前正在写的那一章。 */}
      <ChapterHeader
        title={chapter.title}
        words={c.words}
        saveState={c.saveState}
        hasLastMerge={Boolean(c.lastMerge)}
        onRename={onRename}
        onDelete={onDelete}
        onSave={c.saveNow}
        onOpenHistory={() => c.setHistoryOpen(true)}
        onUndoMerge={c.undoMerge}
      />

      {/*
       * 唯一的滚动区，里面始终只有一章。
       *
       * 用原生滚动而非 ScrollArea：正文要跟随滚动条"读位置"，
       * 自绘滚动容器会把滚动交给内部 viewport，联动（如跟随光标、滚动到底）
       * 都得改成对内部元素操作，得不偿失。样式由 scrollbar-app 统一。
       *
       * wheel 走 onWheel 而不是 addEventListener：React 的合成事件
       * 在 passive 监听上拿不到 preventDefault，但 JSX 上声明的
       * onWheel 默认是非 passive 的，边界翻章才拦得住。
       */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onWheel={turnEnabled ? handleWheel : undefined}
          className="scrollbar-app h-full overflow-y-auto px-6 py-12"
        >
          <ChapterBody
            cards={c.cards}
            editingIndex={c.editingIndex}
            dimOthers={mode === "focus" && c.editingIndex >= 0}
            onEdit={c.handleCardClick}
            onMoveUp={c.moveUp}
            onMoveDown={c.moveDown}
            onSplit={c.splitCard}
            onMergeDown={c.mergeDown}
            onDelete={c.deleteCard}
            onOpenCodexEntry={onOpenCodexEntry}
            listRef={c.listRef}
          />
        </div>

        {showPreviousCue ? (
          <ChapterTurnCue
            side="start"
            progress={previousProgress}
            label={t(
              hasPrevious ? "Editor.scroll.previous" : "Editor.scroll.first"
            )}
            showProgress={hasPrevious}
          />
        ) : null}
        {showNextCue ? (
          <ChapterTurnCue
            side="end"
            progress={nextProgress}
            label={t(hasNext ? "Editor.scroll.next" : "Editor.scroll.last")}
            showProgress={hasNext}
          />
        ) : null}
      </div>

      {/* 固定底部：输入框永远属于当前这一章。 */}
      <div className="shrink-0">
        <ComposerInput
          ref={c.composerRef}
          editingIndex={c.editingIndex}
          onSubmit={c.handleSubmit}
          onReturnToNew={c.returnToNew}
          pendingDraft={c.draft}
          onRestoreDraft={c.restoreDraft}
          onDiscardDraft={c.discardDraft}
          onTextChange={c.handleComposerTextChange}
        />
      </div>
    </div>
  );
  }
);

export default ChapterStream;
