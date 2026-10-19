import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/composables";
import { useOutline } from "@/contexts/outline";
import { useViewMode } from "@/contexts/viewmode";
import { createLogger } from "@/lib/logger";
import { loadChapter } from "@/services/chapter";
import type { Chapter, OutlineNode } from "@/shared/schema";
import ChapterBody from "./ChapterBody";
import ChapterHeader from "./ChapterHeader";
import ComposerInput from "./ComposerInput";
import HistoryDialog from "./HistoryDialog";
import ReadonlyChapter from "./ReadonlyChapter";
import SplitDialog from "./SplitDialog";
import { useChapterController } from "./useChapterController";

const log = createLogger("ChapterStream");

/**
 * 连续章节流。
 *
 * 结构是一条竖向三段式：标题栏（固定）→ 正文（唯一滚动区）→ 输入框（固定）。
 * 标题栏与输入框全应用只有一份，永远属于"当前正在写的那一章"；
 * 中间的滚动区里，活动章的正文与前后邻章的正文连成一片往下滚。
 *
 * 为什么标题栏不能跟着章走：早期版本把整套编辑器嵌进每一章，结果
 * 屏幕中间夹着"邻章正文 → 标题栏 → 活动章正文 → 输入框 → 邻章正文"，
 * 用户分不清哪个标题栏在描述哪一章。固定 chrome 就是为消掉这个歧义。
 *
 * 切章判据（用户确认）：
 *   已停在章尾 + 再向下滚一次 = 下一章
 *   已停在章首 + 再向上滚一次 = 上一章
 * 不用像素阈值：阈值在长章与短章之间手感不一致，而"贴边后再滚一下"
 * 是一个明确的手势，也不会在临界位置来回抖。
 */

/** 活动章前后各渲染几章。2 章约两屏，滚到边界时来得及补下一页。 */
const SIBLINGS = 2;

export interface ChapterStreamProps {
  root: string;
  workId: string;
  /** 活动章（可写的那一章）。 */
  chapter: Chapter;
  /** 切到另一章。 */
  onSelectChapter: (id: string) => void;
  onWordsChange: (words: number) => void;
  onSaved: (chapter: Chapter) => void;
  onWordsCommitted: (words: number) => void;
  onRename: () => void;
  onDelete: () => void;
  onOpenCodexEntry: (entryId: string) => void;
}

