/**
 * 素材库 V2 模型定义（计划书 codex-v2.md §3）。
 *
 * V1 的模型太薄：条目只有「名字 + 标签 + 一段正文 + 五个全局关系词」，
 * 撑不起长篇小说的设定密度。V2 扩成五层：
 *
 *   TypeConfig（类型，可增删改）
 *     └─ FieldTemplate[]     该类型的字段模板
 *   Entry（条目）              名字/别名/标签/摘要/详情/字段值/作用域
 *   Relation（关系边，独立文件） 有向 + 正反标签
 *   Mention（提及索引，独立文件）  条目 ↔ 章节 的出现记录
 *
 * 关系与提及为什么独立成文件见计划书 §3.2：关系边是「两个条目之间的事实」，
 * 塞进任何一边都要复制一份，于是必须做同步——F22 那一串「清单/内存/磁盘
 * 不同步」的病根就是"同一个事实存在多处"。独立成文件后只有一个真相来源。
 */

import { z } from "zod";

/* ---------- 字段模板与字段值 ---------- */

/**
 * 字段的种类。
 *
 * - text / longtext：单行 / 多行自由文本
 * - number：数值
 * - date：自由文本日期。中文小说的纪年（开元三年、末法元年）不是 ISO 日期，
 *   强行转时间戳会丢信息，所以存字符串，排序另用可选的数值辅助列
 * - select：有限选项
 * - ref / refs：指向另一个条目（单条 / 多条）
 */
export const FIELD_KINDS = [
  "text",
  "longtext",
  "number",
  "date",
  "select",
  "ref",
  "refs",
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const fieldTemplateSchema = z.object({
  /** 字段键：在所属类型的 entries[].fields 里做 key。 */
  key: z.string().min(1),
  /** 显示名。自由文本——V1 用 i18n key，导致自定义字段无法有中文标签。 */
  label: z.string(),
  kind: z.enum(FIELD_KINDS),
  /** select 类型的候选项。 */
  options: z.array(z.string()).default([]),
  /** ref / refs 字段允许指向的类型；不填表示可选任意类型。 */
  targetTypeId: z.string().optional(),
  /** 同类型内的字段排序。 */
  order: z.number().int().default(0),
  /** 填写提示，显示在字段下方。 */
  hint: z.string().optional(),
  /**
   * 由出厂模板提供的内置字段。
   *
   * 内置字段允许调整名称、提示、类型和顺序，但不能从类型中删除；
   * 条目数据仍以字段 key 关联，删掉模板会让已有值失去解释。
   */
  builtin: z.boolean().default(false),
});

export type FieldTemplate = z.infer<typeof fieldTemplateSchema>;

/**
 * 字段值是 union，但读时兼容旧的裸字符串。
 *
 * 旧的 `attributes: Record<string, string>` 全部按 text 读入，
 * 保存时写新格式——渐进迁移，不要求用户手动搬数据。
 */
export const fieldValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), value: z.string() }),
  z.object({ kind: z.literal("longtext"), value: z.string() }),
  z.object({ kind: z.literal("number"), value: z.number() }),
  z.object({ kind: z.literal("date"), value: z.string() }),
  z.object({ kind: z.literal("select"), value: z.string() }),
  z.object({ kind: z.literal("ref"), value: z.string() }),
  z.object({ kind: z.literal("refs"), value: z.array(z.string()) }),
]);

export type FieldValue = z.infer<typeof fieldValueSchema>;

/* ---------- 类型配置 ---------- */

/** 关系词的一个方向：正向标签 + 反向标签。 */
export const relationKindDefSchema = z.object({
  /** 正向标签，如「持有」。 */
  kind: z.string().min(1),
  /** 反向标签，如「持有者」。 */
  inverseKind: z.string().min(1),
});

export type RelationKindDef = z.infer<typeof relationKindDefSchema>;

/** 某类型指向目标类型时允许用的关系词表。 */
export const relationVocabSchema = z.object({
  targetTypeId: z.string().min(1),
  kinds: z.array(relationKindDefSchema).default([]),
});

export type RelationVocab = z.infer<typeof relationVocabSchema>;

/**
 * 类型配置。
 *
 * id 不再是枚举：V1 的 `z.enum(CODEX_TYPES)` 让加一个类型必须改代码再迁数据，
 * 与「本地优先、用户掌控」的取向相悖。
 */
