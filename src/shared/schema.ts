/**
 * novels-yes 数据模型 schema（前后端共用）。
 *
 * 所有落盘字段都在此定义，services 层读取后一律用 zod 校验，
 * 坏数据不会静默进入应用状态。
 */

import { z } from "zod";

/** 通用：UUID 字符串（ID 一律用 crypto.randomUUID）。 */
export const idSchema = z.string().uuid();

/** 卷 / 章 / 场景三种节点类型。 */
export const nodeTypeSchema = z.enum(["volume", "chapter", "scene"]);

/**
 * 结构树节点。作品（work）本身不进树，树内只有 volume/chapter/scene。
 * 子节点按 order 升序排列，order 即显示顺序。
 */
export const outlineNodeSchema = z.object({
  id: idSchema,
  type: nodeTypeSchema,
  title: z.string(),
  parentId: idSchema.nullable(),
  order: z.number().int(),
  /** 章状态：草稿 / 修订中 / 定稿。 */
  status: z.enum(["draft", "revising", "final"]).default("draft"),
  /** 一句话摘要，结构树内联显示。 */
  synopsis: z.string().default(""),
  /** 是否折叠（仅 volume 有意义，但统一携带以便持久化）。 */
  collapsed: z.boolean().default(false),
  /** scene 可折叠，记录是否折叠。 */
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export type OutlineNode = z.infer<typeof outlineNodeSchema>;

/** 整棵结构树：扁平节点数组，按 parentId 关系组合。 */
export const outlineSchema = z.object({
  nodes: z.array(outlineNodeSchema),
});

export type Outline = z.infer<typeof outlineSchema>;

/** 单张卡片：一张卡片承载一段文本。 */
export const cardSchema = z.object({
  id: idSchema,
  /** 卡片下标（用于光标持久化）。 */
  text: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export type Card = z.infer<typeof cardSchema>;

/** 章：正文以 cards 数组为唯一事实来源，txt 视图由其生成。 */
export const chapterSchema = z.object({
  id: idSchema,
  title: z.string(),
  status: z.enum(["draft", "revising", "final"]).default("draft"),
  cards: z.array(cardSchema),
  /** 光标位置：卡片下标 + 卡内偏移，两者都持久化。 */
  cursor: z.object({ cardIndex: z.number().int(), offset: z.number().int() }).default({
    cardIndex: 0,
    offset: 0,
  }),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export type Chapter = z.infer<typeof chapterSchema>;

/** 作品元数据。 */
export const workSchema = z.object({
  id: idSchema,
  title: z.string(),
  type: z.string().default(""),
  /** 封面占位（暂无外部图片，记录一个本地相对路径或空）。 */
  cover: z.string().default(""),
  archived: z.boolean().default(false),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export type Work = z.infer<typeof workSchema>;

/** 提及索引项：哪个素材条目在哪些章被引用。 */
export const mentionIndexSchema = z.record(
  idSchema,
  z.object({ chapters: z.array(idSchema), count: z.number().int() })
);

export type MentionIndex = z.infer<typeof mentionIndexSchema>;

/** 统计：字数与写作日志。 */
export const statsSchema = z.object({
  /** 全站总字数（按作品聚合）。 */
  totalWords: z.number().int().default(0),
  /** 连续写作天数。 */
  streak: z.number().int().default(0),
  /** 今日字数。 */
  todayWords: z.number().int().default(0),
  /** 最近一次写作日期（YYYY-MM-DD）。 */
  lastWriteDate: z.string().default(""),
  /** 每个作品的字数。 */
  workWords: z.record(idSchema, z.number().int()).default({}),
  /** 提及索引，为 v2 增强导出预留。 */
  mentions: mentionIndexSchema.default({}),
});

export type Stats = z.infer<typeof statsSchema>;

/** 工作区清单：作品顺序与归档状态。 */
export const workspaceSchema = z.object({
  version: z.number().int().default(1),
  /** 作品 id 顺序。 */
  order: z.array(idSchema),
  /** 归档作品 id（不参与常规显示，但保留可恢复）。 */
  archived: z.array(idSchema).default([]),
});

export type Workspace = z.infer<typeof workspaceSchema>;