export default function ChapterStream({
  root,
  workId,
  chapter,
  onSelectChapter,
  onWordsChange,
  onSaved,
  onWordsCommitted,
  onRename,
  onDelete,
  onOpenCodexEntry,
}: ChapterStreamProps) {
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
    const seq = [
      ...(byParent.get(null) ?? []),
      ...ordered.flatMap((v) => byParent.get(v.id) ?? []),
    ];
    log.debug("sequence built", {
      chapters: chapters.length,
      volumes: volumes.length,
      loose: byParent.get(null)?.length ?? 0,
      sequence: seq.length,
    });
    return seq;
  }, [chapters, volumes]);

  const activeId = chapter.id;
  const activeIndex = sequence.findIndex((n) => n.id === activeId);
  /*
   * 活动章不在序列里时必须当故障处理，不能静默退回空窗口：
   * 那会让正文区一片空白，而用户只会以为"我的字丢了"。
   */
  if (activeIndex < 0) {
    log.error("active chapter missing from sequence", {
      activeId,
      sequence: sequence.map((n) => n.id),
      chapters: chapters.length,
    });
  }

  /** 窗口内的章节节点（含活动章）。 */
  const windowNodes = useMemo<OutlineNode[]>(() => {
    /*
     * 活动章不在序列里时返回空窗口，而不是退回整条 sequence：
     * 退回去会把用户没点的章也铺开，看着像全乱了。
     */
    if (activeIndex < 0) return [];
    const from = Math.max(0, activeIndex - SIBLINGS);
    const to = Math.min(sequence.length, activeIndex + SIBLINGS + 1);
    const slice = sequence.slice(from, to);
    log.debug("window sliced", { from, to, size: slice.length, activeIndex });
    return slice;
  }, [sequence, activeIndex]);

  /**
   * 邻章正文。
   *
   * 用一个 Map 缓存而不是每章一个 state：窗口滑动时要同时增删若干章，
   * 逐个 setState 会让窗口边界出现半拍空窗。
   */
  const [loaded, setLoaded] = useState(new Map<string, Chapter>());
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  /** 需要加载的邻章 id（不含活动章：它由 Editor 提供，是唯一权威副本）。 */
  const needed = useMemo(
    () =>
      windowNodes
        .map((n) => n.id)
        .filter((id) => id !== activeId && !loadedRef.current.has(id)),
    [windowNodes, activeId]
  );

  useEffect(() => {
    if (!needed.length) return;
    let alive = true;
    void (async () => {
      const entries = await Promise.all(
        needed.map(async (id) => {
          try {
            return [id, await loadChapter(root, workId, id)] as const;
          } catch (err) {
            log.error("neighbor load failed", id, err);
            return [id, null] as const;
          }
        })
      );
      if (!alive) return;
      setLoaded((prev) => {
        const next = new Map(prev);
        for (const [id, value] of entries) if (value) next.set(id, value);
        return next;
      });
    })();
    return () => {
      alive = false;
    };
  }, [needed, root, workId]);

  /** 切章后丢弃不在窗口内的缓存，避免长作品里越攒越多。 */
  useEffect(() => {
    const keep = new Set(windowNodes.map((n) => n.id));
    setLoaded((prev) => {
      let changed = false;
      const next = new Map<string, Chapter>();
      for (const [id, value] of prev) {
        if (keep.has(id)) next.set(id, value);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [windowNodes]);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  /**
   * 阅读章上报。
   *
   * 用 IntersectionObserver 观察每章的标题锚点，取"最靠近视口顶部"的那个。
   * 不用 scroll 事件手算：observer 在长列表上不会随滚动频率触发重排。
   */
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const anchors = Array.from(
      scroller.querySelectorAll<HTMLElement>("[data-chapter-anchor]")
    );
    if (!anchors.length) return;

    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.chapterAnchor;
          if (!id) continue;
          if (entry.isIntersecting) visible.set(id, entry.boundingClientRect.top);
          else visible.delete(id);
        }
        if (!visible.size) return;
        /*
         * 取 top 最小者：视口里最靠上的那一章就是"正在读"的那一章。
         * 跨章连续滚动时它单调变化，不会在两章之间来回抖。
         */
        let bestId = "";
        let bestTop = Number.POSITIVE_INFINITY;
        for (const [id, top] of visible) {
          if (top < bestTop) {
            bestTop = top;
            bestId = id;
          }
        }
        if (bestId) setReadingChapterId(bestId);
      },
      { root: scroller, threshold: [0, 0.01, 0.5] }
    );
    for (const el of anchors) observer.observe(el);
    return () => observer.disconnect();
  }, [windowNodes, setReadingChapterId]);

  /**
   * 切章时把活动章标题滚到视口顶部。
   *
   * 用标题锚点而不是 scrollTo(0)：窗口滑动后活动章的位置本来就变了，
   * 锚点定位才对得上用户点的那一章。
   *
   * 同时清掉贴边记忆：刚切过来时正对章首，但那是"刚落地"的状态，
   * 不是用户主动贴边的结果，不该立刻就能再滚一次切走。
   */
  const atEdgeRef = useRef<"start" | "end" | null>(null);
  const lastYRef = useRef<number | null>(null);
  useEffect(() => {
    atEdgeRef.current = null;
    lastYRef.current = null;
    const scroller = scrollRef.current;
    if (!scroller) return;
    const anchor = scroller.querySelector<HTMLElement>(
      `[data-chapter-anchor="${activeId}"]`
    );
    if (!anchor) return;
    anchor.scrollIntoView({ block: "start", behavior: "auto" });
  }, [activeId]);

  /**
   * 滚动监听：维护贴边状态，并在贴边后再滚一次时切章。
   *
   * 判据是"当前帧的滚动方向 + 上一帧留下的贴边记忆"：
   * 只有先在章尾贴过边、再向下滚，才切下一章。单独一个向下滚动
   * 手势（可能只是从章中往章尾滑）不会触发切换。
   */
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const anchor = el.querySelector<HTMLElement>(
      `[data-chapter-anchor="${activeId}"]`
    );
    if (!anchor) return;

    /*
     * 用活动章标题锚点与滚动容器的几何关系判断贴边，而不是看整个
     * 滚动区是否到底：邻章在活动章下方，"滚动区到底"永远发生在最后一章，
     * 用它判断会把"看到邻章末尾"误当成"当前章读完"。
     */
    const viewTop = el.getBoundingClientRect().top;
    const viewBottom = el.getBoundingClientRect().bottom;
    const anchorTop = anchor.getBoundingClientRect().top;
    /*
     * 章尾用锚点下方第一段的底部来判定：标题本身在章首，
     * 单看标题位置只能判断"章首贴边"，判断不了"这一章读完了"。
     */
    const body = anchor.nextElementSibling as HTMLElement | null;
    const bodyBottom = body ? body.getBoundingClientRect().bottom : anchorTop;

    if (anchorTop <= viewTop + 1) atEdgeRef.current = "start";
    else if (bodyBottom >= viewBottom - 1) atEdgeRef.current = "end";
    else atEdgeRef.current = null;

    /*
     * 方向判定用 scrollTop 的累计变化，不用 event.deltaY：
     * 触控板与鼠标的 delta 符号不一致，而位移是唯一不会骗人的量。
     */
    const y = el.scrollTop;
    const prev = lastYRef.current;
    lastYRef.current = y;
    if (prev === null) return;
    const dy = y - prev;
    if (dy === 0) return;

    const edge = atEdgeRef.current;
    if (edge === "end" && dy > 0 && activeIndex < sequence.length - 1) {
      const nextId = sequence[activeIndex + 1].id;
      log.debug("scroll advances to next chapter", { nextId, activeIndex });
      onSelectChapter(nextId);
    } else if (edge === "start" && dy < 0 && activeIndex > 0) {
      const prevId = sequence[activeIndex - 1].id;
      log.debug("scroll returns to previous chapter", { prevId, activeIndex });
      onSelectChapter(prevId);
    }
  }, [activeIndex, sequence, onSelectChapter, activeId]);

  /** 点击邻章标题：把编辑目标切过去。 */
  const handleSelect = useCallback(
    (id: string) => {
      if (id !== activeId) onSelectChapter(id);
    },
    [activeId, onSelectChapter]
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

      {/* 唯一的滚动区：活动章与邻章正文连成一片。 */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="scrollbar-app min-h-0 flex-1 overflow-y-auto px-6 py-4"
      >
        {windowNodes.map((node) => {
          const isActive = node.id === activeId;
          const data = isActive ? chapter : loaded.get(node.id);
          return (
            <section key={node.id} className="mb-10">
              <h2
                data-chapter-anchor={node.id}
                className="article-body prose-article mx-auto mb-3 flex items-baseline gap-2 border-b pb-1"
              >
                <button
                  type="button"
                  onClick={() => handleSelect(node.id)}
                  className="truncate text-base font-semibold hover:underline"
                  title={t("Editor.side.jump")}
                >
                  {node.title || t("Editor.title.placeholder")}
                </button>
                {isActive ? (
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/60">
                    {t("Editor.side.current")}
                  </span>
                ) : null}
              </h2>
              {data ? (
                isActive ? (
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
                ) : (
                  <ReadonlyChapter chapter={data} onOpenCodexEntry={onOpenCodexEntry} />
                )
              ) : (
                <p className="text-xs text-muted-foreground/60">{t("Editor.status.saving")}</p>
              )}
            </section>
          );
        })}
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
        />
      </div>
    </div>
  );
}
