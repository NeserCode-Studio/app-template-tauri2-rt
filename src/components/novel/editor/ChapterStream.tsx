import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/composables";
import { useOutline } from "@/contexts/outline";
import { createLogger } from "@/lib/logger";
import { loadChapter } from "@/services/chapter";
import type { Chapter, OutlineNode } from "@/shared/schema";
import ChapterEditor from "./ChapterEditor";
import ReadonlyChapter from "./ReadonlyChapter";

const log = createLogger("ChapterStream");

/**
 * 连续章节流：把「一章一屏」变成「一章接一章往下滚」。
 *
 * 为什么值得改：写长篇时要对照前文，旧模型是"记住第几章 → 切走 → 看 →
 * 切回"，三步里有两步在丢上下文。连续流里对照只是滚一下滚轮。
 *
 * 代价与取舍：
 * - 只有活动章可写，邻章是只读渲染。编辑器的一切单章假设
 *   （保存、历史、撤销、草稿）因此都不用改，仍以活动章为唯一写入单元。
 * - 邻章只渲染 ±2 章并随滚动增删。长作品一次性全渲染会把 DOM 撑到
 *   几万节点，卡的是滑动本身。
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

  /** 阅读顺序：与结构树的视觉顺序一致（游离章在前，再按卷展开）。 */
  /*
   * volumes 必须从 context 取，不能从 chapters 里过滤——context 的
   * chapters 只含 chapter 节点（见 outline.provider 的 filter），
   * 从它里面找 volume 永远得到空数组，卷内章会整批从序列里消失。
   */
  const sequence = useMemo<OutlineNode[]>(() => {
    const byParent = new Map<string | null, OutlineNode[]>();
    for (const c of chapters) {
      const list = byParent.get(c.parentId);
      if (list) list.push(c);
      else byParent.set(c.parentId, [c]);
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

  /** 窗口内的章节节点（含活动章）。越界时自动收窄，作品末尾不会渲染空位。 */
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
   */
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const anchor = scroller.querySelector<HTMLElement>(
      `[data-chapter-anchor="${activeId}"]`
    );
    if (!anchor) return;
    anchor.scrollIntoView({ block: "start", behavior: "auto" });
  }, [activeId]);

  /** 点击邻章标题：把编辑目标切过去。 */
  const handleSelect = useCallback(
    (id: string) => {
      if (id !== activeId) onSelectChapter(id);
    },
    [activeId, onSelectChapter]
  );

  return (
    <div
      ref={scrollRef}
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
            </h2>
            {data ? (
              isActive ? (
                <ChapterEditor
                  embedded
                  key={data.id}
                  chapter={data}
                  root={root}
                  workId={workId}
                  onWordsChange={onWordsChange}
                  onSaved={onSaved}
                  onWordsCommitted={onWordsCommitted}
                  onRename={onRename}
                  onDelete={onDelete}
                  onOpenCodexEntry={onOpenCodexEntry}
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
  );
}
