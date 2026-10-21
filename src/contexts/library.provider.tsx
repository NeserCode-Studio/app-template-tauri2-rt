/**
 * LibraryProvider：作品库状态与操作。
 *
 * 所有写操作都委托给 services/workspace，本组件只负责
 * 把磁盘结果同步回 React state，并在 root 变化时重新装载。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "./workspace";
import { LibraryContext, type LibraryContextValue } from "./library";
import { createLogger } from "@/lib/logger";
import {
  loadWorkspace,
  loadWork,
  saveWork,
  saveWorkspace,
  createWork,
  archiveWork,
  unarchiveWork,
  deleteWork,
} from "@/services/workspace";
import type { Work, Workspace } from "@/shared/schema";
import { workspaceSchema } from "@/shared/schema";
import { WORKS_DIR } from "@/services/paths";
import { createFs } from "@/services/fs";

const log = createLogger("LibraryProvider");
const CURRENT_WORK_KEY = "novels-yes:current-work-by-workspace";

function readCurrentWorkMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(CURRENT_WORK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (item): item is [string, string] => typeof item[1] === "string"
      )
    );
  } catch {
    return {};
  }
}

function persistCurrentWork(root: string, workId: string | null): void {
  const all = readCurrentWorkMap();
  if (workId) all[root] = workId;
  else delete all[root];
  localStorage.setItem(CURRENT_WORK_KEY, JSON.stringify(all));
}

/** 从磁盘重新装载清单与全部作品元数据。 */
async function reloadAll(root: string) {
  const ws = await loadWorkspace(root);
  const fs2 = createFs(root);
  const works: Record<string, Work> = {};
  // 按清单顺序逐个读元数据；单部读失败不影响其它作品。
  const ids = [...ws.order, ...ws.archived];
  for (const id of ids) {
    try {
      works[id] = await loadWork(root, id);
    } catch (err) {
      log.warn("work meta unreadable, skipping", id, err);
    }
  }
  // 兜底：目录里存在但清单里没有的作品也列出来。
  const dirNames = (await fs2.exists(WORKS_DIR))
    ? await fs2.readDir(WORKS_DIR)
    : [];
  for (const name of dirNames) {
    if (works[name]) continue;
    try {
      works[name] = await loadWork(root, name);
    } catch {
      /* 目录内非作品文件，忽略 */
    }
  }
  return { ws, works };
}

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const { root } = useWorkspace();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loadedRoot, setLoadedRoot] = useState<string | null>(null);
  const [works, setWorks] = useState<Record<string, Work>>({});
  const [currentWorkId, setCurrentWorkIdState] = useState<string | null>(() =>
    root ? (readCurrentWorkMap()[root] ?? null) : null
  );
  /** 磁盘数据版本：见 LibraryContextValue.dataVersion 的说明。 */
  const [dataVersion, setDataVersion] = useState(0);
  const bumpDataVersion = useCallback(() => setDataVersion((v) => v + 1), []);

  /** root 变化时重装；root 为 null 时清空。 */
  useEffect(() => {
    if (!root) {
      setWorkspace(null);
      setLoadedRoot(null);
      setWorks({});
      setCurrentWorkIdState(null);
      return;
    }
    setLoadedRoot(null);
    let alive = true;
    reloadAll(root)
      .then(({ ws, works: list }) => {
        if (!alive) return;
        setWorkspace(ws);
        setLoadedRoot(root);
        setWorks(list);
        const remembered = readCurrentWorkMap()[root];
        const restored = remembered && list[remembered] ? remembered : null;
        setCurrentWorkIdState(restored);
        if (remembered && !restored) persistCurrentWork(root, null);
        log.info("library loaded", { works: Object.keys(list).length });
      })
      .catch((err) => {
        log.error("library load failed", err);
      });
    return () => {
      alive = false;
    };
  }, [root]);

  const setCurrentWorkId = useCallback(
    (id: string | null) => {
      setCurrentWorkIdState(id);
      if (root) persistCurrentWork(root, id);
    },
    [root]
  );

  const refresh = useCallback(async () => {
    if (!root) return;
    const { ws, works: list } = await reloadAll(root);
    setWorkspace(ws);
    setWorks(list);
  }, [root]);

  /**
   * 设置工作区别名。
   *
   * 别名只写进 novels-yes.json，不动磁盘上的目录名：改目录名会波及
   * 该路径下的全部文件，而用户想改的往往只是显示名。
   */
  const setWorkspaceAlias = useCallback(
    async (alias: string) => {
      if (!root) return;
      const base = workspace ?? (await loadWorkspace(root));
      const next = workspaceSchema.parse({ ...base, alias: alias.trim() });
      await saveWorkspace(root, next);
      setWorkspace(next);
    },
    [root, workspace]
  );

  const create = useCallback(
    async (
      title: string,
      type: string,
      synopsis = "",
      autoParagraph = true
    ): Promise<Work | null> => {
      // workspace 可能尚未装载完成（如刚选完工作区就点新建），
      // 此时直接读盘拿到最新清单，而不是静默返回 null。
      if (!root) return null;
      const base = workspace ?? (await loadWorkspace(root));
      const { ws: nextWs, work } = await createWork(
        root,
        base,
        title,
        type,
        synopsis,
        autoParagraph
      );
      setWorkspace(nextWs);
      setWorks((prev) => ({ ...prev, [work.id]: work }));
      setCurrentWorkId(work.id);
      return work;
    },
    [root, workspace, setCurrentWorkId]
  );

  const updateWork = useCallback(
    async (
      workId: string,
      changes: Partial<
        Pick<Work, "title" | "type" | "synopsis" | "autoParagraph">
      >
    ) => {
      if (!root) return null;
      const current = works[workId];
      if (!current) return null;
      const next: Work = { ...current, ...changes };
      const saved = await saveWork(root, next);
      setWorks((prev) => ({ ...prev, [workId]: saved }));
      return saved;
    },
    [root, works]
  );

  const archive = useCallback(
    async (workId: string) => {
      if (!root) return;
      const base = workspace ?? (await loadWorkspace(root));
      const nextWs = await archiveWork(root, base, workId);
      setWorkspace(nextWs);
      setWorks((prev) => {
        const next = { ...prev };
        const w = next[workId];
        if (w) next[workId] = { ...w, archived: true };
        return next;
      });
      if (currentWorkId === workId) setCurrentWorkId(null);
    },
    [root, workspace, currentWorkId, setCurrentWorkId]
  );

  const unarchive = useCallback(
    async (workId: string) => {
      if (!root) return;
      const base = workspace ?? (await loadWorkspace(root));
      const nextWs = await unarchiveWork(root, base, workId);
      setWorkspace(nextWs);
      setWorks((prev) => {
        const next = { ...prev };
        const w = next[workId];
        if (w) next[workId] = { ...w, archived: false };
        return next;
      });
    },
    [root, workspace]
  );

  /** 删除作品：整部目录进回收站，清单里摘除。 */
  const remove = useCallback(
    async (workId: string) => {
      if (!root) return;
      const base = workspace ?? (await loadWorkspace(root));
      const nextWs = await deleteWork(
        root,
        base,
        workId,
        works[workId]?.title ?? workId
      );
      setWorkspace(nextWs);
      setWorks((prev) => {
        const next = { ...prev };
        delete next[workId];
        return next;
      });
      if (currentWorkId === workId) setCurrentWorkId(null);
    },
    [root, workspace, works, currentWorkId, setCurrentWorkId]
  );

  const value = useMemo<LibraryContextValue>(
    () => ({
      workspace,
      loadedRoot,
      currentWorkId,
      works,
      setWorkspace,
      setWorks,
      setCurrentWorkId,
      refresh,
      dataVersion,
      bumpDataVersion,
      setWorkspaceAlias,
      create,
      updateWork,
      archive,
      unarchive,
      remove,
    }),
    [
      workspace,
      loadedRoot,
      currentWorkId,
      works,
      refresh,
      dataVersion,
      bumpDataVersion,
      setWorkspaceAlias,
      create,
      updateWork,
      archive,
      unarchive,
      remove,
      setCurrentWorkId,
    ]
  );

  return (
    <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>
  );
}
