/**
 * 素材库 V2 存储层（计划书 codex-v2.md P0 / P1 / §6 迁移）。
 *
 * 落盘布局：
 *
 *   codex/
 *     types.json          类型定义（字段模板、关系词表、亮暗双套颜色）
 *     entries/<id>.json   条目（不含 relations）
 *     relations.json      关系边集合（有向 + 正反标签）
 *     mentions.json       提及索引（条目 ↔ 章节）
 *     legacy-backup/      V1 → V2 迁移前的整体备份
 *
 * 关系与提及独立成文件的理由见 §3.2：它们都是「两个实体之间的事实」，
 * 塞进任何一边都要复制一份，于是必须做同步——F22 那一串「清单 / 内存 /
 * 磁盘三者不同步」的病根就是"同一个事实存在多处"。独立成文件后只有一个
 * 真相来源，同步在结构上不可能出错。
 */

import { z } from "zod";

import { chapterSchema } from "@/shared/schema";
import { createFs, joinRel } from "../fs";
import {
  codexDir,
  codexEntriesDir,
  codexEntryFileShared,
  codexLegacyBackupDir,
  codexMentionsFile,
  codexRelationsFile,
  codexRootDir,
  codexTypesFile,
  workDir,
} from "../paths";
import { createLogger } from "@/lib/logger";

import {
  BUILTIN_TYPE_SET,
  LEGACY_RELATION_MAP,
  LEGACY_TYPE_MAP,
  defaultBuiltinTypes,
  usesLegacyDefaultColor,
  type BuiltinTypeId,
} from "./builtin";
import {
  WORKSPACE_SCOPE,
  entrySchema,
  fieldValueSchema,
  mentionIndexSchema,
  relationSchema,
  scopeSchema,
  typeConfigSchema,
  type Entry,
  type FieldValue,
  type MentionIndex,
  type MentionRecord,
  type Relation,
  type TypeConfig,
} from "./types";

const log = createLogger("CodexStore");

/* ---------- 类型配置 ---------- */

/**
 * 读取类型配置。
 *
 * 内置九类始终存在——用户在面板里能改名改色改字段，但删不掉内置类型，
 * 否则旧条目的 typeId 会指向不存在的类型。缺失的补出厂值，多余的自定义
 * 类型原样保留。
 */
export async function loadTypes(root: string): Promise<TypeConfig[]> {
  const fs2 = createFs(root);
  const file = codexTypesFile();
  let stored: TypeConfig[] = [];
  if (await fs2.exists(file)) {
    try {
      stored = z
        .array(typeConfigSchema)
        .parse(JSON.parse(await fs2.readText(file)));
    } catch (err) {
      log.error("codex types parse failed, using defaults", err);
      stored = [];
    }
  }

  const defaults = defaultBuiltinTypes();
  const byId = new Map(stored.map((c) => [c.id, c]));
  const merged: TypeConfig[] = [];
  /* 内置类型：出厂字段模板与出厂值兜底，用户改过的部分保留。 */
  for (const d of defaults) {
    const hit = byId.get(d.id);
    byId.delete(d.id);
    if (!hit) {
      merged.push(d);
      continue;
    }
    merged.push({
      ...d,
      ...hit,
      color: usesLegacyDefaultColor(d.id, hit.color) ? d.color : hit.color,
      builtin: true,
      /* 出厂模板是字段的"全集下限"：内置字段受保护，缺失时补回；
       * 用户在 types.json 里新增的自定义字段原样保留。 */
      fields: mergeTemplates(d.fields, hit.fields),
      relationVocab: hit.relationVocab.length
        ? hit.relationVocab
        : d.relationVocab,
    });
  }
  /* 自定义类型：只在文件里出现过的那些。 */
  for (const extra of byId.values()) {
    if (!BUILTIN_TYPE_SET.has(extra.id))
      merged.push({ ...extra, builtin: false });
  }

  merged.sort((a, b) => a.order - b.order);
  await saveTypes(root, merged);
  return merged;
}