export const typeConfigSchema = z.object({
  id: z.string().min(1),
  /** 显示名。自由文本；内置类型另存 labelKey 走 i18n。 */
  label: z.string(),
  /** 内置类型的 i18n key。自定义类型没有这个字段。 */
  labelKey: z.string().optional(),
  /** 亮暗双套颜色。V1 单一 hex 在暗色主题下偏糊。 */
  color: z.object({
    light: z.string().default("#7c3aed"),
    dark: z.string().default("#a78bfa"),
  }),
  /** lucide 图标名。 */
  icon: z.string().optional(),
  /** 该类型的字段模板，用户可增删改排序。 */
  fields: z.array(fieldTemplateSchema).default([]),
  /** 关系词表，按目标类型分组。 */
  relationVocab: z.array(relationVocabSchema).default([]),
  /** 内置类型不可删，可隐藏。 */
  builtin: z.boolean().default(false),
  /** 类型栏里的排序。 */
  order: z.number().int().default(0),
});

export type TypeConfig = z.infer<typeof typeConfigSchema>;

/* ---------- 条目 ---------- */

/**
 * 作用域：这条设定适用于哪些作品。
 *
 * 与「出现在哪部作品」区分——后者由 mentions 派生，是事实；
 * 这里是作者声明，是意图。两者不要混成一个字段。
 */
export const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("workspace") }),
  z.object({ kind: z.literal("works"), workIds: z.array(z.string()) }),
]);

export type Scope = z.infer<typeof scopeSchema>;

export const entrySchema = z.object({
  id: z.string().uuid(),
  /** 所属类型 id，指向 TypeConfig.id。 */
  typeId: z.string().min(1),
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  /** 一句话摘要：卡片与 hover 卡用。 */
  summary: z.string().default(""),
  /** 详情长文。 */
  body: z.string().default(""),
  /** 强类型字段值，key 对应 FieldTemplate.key。 */
  fields: z.record(z.string(), fieldValueSchema).default({}),
  scope: scopeSchema.default({ kind: "workspace" }),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export type Entry = z.infer<typeof entrySchema>;

/* ---------- 关系 ---------- */

/**
 * 关系边：有向 + 正反标签成对。
 *
 * V1 的 `syncRelations` 给对端补的反向边 kind 恒为 "mentions"，
 * 于是「林风属于青云宗」在宗门条目里显示成「提及」——反向语义无处安放。
 * V2 把正反标签都存下来，「A 持有 B」与「B 被 A 持有」一眼可读。
 */
export const relationSchema = z.object({
  id: z.string().uuid(),
  fromId: z.string().uuid(),
  toId: z.string().uuid(),
  /** 正向标签，如「持有」。 */
  kind: z.string(),
  /** 反向标签，如「持有者」。 */
  inverseKind: z.string(),
  /** 关系备注。 */
  note: z.string().optional(),
  order: z.number().int().default(0),
});

export type Relation = z.infer<typeof relationSchema>;

/** relations.json 的整体结构。 */
export const relationSetSchema = z.object({
  relations: z.array(relationSchema).default([]),
});

export type RelationSet = z.infer<typeof relationSetSchema>;

/* ---------- 提及索引 ---------- */

/** 一次出现的记录。 */
export const mentionRecordSchema = z.object({
  workId: z.string(),
  chapterId: z.string(),
  /** 该章中出现次数。 */
  count: z.number().int().default(1),
  firstSeenAt: z.number().int(),
});

export type MentionRecord = z.infer<typeof mentionRecordSchema>;

/**
 * mentions.json：条目 → 出现记录列表。
 *
 * 索引跨作品，而素材库是工作区级；每部作品各存一份全局索引是 N 份重复。
 */
export const mentionIndexSchema = z.record(
  z.string(),
  z.array(mentionRecordSchema)
);

export type MentionIndex = z.infer<typeof mentionIndexSchema>;

/* ---------- 杂项 ---------- */

/** 空作用域。 */
export const WORKSPACE_SCOPE: Scope = { kind: "workspace" };

/** 空字段值。 */
export function emptyFieldValue(kind: FieldKind): FieldValue {
  switch (kind) {
    case "number":
      return { kind: "number", value: 0 };
    case "refs":
      return { kind: "refs", value: [] };
    default:
      return { kind, value: "" } as FieldValue;
  }
}
