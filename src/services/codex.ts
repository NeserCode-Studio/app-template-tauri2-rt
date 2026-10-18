/**
 * 素材库服务：人物 / 地点 / 物品等类型化条目。
 *
 * 素材库挂在工作区根（`codex/`），与 `works/` 同级而非作品内部：
 * 同一个人物、地点往往横跨多部作品，按作品各存一套必然分裂。
 * 落盘布局：
 *
 *   codex/
 *     types.json            类型定义（名称、字段、高亮颜色）
 *     entries/<id>.json     条目，类型记在条目内
 *
 * 条目 relations 是"两端各存一条"的：写入时同步补目标条目的反向边，
 * 避免"谁关联谁"取决于从哪一侧点开。
 */

import { z } from "zod";

import { createFs } from "./fs";
import {
  codexDir,
  codexEntriesDir,
  codexEntryFileShared,
  codexRootDir,
  codexTypesFile,
  workDir,
} from "./paths";
import { createLogger } from "@/lib/logger";

const log = createLogger("CodexService");

export const CODEX_TYPES = ["character", "place", "item", "faction", "timeline", "concept"] as const;
export type CodexType = (typeof CODEX_TYPES)[number];

/** 关系种类：所属 / 持有 / 敌对 / 亲属 / 提及。 */
export const RELATION_KINDS = ["belongs", "holds", "opposes", "kin", "mentions"] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/** 条目间关系的一端。 */
export const codexRelationSchema = z.object({
  targetId: z.string().uuid(),
  kind: z.enum(RELATION_KINDS).default("mentions"),
});

export type CodexRelation = z.infer<typeof codexRelationSchema>;

