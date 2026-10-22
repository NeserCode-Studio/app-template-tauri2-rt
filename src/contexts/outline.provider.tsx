import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocalStorageState } from "ahooks";

import { useI18n } from "@/composables";
import { OutlineContext, type OutlineContextValue } from "./outline";
import { useLongTask } from "./long-task";
import { useWorkspace } from "./workspace";
import { useLibrary } from "./library";
import {
  loadOutline,
  reconcileChapterIds,
  saveOutline,
} from "@/services/outline";
import { loadChapterMeta, loadChapterMetas } from "@/services/chapter";
import { createLogger } from "@/lib/logger";
import type { OutlineNode } from "@/shared/schema";
import type { ChapterMeta } from "@/services/chapter";

const log = createLogger("OutlineProvider");

const LAST_CHAPTER_KEY = "novels-yes:last-chapter";

export function OutlineProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { run: runLongTask } = useLongTask();
  const { root } = useWorkspace();
  const { currentWorkId, setCurrentWorkId, dataVersion } = useLibrary();

  const [outline, setOutline] = useState<{ nodes: OutlineNode[] }>({
    nodes: [],
  });
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  /** 阅读位置：滚动正文时更新，只驱动结构树高亮。 */
  const [readingChapterId, setReadingChapterId] = useState<string | null>(null);
  const [pendingParagraphId, setPendingParagraphId] = useState<string | null>(
    null
  );
  const [chapterMetas, setChapterMetas] = useState<Record<string, ChapterMeta>>(
    {}
  );
  const pendingJumpRef = useRef<{ workId: string; chapterId: string } | null>(
    null
  );
  const [lastByWork, setLastByWork] = useLocalStorageState<
    Record<string, string>
  >(LAST_CHAPTER_KEY, { defaultValue: {} });

  /** 切换作品时装载结构树，并恢复上次打开的章节。 */
  useEffect(() => {
    if (!root || !currentWorkId) {
      setOutline({ nodes: [] });
      setCurrentChapterId(null);
      setReadingChapterId(null);
      setPendingParagraphId(null);
      return;
    }
    let alive = true;
    loadOutline(root, currentWorkId)
      .then((loaded) =>
        // 早期版本建的章，结构树 id 与章文件名不一致，这里顺带修好。
        reconcileChapterIds(root, currentWorkId, loaded)
      )
      .then((next) => {
        if (!alive) return;
        setOutline(next);
        const pending = pendingJumpRef.current;
        const requested =
          pending?.workId === currentWorkId &&
          next.nodes.some((node) => node.id === pending.chapterId)
            ? pending.chapterId
            : null;
        if (requested) pendingJumpRef.current = null;
        const remembered = (lastByWork ?? {})[currentWorkId] ?? null;
        const exists =
          remembered && next.nodes.some((n) => n.id === remembered);
        setCurrentChapterId(requested ?? (exists ? remembered : null));
        setReadingChapterId(null);
      })
      .catch((err) => log.error("outline load failed", err));
    return () => {
      alive = false;
    };
    // lastByWork 只在装载时读一次，不作为依赖以免重复装载。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, currentWorkId]);

  /**
   * 外部改了磁盘（回收站恢复、深度扫描）时重载，但不动当前打开的章节。
   *
   * 刻意不并进上面的装载 effect：那个 effect 会按 lastByWork 重新决定
   * 打开哪一章，恢复一章顺手把用户正在写的章关掉是不能接受的。
   * 这里只换 outline，选中态原样保留。章元信息不用管——metasKey 由章 id
   * 列表推出，节点一变那个 effect 自己会重跑。
   *
   * 初次挂载时 loadOutline 已跑过，这里靠 dataVersion 跳过首轮重复装载。
   */
  useEffect(() => {
    if (!root || !currentWorkId) return;
    let alive = true;
    void (async () => {
      try {
        const next = await loadOutline(root, currentWorkId);
        if (!alive) return;
        setOutline(next);
      } catch (err) {
        log.error("outline reload failed", err);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  /** 记住每部作品最后打开的章节。 */
  useEffect(() => {
    if (!currentWorkId || !currentChapterId) return;
    setLastByWork({ ...(lastByWork ?? {}), [currentWorkId]: currentChapterId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkId, currentChapterId]);

  /*
   * 阅读位置跟随编辑目标。
   *
   * 点结构树、点"下一章"、草稿箱跳章，都是"人去哪一章"的显式指令，
   * 阅读位置必须立刻跟上，否则高亮还停在上一章，像是点错了。
   * 反过来（滚动改阅读位置）不碰这里——那正是二者要分开的原因。
   */
  useEffect(() => {
    setReadingChapterId(currentChapterId);
  }, [currentChapterId]);

  const reload = useCallback(async () => {
    if (!root || !currentWorkId) return;
    setOutline(await loadOutline(root, currentWorkId));
  }, [root, currentWorkId]);

  const openChapter = useCallback(
    (workId: string, chapterId: string, paragraphId: string | null = null) => {
      setPendingParagraphId(paragraphId);
      pendingJumpRef.current = { workId, chapterId };
      if (workId === currentWorkId) {
        if (outline.nodes.some((node) => node.id === chapterId)) {
          pendingJumpRef.current = null;
        }
        setCurrentChapterId(chapterId);
        return;
      }
      setCurrentWorkId(workId);
    },
    [currentWorkId, outline.nodes, setCurrentWorkId]
  );

  /** 章元信息（字数 / 正文更新时间）：切作品时读一次，保存后再刷新。 */
  const reloadChapterMetas = useCallback(async () => {
    if (!root || !currentWorkId) {
      setChapterMetas({});
      return;
    }
    setChapterMetas(await loadChapterMetas(root, currentWorkId));
  }, [root, currentWorkId]);

  const refreshChapterMeta = useCallback(
    async (chapterId: string) => {
      if (!root || !currentWorkId) return;
      const meta = await loadChapterMeta(root, currentWorkId, chapterId);
      if (!meta) return;
      setChapterMetas((prev) => ({ ...prev, [chapterId]: meta }));
    },
    [root, currentWorkId]
  );

  /** 便捷方法：把变更后的树写盘（Context 只暴露命令，不暴露 setOutline 直接落盘）。 */
  const persist = useCallback(
    async (next: { nodes: OutlineNode[] }) => {
      setOutline(next);
      if (root && currentWorkId) await saveOutline(root, currentWorkId, next);
    },
    [root, currentWorkId]
  );

  const chapters = useMemo(
    () =>
      outline.nodes
        .filter((n) => n.type === "chapter")
        .sort((a, b) => a.order - b.order),
    [outline]
  );

  const volumes = useMemo(
    () =>
      outline.nodes
        .filter((n) => n.type === "volume")
        .sort((a, b) => a.order - b.order),
    [outline]
  );

  const metasKey = useMemo(
    () => chapters.map((c) => c.id).join(","),
    [chapters]
  );
  useEffect(() => {
    if (!root || !currentWorkId) {
      setChapterMetas({});
      return;
    }
    let alive = true;
    void runLongTask(
      {
        title: t("LongTask.chapterIndex.title"),
        description: t("LongTask.chapterIndex.description"),
      },
      async (task) => {
        const next = await loadChapterMetas(root, currentWorkId, (progress) => {
          task.update({
            done: progress.done,
            total: progress.total,
            detail: progress.title
              ? `${progress.done}/${progress.total} · ${progress.title}`
              : t(
                  progress.phase === "write"
                    ? "LongTask.chapterIndex.writing"
                    : "LongTask.chapterIndex.scanning"
                ),
          });
        });
        if (alive) setChapterMetas(next);
      }
    ).catch((err) => log.error("chapter index load failed", err));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, currentWorkId, metasKey]);

  const value = useMemo<OutlineContextValue>(
    () => ({
      outline,
      currentChapterId,
      readingChapterId,
      pendingParagraphId,
      setPendingParagraphId,
      setReadingChapterId,
      chapters,
      volumes,
      chapterMetas,
      setOutline: persist,
      setCurrentChapterId,
      openChapter,
      reload,
      reloadChapterMetas,
      refreshChapterMeta,
    }),
    [
      outline,
      currentChapterId,
      readingChapterId,
      pendingParagraphId,
      chapters,
      volumes,
      chapterMetas,
      persist,
      openChapter,
      reload,
      reloadChapterMetas,
      refreshChapterMeta,
    ]
  );

  return (
    <OutlineContext.Provider value={value}>{children}</OutlineContext.Provider>
  );
}
