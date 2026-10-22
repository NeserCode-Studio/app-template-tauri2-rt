/**
 * CodexProvider：工作区级素材库的内存索引与增删改。
 *
 * 素材库属于工作区而非作品，切换作品时条目、关系和提及索引都保持不变。
 * Provider 只维护状态与持久化顺序，界面筛选和编辑草稿留在视图层。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { createLogger } from "@/lib/logger";
import {
  addRelation as addRelationRecord,
  createEntry,
  isV2Migrated,
  loadEntries,
  loadMentions,
  loadRelations,
  loadTypes,
  migrateLegacyWorks,
  migrateToV2,
  removeEntry,
  removeRelation as removeRelationRecord,
  saveEntry,
  saveTypes,
  scanWorkspaceMentions,
  syncChapterMentions as syncMentions,
  type Entry,
  type MentionIndex,
  type MentionScanProgress,
  type Relation,
  type TypeConfig,
} from "@/services/codex";
import { loadWorkspace } from "@/services/workspace";
import { CodexContext, type CodexContextValue } from "./codex";
import { useThemeContext } from "./theme";
import { useWorkspace } from "./workspace";

const log = createLogger("CodexProvider");

const LEGACY_WORKS_FLAG = "codex-works-migrated:";

function byName(a: Entry, b: Entry): number {
  return a.name.localeCompare(b.name, "zh-Hans-CN");
}

function replaceEntry(entries: Entry[], entry: Entry): Entry[] {
  return [...entries.filter((item) => item.id !== entry.id), entry].sort(
    byName
  );
}

export function CodexProvider({ children }: { children: ReactNode }) {
  const { theme } = useThemeContext();
  const { root } = useWorkspace();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [mentions, setMentions] = useState<MentionIndex>({});
  const [typeConfigs, setTypeConfigs] = useState<TypeConfig[]>([]);
  const [currentEntryId, setCurrentEntryId] = useState<string | null>(null);

  const entriesRef = useRef(entries);
  const typesRef = useRef(typeConfigs);
  const pendingSearchRef = useRef<string | null>(null);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    typesRef.current = typeConfigs;
  }, [typeConfigs]);

  const loadAll = useCallback(async () => {
    if (!root) return;
    const [nextEntries, nextTypes, nextRelations, nextMentions] =
      await Promise.all([
        loadEntries(root),
        loadTypes(root),
        loadRelations(root),
        loadMentions(root),
      ]);
    setEntries(nextEntries);
    setTypeConfigs(nextTypes);
    setRelations(nextRelations);
    setMentions(nextMentions);
    setCurrentEntryId((prev) =>
      prev && nextEntries.some((entry) => entry.id === prev) ? prev : null
    );
  }, [root]);

  useEffect(() => {
    if (!root) {
      setEntries([]);
      setRelations([]);
      setMentions({});
      setTypeConfigs([]);
      setCurrentEntryId(null);
      return;
    }

    let alive = true;
    void (async () => {
      const legacyFlag = LEGACY_WORKS_FLAG + root;
      if (!localStorage.getItem(legacyFlag)) {
        try {
          const workspace = await loadWorkspace(root);
          const report = await migrateLegacyWorks(root, [
            ...workspace.order,
            ...workspace.archived,
          ]);
          localStorage.setItem(legacyFlag, JSON.stringify(report));
          if (report.copied) {
            log.info("legacy work codex migrated", {
              copied: report.copied,
              duplicates: report.duplicates.length,
            });
          }
        } catch (err) {
          log.error("legacy work codex migration failed", err);
        }
      }

      if (!isV2Migrated(root)) {
        try {
          const report = await migrateToV2(root);
          log.info("codex v2 migration complete", {
            entries: report.entries,
            relations: report.relations,
          });
        } catch (err) {
          log.error("codex v2 migration failed", err);
        }
      }

      const [nextEntries, nextTypes, nextRelations, nextMentions] =
        await Promise.all([
          loadEntries(root),
          loadTypes(root),
          loadRelations(root),
          loadMentions(root),
        ]);
      if (!alive) return;
      setEntries(nextEntries);
      setTypeConfigs(nextTypes);
      setRelations(nextRelations);
      setMentions(nextMentions);
      setCurrentEntryId((prev) =>
        prev && nextEntries.some((entry) => entry.id === prev) ? prev : null
      );
      log.info("codex loaded", {
        entries: nextEntries.length,
        types: nextTypes.length,
        relations: nextRelations.length,
      });
    })().catch((err) => {
      if (alive) log.error("codex load failed", err);
    });

    return () => {
      alive = false;
    };
  }, [root]);

  const reload = useCallback(async () => {
    await loadAll();
  }, [loadAll]);

  const create = useCallback(
    async (typeId: string, name: string) => {
      if (!root) return null;
      const trimmed = name.trim();
      if (!trimmed) return null;
      if (
        entriesRef.current.some(
          (entry) => entry.typeId === typeId && entry.name.trim() === trimmed
        )
      ) {
        throw new Error("CODEX_DUPLICATE_NAME");
      }
      const entry = await createEntry(root, typeId, trimmed);
      setEntries((prev) => replaceEntry(prev, entry));
      setCurrentEntryId(entry.id);
      return entry;
    },
    [root]
  );

  const save = useCallback(
    async (entry: Entry) => {
      if (!root) return null;
      const saved = await saveEntry(root, entry);
      setEntries((prev) => replaceEntry(prev, saved));
      return saved;
    },
    [root]
  );

  const remove = useCallback(
    async (entryId: string) => {
      if (!root) return;
      await removeEntry(root, entryId);
      setEntries((prev) => prev.filter((entry) => entry.id !== entryId));
      setRelations((prev) =>
        prev.filter(
          (relation) => relation.fromId !== entryId && relation.toId !== entryId
        )
      );
      setMentions((prev) => {
        const next = { ...prev };
        delete next[entryId];
        return next;
      });
      setCurrentEntryId((prev) => (prev === entryId ? null : prev));
    },
    [root]
  );

  const saveType = useCallback(
    async (type: TypeConfig) => {
      if (!root) return null;
      const exists = typesRef.current.some((item) => item.id === type.id);
      const next = (
        exists
          ? typesRef.current.map((item) => (item.id === type.id ? type : item))
          : [...typesRef.current, type]
      ).sort((a, b) => a.order - b.order);
      setTypeConfigs(next);
      await saveTypes(root, next);
      return type;
    },
    [root]
  );

  const createType = useCallback(
    async (input: Parameters<CodexContextValue["createType"]>[0]) => {
      if (!root) return null;
      const label = input.label.trim();
      if (!label) return null;
      const type: TypeConfig = {
        id: `custom-${crypto.randomUUID().slice(0, 8)}`,
        label,
        color: input.color ?? { light: "#64748b", dark: "#cbd5e1" },
        icon: input.icon ?? "shapes",
        fields: [],
        relationVocab: [],
        builtin: false,
        order:
          typesRef.current.reduce(
            (max, item) => Math.max(max, item.order),
            -1
          ) + 1,
      };
      const next = [...typesRef.current, type];
      setTypeConfigs(next);
      await saveTypes(root, next);
      return type;
    },
    [root]
  );

  const removeType = useCallback(
    async (typeId: string) => {
      if (!root) return;
      const type = typesRef.current.find((item) => item.id === typeId);
      if (!type) return;
      if (type.builtin) throw new Error("CODEX_BUILTIN_TYPE");
      if (entriesRef.current.some((entry) => entry.typeId === typeId)) {
        throw new Error("CODEX_TYPE_IN_USE");
      }
      const next = typesRef.current.filter((item) => item.id !== typeId);
      setTypeConfigs(next);
      await saveTypes(root, next);
    },
    [root]
  );

  const addRelation = useCallback(
    async (
      fromId: string,
      toId: string,
      kind: string,
      inverseKind: string,
      note?: string
    ) => {
      if (!root) return null;
      const relation = await addRelationRecord(
        root,
        fromId,
        toId,
        kind.trim(),
        inverseKind.trim(),
        note
      );
      setRelations(await loadRelations(root));
      return relation;
    },
    [root]
  );

  const removeRelation = useCallback(
    async (relationId: string) => {
      if (!root) return;
      await removeRelationRecord(root, relationId);
      setRelations((prev) =>
        prev.filter((relation) => relation.id !== relationId)
      );
    },
    [root]
  );

  const syncChapterMentions = useCallback(
    async (workId: string, chapterId: string, text: string) => {
      if (!root) return;
      const startedAt = performance.now();
      const next = await syncMentions(
        root,
        workId,
        chapterId,
        text,
        entriesRef.current
      );
      const syncedAt = performance.now();
      setMentions(next);
      log.info("chapter mentions refreshed", {
        workId,
        chapterId,
        textChars: text.length,
        entries: Object.keys(next).length,
        syncMs: Math.round(syncedAt - startedAt),
        totalMs: Math.round(performance.now() - startedAt),
      });
    },
    [root]
  );

  const scanAllMentions = useCallback(
    async (onProgress?: (progress: MentionScanProgress) => void) => {
      if (!root) return null;
      const result = await scanWorkspaceMentions(
        root,
        entriesRef.current,
        onProgress
      );
      setMentions(result.index);
      return result.report;
    },
    [root]
  );

  const requestSearch = useCallback((query: string) => {
    pendingSearchRef.current = query.trim() || null;
  }, []);

  const takeSearchRequest = useCallback(() => {
    const query = pendingSearchRef.current;
    pendingSearchRef.current = null;
    return query;
  }, []);

  const byType = useCallback(
    (typeId: string) => entries.filter((entry) => entry.typeId === typeId),
    [entries]
  );

  const typeOf = useCallback(
    (typeId: string) => typeConfigs.find((type) => type.id === typeId) ?? null,
    [typeConfigs]
  );

  const labelOf = useCallback(
    (typeId: string) => {
      const type = typeConfigs.find((item) => item.id === typeId);
      return type?.label.trim() || type?.labelKey || type?.id || typeId;
    },
    [typeConfigs]
  );

  const colorOf = useCallback(
    (typeId: string) => {
      const type = typeConfigs.find((item) => item.id === typeId);
      if (!type) return "#64748b";
      return theme === "dark" ? type.color.dark : type.color.light;
    },
    [typeConfigs, theme]
  );

  const value = useMemo<CodexContextValue>(
    () => ({
      entries,
      relations,
      mentions,
      typeConfigs,
      currentEntryId,
      byType,
      typeOf,
      labelOf,
      colorOf,
      setCurrentEntryId,
      requestSearch,
      takeSearchRequest,
      reload,
      create,
      save,
      remove,
      saveType,
      createType,
      removeType,
      addRelation,
      removeRelation,
      syncChapterMentions,
      scanAllMentions,
    }),
    [
      entries,
      relations,
      mentions,
      typeConfigs,
      currentEntryId,
      byType,
      typeOf,
      labelOf,
      colorOf,
      requestSearch,
      takeSearchRequest,
      reload,
      create,
      save,
      remove,
      saveType,
      createType,
      removeType,
      addRelation,
      removeRelation,
      syncChapterMentions,
      scanAllMentions,
    ]
  );

  return (
    <CodexContext.Provider value={value}>{children}</CodexContext.Provider>
  );
}