/** 字段模板合并：以用户存的为准，出厂新增的补进来。 */
function mergeTemplates(
  defaults: TypeConfig["fields"],
  stored: TypeConfig["fields"]
): TypeConfig["fields"] {
  const defaultsByKey = new Map(defaults.map((field) => [field.key, field]));
  const normalized = stored.map((field) => {
    const fromFactory = defaultsByKey.get(field.key);
    return fromFactory
      ? { ...field, builtin: true }
      : { ...field, builtin: false };
  });
  const seen = new Set(stored.map((f) => f.key));
  const extra = defaults
    .filter((field) => !seen.has(field.key))
    .map((field) => ({ ...field, builtin: true }));
  return [...normalized, ...extra].map((field, index) => ({
    ...field,
    order: index,
  }));
}

/** 保存类型配置。 */
export async function saveTypes(
  root: string,
  types: TypeConfig[]
): Promise<void> {
  const fs2 = createFs(root);
  await fs2.createDir(codexRootDir());
  await fs2.writeText(
    codexTypesFile(),
    JSON.stringify(z.array(typeConfigSchema).parse(types), null, 2)
  );
}

/* ---------- 条目 ---------- */

/**
 * V1 条目 → V2 条目。
 *
 * 读时兜底：旧 `attributes` 裸字符串按 text 读入，旧 `type` 枚举映射到
 * 新内置类型 id，`links` 并入关系后清空（关系由迁移脚本单独抽出，
 * 这里不重复处理）。保存时写新格式，渐进迁移。
 */
export function migrateEntry(raw: Record<string, unknown>): Entry {
  const now = Date.now();
  const typeId =
    typeof raw.typeId === "string"
      ? raw.typeId
      : (LEGACY_TYPE_MAP[String(raw.type ?? "")] ?? "term");

  /* fields 已是 V2 union；attributes 则把 V1 裸字符串渐进而非破坏地升级。 */
  const fields: Record<string, FieldValue> = {};
  const storedFields = (raw.fields ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(storedFields)) {
    const parsed = fieldValueSchema.safeParse(value);
    if (parsed.success) fields[key] = parsed.data;
  }
  const attrs = (raw.attributes ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(attrs)) {
    if (fields[key]) continue;
    const parsed = fieldValueSchema.safeParse(value);
    if (parsed.success) {
      fields[key] = parsed.data;
      continue;
    }
    if (typeof value === "string" || typeof value === "number") {
      fields[key] = { kind: "text", value: String(value) };
    }
  }

  /* V1 只有一个 body，摘要与正文混用（§1 第 8 条）。
   * 拆分规则：短句整体作摘要，长文本取第一句作摘要、其余留在正文。
   * 写死一个阈值而不是让用户先手工整理——迁移要的是无感。 */
  const body = typeof raw.body === "string" ? raw.body : "";
  const { summary, detail } = splitSummary(body);
  const scope = scopeSchema.safeParse(raw.scope);

  return entrySchema.parse({
    id: typeof raw.id === "string" ? raw.id : crypto.randomUUID(),
    typeId,
    name: typeof raw.name === "string" ? raw.name : "",
    aliases: toStringArray(raw.aliases),
    tags: toStringArray(raw.tags),
    summary: typeof raw.summary === "string" ? raw.summary : summary,
    body: typeof raw.detail === "string" ? raw.detail : detail,
    fields,
    scope: scope.success ? scope.data : WORKSPACE_SCOPE,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
  });
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === "string")
    : [];
}

/** 摘要 / 正文拆分。 */
function splitSummary(body: string): { summary: string; detail: string } {
  const trimmed = body.trim();
  if (!trimmed) return { summary: "", detail: "" };
  if (trimmed.length <= 40) return { summary: trimmed, detail: "" };
  /* 第一段或第一句作摘要。 */
  const nl = trimmed.indexOf("\n");
  if (nl > 0 && nl <= 60) {
    return {
      summary: trimmed.slice(0, nl).trim(),
      detail: trimmed.slice(nl).trim(),
    };
  }
  const m = trimmed.slice(0, 80).search(/[。！？!?]/);
  if (m > 0) {
    const cut = m + 1;
    return {
      summary: trimmed.slice(0, cut).trim(),
      detail: trimmed.slice(cut).trim(),
    };
  }
  return {
    summary: trimmed.slice(0, 60).trim(),
    detail: trimmed.slice(60).trim(),
  };
}

