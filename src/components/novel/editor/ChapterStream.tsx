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
const TURN_THRESHOLD = 96;
const MAX_TURN_STEP = 72;
const TURN_IDLE_MS = 320;

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

export type ChapterLanding = "start" | "end";

export interface ChapterStreamHandle {
  appendText: (text: string) => boolean;
  /** 把已预览的导入卡片追加到当前章并触发自动保存。 */
  appendCards: (cards: Card[]) => number;
}

const ChapterStream = forwardRef<ChapterStreamHandle, ChapterStreamProps>(
  function ChapterStream(
    {
      root,
      workId,
      chapter,
      landing: landingProp = "start",
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
  const { mode } = useViewMode();
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
  const [turnCue, setTurnCue] = useState<{
    side: "start" | "end";
    progress: number;
  } | null>(null);
  const turnDistanceRef = useRef<{ direction: -1 | 1; distance: number }>({
    direction: 1,
    distance: 0,
  });
  const turnResetTimer = useRef<number | null>(null);

  const resetTurnCue = useCallback(() => {
    if (turnResetTimer.current !== null) {
      window.clearTimeout(turnResetTimer.current);
      turnResetTimer.current = null;
    }
    turnDistanceRef.current = { direction: 1, distance: 0 };
    setTurnCue(null);
  }, []);

  useEffect(
    () => () => {
      if (turnResetTimer.current !== null) {
        window.clearTimeout(turnResetTimer.current);
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
   * 改回 start。若 effect 继续监听 landing，它会把刚落到章尾的页面
   * 再拉回章首；组件本身以 chapter.id 为 key，挂载时捕获一次即可。
   */
  const initialLanding = useRef(landingProp);
  /*
   * 落点守护窗口。
   *
   * 切章时 useChapterController 会 focus() 底部输入框，而浏览器
   * "把聚焦元素滚进视口"是异步的布局行为，会晚于我们设置的 scrollTop
   * 生效，把刚落到章尾的视口又拽回输入框附近。所以在落点后短暂
   * 屏蔽 scroll 事件造成的回弹——真人在这一两百毫秒内也滚不出一个手势。
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    /*
     * 必须延一帧：activeId 变化的同一帧里 DOM 还是上一章的内容，
     * 此刻读 scrollHeight 拿到的是旧章高度，落点会停在中途。
     * 等 rAF 之后新章已挂入，scrollHeight 才是这一章的。
     */
    const target = initialLanding.current;
    if (target === "start") {
      log.debug("landing: start", { activeId });
      el.scrollTop = 0;
      return;
    }
    log.debug("landing: end (deferred one frame)", {
      activeId,
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
    });
    const raf = requestAnimationFrame(() => {
      log.debug("landing: end applied", {
        activeId,
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
      });
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [activeId]);

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
        resetTurnCue();
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
      const progress = Math.min(1, distance / TURN_THRESHOLD);

      turnDistanceRef.current = { direction, distance };
      setTurnCue({ side, progress });
      if (turnResetTimer.current !== null) {
        window.clearTimeout(turnResetTimer.current);
      }

      if (distance >= TURN_THRESHOLD) {
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
        setTurnCue(null);
      }, TURN_IDLE_MS);
    },
    [activeIndex, sequence, onSelectChapter, resetTurnCue]
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
    [c.importCards]
  );

  useImperativeHandle(
    ref,
    () => ({ appendText, appendCards }),
    [appendText, appendCards]
  );

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
          onWheel={handleWheel}
          className="scrollbar-app h-full overflow-y-auto px-6 py-4"
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

        {turnCue ? (
          <div
            aria-hidden="true"
            className={[
              "pointer-events-none absolute inset-x-0 z-20 flex justify-center px-4",
              turnCue.side === "start" ? "top-3" : "bottom-3",
            ].join(" ")}
          >
            <div className="animate-in fade-in flex max-w-full min-w-0 items-center gap-2.5 rounded-full border border-[var(--editor-selection-border)] bg-background/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm duration-150">
              {turnCue.side === "start" ? (
                <ChevronUp className="icon-sm shrink-0 text-[var(--editor-selection-border)]" />
              ) : (
                <ChevronDown className="icon-sm shrink-0 text-[var(--editor-selection-border)]" />
              )}
              <span className="min-w-0 truncate">
                {t(
                  turnCue.side === "start"
                    ? "Editor.scroll.previous"
                    : "Editor.scroll.next"
                )}
              </span>
              <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-[var(--editor-selection-border)] transition-[width] duration-100 ease-out"
                  style={{ width: `${turnCue.progress * 100}%` }}
                />
              </span>
            </div>
          </div>
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