export const codexEntrySchema = z.object({
  id: z.string().uuid(),
  type: z.enum(CODEX_TYPES),
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  body: z.string().default(""),
  /** 类型自定义字段（人物=身份/年龄，物品=持有者/状态…）。 */
  attributes: z.record(z.string(), z.string()).default({}),
  /** 关联的其他条目。 */
  relations: z.array(codexRelationSchema).default([]),
  /** 兼容旧数据的裸 id 列表，读入时并入 relations 后清空。 */
  links: z.array(z.string()).default([]),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export type CodexEntry = z.infer<typeof codexEntrySchema>;

/** 类型自定义字段的声明。 */
export const codexFieldSchema = z.object({
  key: z.string(),
  /** i18n key，形如 `Codex.field.character.age`。 */
  labelKey: z.string(),
});

export type CodexField = z.infer<typeof codexFieldSchema>;

/**
 * 类型定义：显示名、高亮颜色、自定义字段。
 *
 * 颜色存在类型上而不是条目上：用户要的是"每种素材一种颜色"，
 * 逐条目设置只会把正文高亮变成一片杂色。
 */
export const codexTypeConfigSchema = z.object({
  id: z.enum(CODEX_TYPES),
  /** i18n key，形如 `Codex.type.character`。 */
  labelKey: z.string(),
  /** 高亮色（#rrggbb）。正文 mention 高亮与库内色点共用。 */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "expected #rrggbb")
    .default("#7c3aed"),
  fields: z.array(codexFieldSchema).default([]),
});

export type CodexTypeConfig = z.infer<typeof codexTypeConfigSchema>;

/** 默认高亮色：同色系深浅拉开，暗色模式下也不至于糊成一团。 */
export const DEFAULT_CODEX_COLORS: Record<CodexType, string> = {
  character: "#7c3aed",
  place: "#0ea5e9",
  item: "#f59e0b",
  faction: "#ef4444",
  timeline: "#10b981",
  concept: "#64748b",
};

/** 默认字段：只放真正高频的几项，其余走正文。 */
export const DEFAULT_CODEX_FIELDS: Partial<Record<CodexType, CodexField[]>> = {
  character: [
    { key: "identity", labelKey: "Codex.field.character.identity" },
    { key: "age", labelKey: "Codex.field.character.age" },
    { key: "goal", labelKey: "Codex.field.character.goal" },
    { key: "trait", labelKey: "Codex.field.character.trait" },
  ],
  place: [
    { key: "region", labelKey: "Codex.field.place.region" },
    { key: "note", labelKey: "Codex.field.place.note" },
  ],
  item: [
    { key: "owner", labelKey: "Codex.field.item.owner" },
    { key: "state", labelKey: "Codex.field.item.state" },
    { key: "ability", labelKey: "Codex.field.item.ability" },
  ],
};

/** 默认类型配置：首次使用时落盘，之后用户可改颜色。 */
export function defaultTypeConfigs(): CodexTypeConfig[] {
  return CODEX_TYPES.map((id) => ({
    id,
    labelKey: `Codex.type.${id}`,
    color: DEFAULT_CODEX_COLORS[id],
    fields: DEFAULT_CODEX_FIELDS[id] ?? [],
  }));
}

/** 读取类型配置；缺失或损坏时回落默认值。 */
export async function loadTypeConfigs(root: string): Promise<CodexTypeConfig[]> {
  const fs2 = createFs(root);
  const file = codexTypesFile();
  if (await fs2.exists(file)) {
    try {
      const parsed = z.array(codexTypeConfigSchema).parse(JSON.parse(await fs2.readText(file)));
      const byId = new Map(parsed.map((c) => [c.id, c]));
      const defaults = defaultTypeConfigs();
      /* 补齐新增类型：枚举加了类型而旧配置文件还没写进去时。 */
      return defaults.map((d) => byId.get(d.id) ?? d);
    } catch (err) {
      log.error("codex types parse failed, using defaults", err);
    }
  }
  const defaults = defaultTypeConfigs();
  await saveTypeConfigs(root, defaults);
  return defaults;
}

/** 保存类型配置。 */
export async function saveTypeConfigs(root: string, configs: CodexTypeConfig[]): Promise<void> {
  const fs2 = createFs(root);
  const validated = z.array(codexTypeConfigSchema).parse(configs);
  await fs2.createDir(codexRootDir());
  await fs2.writeText(codexTypesFile(), JSON.stringify(validated, null, 2));
}

/** 旧 `links` 裸 id 统一并入 relations，避免两套关联并存。 */
function normalizeEntry(entry: CodexEntry): CodexEntry {
  if (!entry.links.length) return entry;
  const known = new Set(entry.relations.map((r) => r.targetId));
  return {
    ...entry,
    relations: [
      ...entry.relations,
      ...entry.links
        .filter((id) => !known.has(id))
        .map((id) => ({ targetId: id, kind: "mentions" as const })),
    ],
    links: [],
  };
}

async function writeEntryFile(root: string, entry: CodexEntry): Promise<void> {
  const fs2 = createFs(root);
  await fs2.createDir(codexEntriesDir());
  await fs2.writeText(codexEntryFileShared(entry.id), JSON.stringify(entry, null, 2));
}

/** 读取单个条目；解析失败只记日志并返回 null。 */
export async function loadEntry(root: string, entryId: string): Promise<CodexEntry | null> {
  const fs2 = createFs(root);
  const file = codexEntryFileShared(entryId);
  if (!(await fs2.exists(file))) return null;
  try {
    return normalizeEntry(codexEntrySchema.parse(JSON.parse(await fs2.readText(file))));
  } catch (err) {
    log.error("codex entry parse failed", entryId, err);
    return null;
  }
}

/** 装载全部条目。单条坏数据只跳过该条，不让整个素材库加载失败。 */
export async function loadAllEntries(root: string): Promise<CodexEntry[]> {
  const fs2 = createFs(root);
  const dir = codexEntriesDir();
  if (!(await fs2.exists(dir))) return [];
  const names = await fs2.readDir(dir);
  const out: CodexEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const entry = await loadEntry(root, name.slice(0, -".json".length));
    if (entry) out.push(entry);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
}

/** 保存条目，并维护关系的双向性。 */
export async function saveEntry(root: string, entry: CodexEntry): Promise<void> {
  const validated = codexEntrySchema.parse({
    ...normalizeEntry(entry),
    updatedAt: Date.now(),
  });
  await writeEntryFile(root, validated);
  await syncRelations(root, validated);
}

/**
 * 同步关系边。
 *
 * 关系是"两端各存一条"的：只存单向的话，从另一条目的关联列表里
 * 就看不到这条边。已存在的边不动，同时把对方指向我、但我不再指向
 * 对方的残留单向边摘掉。
 */
async function syncRelations(root: string, source: CodexEntry): Promise<void> {
  const mine = new Set(source.relations.map((r) => r.targetId));
  const others = await loadAllEntries(root);

  for (const other of others) {
    if (other.id === source.id) continue;
    const target = mine.has(other.id);
    const back = other.relations.some((r) => r.targetId === source.id);
    if (target === back) continue;
    if (target) {
      other.relations.push({ targetId: source.id, kind: "mentions" });
    } else {
      other.relations = other.relations.filter((r) => r.targetId !== source.id);
      other.links = other.links.filter((id) => id !== source.id);
    }
    await writeEntryFile(root, other);
  }
}

/** 新建并保存条目。 */
export async function createEntry(root: string, type: CodexType, name: string): Promise<CodexEntry> {
  const now = Date.now();
  const entry = codexEntrySchema.parse({
    id: crypto.randomUUID(),
    type,
    name,
    createdAt: now,
    updatedAt: now,
  });
  await saveEntry(root, entry);
  return entry;
}

/** 删除条目，并从所有条目的关系里摘掉它。 */
export async function removeEntry(root: string, entry: CodexEntry): Promise<void> {
  const fs2 = createFs(root);
  await fs2.remove(codexEntryFileShared(entry.id));
  for (const other of await loadAllEntries(root)) {
    if (!other.relations.some((r) => r.targetId === entry.id)) continue;
    other.relations = other.relations.filter((r) => r.targetId !== entry.id);
    other.links = other.links.filter((id) => id !== entry.id);
    await writeEntryFile(root, other);
  }
}

/* ---------- 迁移：works/<id>/codex → 工作区 codex ---------- */

export interface MigrationReport {
  /** 从哪部作品、哪一类型读到多少条。 */
  perWork: { workId: string; type: CodexType; count: number }[];
  /** 实际写入共享库的条目数。 */
  copied: number;
  /** 同名条目疑似重复，未合并，列出来给用户人工判断。 */
  duplicates: { type: CodexType; name: string; ids: string[] }[];
}

/**
 * 把旧的"每部作品一套素材库"汇总到工作区级。
 *
 * 只复制不删除：旧数据留着，用户确认新库可用后可自行清理。
 * 同名不同 id 的条目不自动合并——"林风"在两本书里未必是同一个人，
 * 按名字合并会静默毁掉设定。
 */
export async function migrateLegacyEntries(root: string, workIds: string[]): Promise<MigrationReport> {
  const fs2 = createFs(root);
  const perWork: MigrationReport["perWork"] = [];
  const staged: CodexEntry[] = [];

  for (const workId of workIds) {
    if (!(await fs2.exists(workDir(workId)))) continue;
    for (const type of CODEX_TYPES) {
      const dir = codexDir(workId, type);
      if (!(await fs2.exists(dir))) continue;
      const names = await fs2.readDir(dir);
      let count = 0;
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        try {
          const raw = JSON.parse(await fs2.readText(`${dir}/${name}`)) as Record<string, unknown>;
          staged.push(
            normalizeEntry(
              codexEntrySchema.parse({
                ...raw,
                type: (raw.type as CodexType) ?? type,
                id: typeof raw.id === "string" ? raw.id : crypto.randomUUID(),
              })
            )
          );
          count += 1;
        } catch (err) {
          log.error("legacy codex entry parse failed", workId, type, name, err);
        }
      }
      if (count) perWork.push({ workId, type, count });
    }
  }

  await fs2.createDir(codexEntriesDir());
  const existing = new Set((await loadAllEntries(root)).map((e) => e.id));
  let copied = 0;
  for (const entry of staged) {
    if (existing.has(entry.id)) continue;
    existing.add(entry.id);
    await writeEntryFile(root, entry);
    copied += 1;
  }

  /* 同名疑似重复只报告，不合并。 */
  const byName = new Map<string, string[]>();
  for (const e of await loadAllEntries(root)) {
    const key = `${e.type}\u0000${e.name.trim()}`;
    byName.set(key, [...(byName.get(key) ?? []), e.id]);
  }
  const duplicates: MigrationReport["duplicates"] = [];
  for (const [key, ids] of byName) {
    if (ids.length < 2) continue;
    const [type, ...rest] = key.split("\u0000");
    duplicates.push({ type: type as CodexType, name: rest.join("\u0000"), ids });
  }

  log.info("codex migration done", { works: workIds.length, copied });
  return { perWork, copied, duplicates };
}