/** 读取单个条目；解析失败只记日志并返回 null。 */
export async function loadEntry(
  root: string,
  entryId: string
): Promise<Entry | null> {
  const fs2 = createFs(root);
  const file = codexEntryFileShared(entryId);
  if (!(await fs2.exists(file))) return null;
  try {
    const raw = JSON.parse(await fs2.readText(file)) as Record<string, unknown>;
    return migrateEntry(raw);
  } catch (err) {
    log.error("codex entry parse failed", entryId, err);
    return null;
  }
}

/** 装载全部条目。单条坏数据只跳过该条，不让整个素材库加载失败。 */
export async function loadEntries(root: string): Promise<Entry[]> {
  const fs2 = createFs(root);
  const dir = codexEntriesDir();
  if (!(await fs2.exists(dir))) return [];
  const names = await fs2.readDir(dir);
  const out: Entry[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const entry = await loadEntry(root, name.slice(0, -".json".length));
    if (entry) out.push(entry);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
}

/** 保存条目。 */
export async function saveEntry(root: string, entry: Entry): Promise<Entry> {
  const fs2 = createFs(root);
  const validated = entrySchema.parse({ ...entry, updatedAt: Date.now() });
  await fs2.createDir(codexEntriesDir());
  await fs2.writeText(
    codexEntryFileShared(validated.id),
    JSON.stringify(validated, null, 2)
  );
  return validated;
}

/** 新建并保存条目。 */
export async function createEntry(
  root: string,
  typeId: string,
  name: string
): Promise<Entry> {
  const now = Date.now();
  return saveEntry(
    root,
    entrySchema.parse({
      id: crypto.randomUUID(),
      typeId,
      name,
      scope: WORKSPACE_SCOPE,
      createdAt: now,
      updatedAt: now,
    })
  );
}

/**
 * 删除条目，并清掉指向它的关系边与提及记录。
 *
 * 悬空边允许存在（读取时跳过），但删除是用户明确的动作，顺手清干净
 * 比留给深度扫描更省事。
 */
export async function removeEntry(
  root: string,
  entryId: string
): Promise<void> {
  const fs2 = createFs(root);
  await fs2.remove(codexEntryFileShared(entryId));

  const relations = await loadRelations(root);
  const kept = relations.filter(
    (r) => r.fromId !== entryId && r.toId !== entryId
  );
  if (kept.length !== relations.length) await saveRelations(root, kept);

  const mentions = await loadMentions(root);
  delete mentions[entryId];
  await saveMentions(root, mentions);
}

/* ---------- 关系 ---------- */

/** 读取关系边集合。 */
export async function loadRelations(root: string): Promise<Relation[]> {
  const fs2 = createFs(root);
  const file = codexRelationsFile();
  if (!(await fs2.exists(file))) return [];
  try {
    const raw = JSON.parse(await fs2.readText(file)) as unknown;
    /* 兼容两种形状：{ relations: [...] } 与裸数组。 */
    const list = Array.isArray(raw)
      ? raw
      : ((raw as { relations?: unknown }).relations ?? []);
    return z.array(relationSchema).parse(list);
  } catch (err) {
    log.error("codex relations parse failed", err);
    return [];
  }
}

/** 保存关系边集合。 */
export async function saveRelations(
  root: string,
  relations: Relation[]
): Promise<void> {
  const fs2 = createFs(root);
  await fs2.createDir(codexRootDir());
  const validated = z.array(relationSchema).parse(relations);
  await fs2.writeText(
    codexRelationsFile(),
    JSON.stringify({ relations: validated }, null, 2)
  );
}

/** 建一条边。正反标签成对存在，反向语义不再丢失。 */
export async function addRelation(
  root: string,
  fromId: string,
  toId: string,
  kind: string,
  inverseKind: string,
  note?: string
): Promise<Relation> {
  const relations = await loadRelations(root);
  /* 同一对条目之间只保留一条边：关系是有向的，但要换标签而不是并排两条。 */
  const existing = relations.find(
    (r) =>
      (r.fromId === fromId && r.toId === toId) ||
      (r.fromId === toId && r.toId === fromId)
  );
  if (existing) {
    const next = relations.map((r) =>
      r.id === existing.id ? { ...r, fromId, toId, kind, inverseKind, note } : r
    );
    await saveRelations(root, next);
    return next.find((r) => r.id === existing.id)!;
  }
  const relation = relationSchema.parse({
    id: crypto.randomUUID(),
    fromId,
    toId,
    kind,
    inverseKind,
    note,
    order: relations.length,
  });
  await saveRelations(root, [...relations, relation]);
  return relation;
}

/** 删一条边（不分方向）。 */
export async function removeRelation(
  root: string,
  relationId: string
): Promise<void> {
  const relations = await loadRelations(root);
  await saveRelations(
    root,
    relations.filter((r) => r.id !== relationId)
  );
}

/**
 * 取某条目的全部关系，分出正向与反向两组。
 *
 * 正向用 `kind`，反向用 `inverseKind`——所以「A 持有 B」在 A 那边显示
 * 「持有」，在 B 那边显示「持有者」，不再是恒定的「提及」。
 */
export function relationsOf(
  relations: Relation[],
  entryId: string
): { outgoing: Relation[]; incoming: Relation[] } {
  return {
    outgoing: relations.filter((r) => r.fromId === entryId),
    incoming: relations.filter((r) => r.toId === entryId),
  };
}

/* ---------- 提及索引 ---------- */

/** 读取提及索引。 */
export async function loadMentions(root: string): Promise<MentionIndex> {
  const fs2 = createFs(root);
  const file = codexMentionsFile();
  if (!(await fs2.exists(file))) return {};
  try {
    return mentionIndexSchema.parse(JSON.parse(await fs2.readText(file)));
  } catch (err) {
    log.error("codex mentions parse failed", err);
    return {};
  }
}

/** 保存提及索引。 */
export async function saveMentions(
  root: string,
  index: MentionIndex
): Promise<void> {
  const fs2 = createFs(root);
  await fs2.createDir(codexRootDir());
  await fs2.writeText(
    codexMentionsFile(),
    JSON.stringify(mentionIndexSchema.parse(index), null, 2)
  );
}

/** 统计某个词在文本里的非重叠出现次数。 */
function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at < 0) break;
    count += 1;
    from = at + needle.length;
  }
  return count;
}

