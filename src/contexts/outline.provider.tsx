import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocalStorageState } from "ahooks";

import { OutlineContext, type OutlineContextValue } from "./outline";
import { useWorkspace } from "./workspace";
import { useLibrary } from "./library";
import { loadOutline, reconcileChapterIds, saveOutline } from "@/services/outline";
import { createLogger } from "@/lib/logger";
import type { OutlineNode } from "@/shared/schema";

const log = createLogger("OutlineProvider");

const LAST_CHAPTER_KEY = "novels-yes:last-chapter";

export function OutlineProvider({ children }: { children: ReactNode }) {
  const { root } = useWorkspace();
  const { currentWorkId } = useLibrary();

  const [outline, setOutline] = useState<{ nodes: OutlineNode[] }>({ nodes: [] });
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  const [lastByWork, setLastByWork] = useLocalStorageState<Record<string, string>>(
    LAST_CHAPTER_KEY,
    { defaultValue: {} }
  );

  /** 切换作品时装载结构树，并恢复上次打开的章节。 */
  useEffect(() => {
    if (!root || !currentWorkId) {
      setOutline({ nodes: [] });
      setCurrentChapterId(null);
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
        const remembered = (lastByWork ?? {})[currentWorkId] ?? null;
        const exists = remembered && next.nodes.some((n) => n.id === remembered);
        setCurrentChapterId(exists ? remembered : null);
      })
      .catch((err) => log.error("outline load failed", err));
    return () => {
      alive = false;
    };
      // lastByWork 只在装载时读一次，不作为依赖以免重复装载。
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [root, currentWorkId]);

  /** 记住每部作品最后打开的章节。 */
  useEffect(() => {
    if (!currentWorkId || !currentChapterId) return;
    setLastByWork({ ...(lastByWork ?? {}), [currentWorkId]: currentChapterId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkId, currentChapterId]);

  const reload = useCallback(async () => {
    if (!root || !currentWorkId) return;
    setOutline(await loadOutline(root, currentWorkId));
  }, [root, currentWorkId]);

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

  const value = useMemo<OutlineContextValue>(
    () => ({
      outline,
      currentChapterId,
      chapters,
      volumes,
      setOutline: persist,
      setCurrentChapterId,
      reload,
    }),
    [outline, currentChapterId, chapters, volumes, persist, reload]
  );

  return <OutlineContext.Provider value={value}>{children}</OutlineContext.Provider>;
}
