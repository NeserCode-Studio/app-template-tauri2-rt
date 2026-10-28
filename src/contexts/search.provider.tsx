/**
 * SearchProvider：维护全站搜索索引。
 *
 * 当前打开的作品走内存索引（章标题常驻、正文按需读并缓存）；
 * 其余作品走磁盘直扫。磁盘直扫每次查询都要读文件，因此这里做了
 * 两重限制：调用方必须防抖，且单作品扫描有命中上限。
 */

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";

import { SearchContext, type SearchContextValue } from "./search";
import { useWorkspace } from "./workspace";
import { useLibrary } from "./library";
import { useOutline } from "./outline";
import { useCodex } from "./codex";
import { SearchIndex, MAX_HITS, searchWork } from "@/services/search";
import { createLogger } from "@/lib/logger";

const log = createLogger("SearchProvider");

/** 磁盘直扫的作品数上限：作品数可能很多，全扫会拖垮每次按键。 */
const MAX_SCANNED_WORKS = 8;

export function SearchProvider({ children }: { children: ReactNode }) {
  const { root } = useWorkspace();
  const { currentWorkId, works, workspace } = useLibrary();
  const { chapters } = useOutline();
  const { entries } = useCodex();

  const indexRef = useRef(new SearchIndex());
  const workTitle = currentWorkId ? works[currentWorkId]?.title ?? "" : "";

  /* 结构树变化时重建章条目。 */
  useEffect(() => {
    if (!currentWorkId) return;
    indexRef.current.syncChapters(
      chapters.map((c) => ({ id: c.id, title: c.title })),
      currentWorkId,
      workTitle
    );
  }, [chapters, currentWorkId, workTitle]);

  /* 素材条目变化时替换 codex 段。 */
  useEffect(() => {
    indexRef.current.syncCodex(entries);
  }, [entries]);

  const search = useCallback(
    async (query: string) => {
      const q = query.trim();
      if (!root || !q) return [];

      const current = await indexRef.current.search(root, q);
      if (!workspace || !root) return current;

      /*
       * 其余作品磁盘直扫。命中上限给当前作品让位：用户多半在写当前这部，
       * 跨作品命中是补充而不是主体。
       */
      const others = [...workspace.order, ...workspace.archived].filter(
        (id) => id !== currentWorkId
      );
      if (!others.length) return current;

      const scanned = await Promise.all(
        others.slice(0, MAX_SCANNED_WORKS).map((id) =>
          searchWork(root, id, works[id]?.title ?? "", q, Math.floor(MAX_HITS / 2)).catch(
            (err) => {
              log.warn("searchWork failed", id, err);
              return [];
            }
          )
        )
      );
      return [...current, ...scanned.flat()].slice(0, MAX_HITS);
    },
    [root, currentWorkId, workspace, works]
  );

  const value = useMemo<SearchContextValue>(() => ({ search }), [search]);
  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}