/**
 * 同步一章的提及记录（计划书 §3.7）。
 *
 * 卡片提交时与保存走同一条管道，命中即写；正文改写后旧记录必须先清掉
 * 再重算，否则删掉的名字会一直留在「出场章节」里。
 *
 * 别名冲突视为不匹配（§4.4）：两个条目共用别名时静默高亮其中一个，
 * 用户永远不知道自己看到的是哪一个。
 */
export async function syncChapterMentions(
  root: string,
  workId: string,
  chapterId: string,
  text: string,
  entries: Entry[]
): Promise<void> {
  /* 名称 / 别名 → 条目 id。同一词指向多条时标记为歧义，不计数。 */
  const nameToIds = new Map<string, string[]>();
  const push = (word: string, id: string) => {
    const key = word.trim();
    if (!key) return;
    nameToIds.set(key, [...(nameToIds.get(key) ?? []), id]);
  };
  for (const e of entries) {
    push(e.name, e.id);
    for (const alias of e.aliases) push(alias, e.id);
  }

  const counts = new Map<string, number>();
  for (const [word, ids] of nameToIds) {
    if (ids.length > 1) continue;
    const n = countOccurrences(text, word);
    if (n > 0) counts.set(ids[0], (counts.get(ids[0]) ?? 0) + n);
  }

  const index = await loadMentions(root);
  let dirty = false;
  const now = Date.now();

  /* 清掉本章的旧记录。 */
  for (const [entryId, records] of Object.entries(index)) {
    const kept = records.filter(
      (r) => !(r.chapterId === chapterId && r.workId === workId)
    );
    if (kept.length !== records.length) {
      dirty = true;
      if (kept.length) index[entryId] = kept;
      else delete index[entryId];
    }
  }

  /* 写入本章的新记录，firstSeenAt 沿用旧值以免每次保存都跳动。 */
  for (const [entryId, count] of counts) {
    const records = index[entryId] ?? [];
    const prev = records.find(
      (r) => r.chapterId === chapterId && r.workId === workId
    );
    const record: MentionRecord = {
      workId,
      chapterId,
      count,
      firstSeenAt: prev?.firstSeenAt ?? now,
    };
    index[entryId] = [
      ...records.filter(
        (r) => r.chapterId !== chapterId || r.workId !== workId
      ),
      record,
    ];
    dirty = true;
  }

  if (dirty) await saveMentions(root, index);
}

/** 某个条目出现在哪几章（按记录时间倒序）。 */
export function chaptersOf(
  index: MentionIndex,
  entryId: string
): MentionRecord[] {
  return [...(index[entryId] ?? [])].sort(
    (a, b) => b.firstSeenAt - a.firstSeenAt
  );
}

/** 读取提及记录对应的章标题，供详情面板和跨作品跳转使用。 */
export async function loadMentionChapterTitles(
  root: string,
  records: MentionRecord[]
): Promise<Record<string, string>> {
  const fs2 = createFs(root);
  const pairs = await Promise.all(
    records.map(async (record) => {
      const key = `${record.workId}:${record.chapterId}`;
      try {
        const raw = JSON.parse(
          await fs2.readText(
            joinRel(
              "works",
              record.workId,
              "chapters",
              `${record.chapterId}.json`
            )
          )
        );
        const parsed = chapterSchema.safeParse(raw);
        return [key, parsed.success ? parsed.data.title : ""] as const;
      } catch {
        return [key, ""] as const;
      }
    })
  );
  return Object.fromEntries(pairs);
}

/* ---------- V1 → V2 迁移 ---------- */

export interface MigrationReport {
  /** 迁移了多少条目。 */
  entries: number;
  /** 抽出多少条关系边。 */
  relations: number;
  /** 同名条目疑似重复，未合并，列出来给用户人工判断。 */
  duplicates: { typeId: string; name: string; ids: string[] }[];
  /** 是否已做过备份。 */
  backedUp: boolean;
}

/** 迁移标记按工作区根路径存，避免每次启动重扫。 */
const V2_FLAG = "codex-v2-migrated:";

/** 本工作区是否已完成 V2 迁移。 */
export function isV2Migrated(root: string): boolean {
  return localStorage.getItem(V2_FLAG + root) !== null;
}

/**
 * V1 → V2 一次性迁移（计划书 §6）。
 *
 * 顺序很要紧：**先备份，再改写**。备份失败就整个中止，
 * 宁可停在旧结构也不能在没有兜底的情况下动用户数据。
 */
export async function migrateToV2(root: string): Promise<MigrationReport> {
  const fs2 = createFs(root);
  if (!(await fs2.exists(codexEntriesDir()))) {
    /* 没有旧数据：只把出厂类型落盘即可。 */
    await saveTypes(root, defaultBuiltinTypes());
    localStorage.setItem(V2_FLAG + root, "1");
    return { entries: 0, relations: 0, duplicates: [], backedUp: false };
  }

  /* 1. 备份旧结构。 */
  const backedUp = await backupLegacy(root);
  if (!backedUp) {
    log.error("codex v2 migration aborted: backup failed");
    throw new Error("backup failed");
  }

  /* 2. 读旧条目并转换。 */
  const names = (await fs2.readDir(codexEntriesDir())).filter((n) =>
    n.endsWith(".json")
  );
  const entries: Entry[] = [];
  const legacyEdges: { fromId: string; toId: string; kind: string }[] = [];
  const typeById = new Map<string, string>();

  for (const name of names) {
    const id = name.slice(0, -".json".length);
    try {
      const raw = JSON.parse(
        await fs2.readText(codexEntryFileShared(id))
      ) as Record<string, unknown>;
      const entry = migrateEntry(raw);
      entries.push(entry);
      typeById.set(entry.id, entry.typeId);
      /* 收集旧关系：relations 与 links 都要。 */
      const rels = Array.isArray(raw.relations)
        ? (raw.relations as Record<string, unknown>[])
        : [];
      for (const r of rels) {
        if (typeof r.targetId === "string") {
          legacyEdges.push({
            fromId: entry.id,
            toId: r.targetId,
            kind: typeof r.kind === "string" ? r.kind : "mentions",
          });
        }
      }
      for (const target of toStringArray(raw.links)) {
        legacyEdges.push({ fromId: entry.id, toId: target, kind: "mentions" });
      }
    } catch (err) {
      log.error("codex v2 entry migrate failed", name, err);
    }
  }

  /* 3. 去重并转成 V2 边。 */
  const relations = convertLegacyEdges(legacyEdges, typeById);

  /* 4. 落盘。 */
  for (const entry of entries) {
    await fs2.writeText(
      codexEntryFileShared(entry.id),
      JSON.stringify(entry, null, 2)
    );
  }
  await saveRelations(root, relations);
  await saveTypes(root, defaultBuiltinTypes());

  /* 5. 同名疑似重复只报告，不合并（「林风」在两本书里未必同一人）。 */
  const byName = new Map<string, string[]>();
  for (const e of entries) {
    const key = `${e.typeId}\u0000${e.name.trim()}`;
    byName.set(key, [...(byName.get(key) ?? []), e.id]);
  }
  const duplicates: MigrationReport["duplicates"] = [];
  for (const [key, ids] of byName) {
    if (ids.length < 2) continue;
    const [typeId, ...rest] = key.split("\u0000");
    duplicates.push({ typeId, name: rest.join("\u0000"), ids });
  }

  localStorage.setItem(V2_FLAG + root, "1");
  log.info("codex v2 migration done", {
    entries: entries.length,
    relations: relations.length,
  });
  return {
    entries: entries.length,
    relations: relations.length,
    duplicates,
    backedUp,
  };
}

/**
 * 备份旧结构到 codex/legacy-backup/。
 *
 * fs 桥没有复制命令，素材库全是小 JSON，逐文件读写即可。
 */
async function backupLegacy(root: string): Promise<boolean> {
  const fs2 = createFs(root);
  const dest = codexLegacyBackupDir();
  try {
    await fs2.createDir(dest);
    if (await fs2.exists(codexTypesFile())) {
      await fs2.writeText(
        joinRel(dest, "types.json"),
        await fs2.readText(codexTypesFile())
      );
    }
    const names = (await fs2.readDir(codexEntriesDir())).filter((n) =>
      n.endsWith(".json")
    );
    await fs2.createDir(joinRel(dest, "entries"));
    for (const name of names) {
      await fs2.writeText(
        joinRel(dest, "entries", name),
        await fs2.readText(codexEntryFileShared(name.slice(0, -5)))
      );
    }
    return true;
  } catch (err) {
    log.error("codex backup failed", err);
    return false;
  }
}

/**
 * V1 的「两端各存一条」边转成 V2 单条有向边。
 *
 * V1 的 `syncRelations` 给对端补的反向边 kind 恒为 "mentions"，
 * 所以每一对条目在磁盘上有两条边，其中**非 mentions 的那条才是用户
 * 真正建立的关系**。用它定方向，两条都是 mentions 时按 id 定序，
 * 保证迁移结果与磁盘顺序无关。
 */
function convertLegacyEdges(
  edges: { fromId: string; toId: string; kind: string }[],
  typeById: Map<string, string>
): Relation[] {
  const byPair = new Map<
    string,
    { fromId: string; toId: string; kind: string }[]
  >();
  for (const e of edges) {
    if (e.fromId === e.toId) continue;
    const key = [e.fromId, e.toId].sort().join("\u0000");
    byPair.set(key, [...(byPair.get(key) ?? []), e]);
  }

  const out: Relation[] = [];
  for (const group of byPair.values()) {
    const primary =
      group.find((e) => e.kind !== "mentions") ??
      group.slice().sort((a, b) => a.fromId.localeCompare(b.fromId))[0];
    const [kind, inverseKind] = LEGACY_RELATION_MAP[primary.kind] ?? [
      "关联",
      "关联",
    ];
    out.push(
      relationSchema.parse({
        id: crypto.randomUUID(),
        fromId: primary.fromId,
        toId: primary.toId,
        kind,
        inverseKind: refineInverse(inverseKind, typeById.get(primary.toId)),
        order: out.length,
      })
    );
  }
  return out;
}

/**
 * 按目标类型微调反向标签。
 *
 * V1 的「属于」在人物侧读作「属于」，但在势力侧应该是「成员」——
 * 反向标签正是为了这个存在的，不能全用一个词糊过去。
 */
function refineInverse(
  inverse: string,
  targetTypeId: string | undefined
): string {
  if (inverse === "属于" && targetTypeId === "faction") return "成员";
  if (inverse === "持有者" && targetTypeId === "item") return "持有者";
  return inverse;
}

/* ---------- 更早的迁移：works/<id>/codex → 工作区 codex ---------- */

export interface LegacyWorksReport {
  perWork: { workId: string; type: string; count: number }[];
  copied: number;
  duplicates: { typeId: string; name: string; ids: string[] }[];
}

/**
 * 把旧的「每部作品一套素材库」汇总到工作区级（F9）。
 *
 * 只复制不删除：旧数据留着，用户确认新库可用后可自行清理。
 * 同名不同 id 的条目不自动合并——按名字合并会静默毁掉设定。
 */
export async function migrateLegacyWorks(
  root: string,
  workIds: string[]
): Promise<LegacyWorksReport> {
  const fs2 = createFs(root);
  const perWork: LegacyWorksReport["perWork"] = [];
  const staged: { entry: Entry; type: string }[] = [];

  for (const workId of workIds) {
    if (!(await fs2.exists(workDir(workId)))) continue;
    for (const type of Object.keys(LEGACY_TYPE_MAP)) {
      const dir = codexDir(workId, type);
      if (!(await fs2.exists(dir))) continue;
      const names = await fs2.readDir(dir);
      let count = 0;
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        try {
          const raw = JSON.parse(
            await fs2.readText(`${dir}/${name}`)
          ) as Record<string, unknown>;
          staged.push({
            entry: migrateEntry({ ...raw, type: (raw.type as string) ?? type }),
            type,
          });
          count += 1;
        } catch (err) {
          log.error("legacy codex entry parse failed", workId, type, name, err);
        }
      }
      if (count) perWork.push({ workId, type, count });
    }
  }

  await fs2.createDir(codexEntriesDir());
  const existing = new Set((await loadEntries(root)).map((e) => e.id));
  let copied = 0;
  for (const { entry } of staged) {
    if (existing.has(entry.id)) continue;
    existing.add(entry.id);
    await fs2.writeText(
      codexEntryFileShared(entry.id),
      JSON.stringify(entry, null, 2)
    );
    copied += 1;
  }

  const byName = new Map<string, string[]>();
  for (const e of await loadEntries(root)) {
    const key = `${e.typeId}\u0000${e.name.trim()}`;
    byName.set(key, [...(byName.get(key) ?? []), e.id]);
  }
  const duplicates: LegacyWorksReport["duplicates"] = [];
  for (const [key, ids] of byName) {
    if (ids.length < 2) continue;
    const [typeId, ...rest] = key.split("\u0000");
    duplicates.push({ typeId, name: rest.join("\u0000"), ids });
  }

  log.info("codex legacy works migration done", {
    works: workIds.length,
    copied,
  });
  return { perWork, copied, duplicates };
}

/** 自定义类型的 id：内置前缀之外的自建类型。 */
export function isBuiltinType(typeId: string): boolean {
  return BUILTIN_TYPE_SET.has(typeId);
}

export type { BuiltinTypeId };
