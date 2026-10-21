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
  /**
   * 情节小结：比 synopsis 长的自由文本，只在章节详情 Dialog 里编辑。
   *
   * synopsis 是"给结构树扫读用的一句"，情节小结是"给写作回忆用的段落"，
   * 两者长度与用途都不同，塞进同一个字段会互相将就。
   */
  plotSummary: z.string().default(""),
  /**
   * 卷首语：卷（或同层级分组节点）自己的内容。
   *
   * 章的内容在章文件里，卷没有对应正文文件；卷首语是唯一挂在卷节点上的
   * 长文本。存为纯文本即可，导出与编辑都按段落处理。
   */
  preface: z.string().default(""),
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
  /** 乐观并发版本号；每次成功写入严格加一。 */
  revision: z.number().int().nonnegative().default(0),
  /**
   * 历史快照：每次保存前的上一版正文。
   *
   * 编辑器的撤销栈只活在内存里，退出应用即失效，误删一段话无法找回。
   * 这里保留有限个版本（见 services/chapter 的 HISTORY_LIMIT），
   * 支持回滚到任一历史时间点。存整份 cards 快照而非差量：
   * 长章虽然占空间，但回滚逻辑简单且不会因差量累积而算错。
   */
  history: z
    .array(
      z.object({
        /** 快照时间（毫秒）。 */
        at: z.number().int(),
        /** 触发这次快照的保存时间，用于界面显示"保存于…"。 */
        savedAt: z.number().int(),
        cards: z.array(cardSchema),
      })
    )
    .default([]),
  /** 光标位置：卡片下标 + 卡内偏移，两者都持久化。 */
  cursor: z
    .object({ cardIndex: z.number().int(), offset: z.number().int() })
    .default({
      cardIndex: 0,
      offset: 0,
    }),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export type Chapter = z.infer<typeof chapterSchema>;

/**
 * 章节索引项。
 *
 * 结构树和作品库只需要标题、正文更新时间与字数。把这些轻量信息集中到
 * 一个索引文件，打开千章作品时就不必逐个读取完整章 JSON。
 */
export const chapterMetaSchema = z.object({
  title: z.string(),
  updatedAt: z.number().int(),
  words: z.number().int(),
});

export type ChapterMeta = z.infer<typeof chapterMetaSchema>;

/** 单部作品的章节索引。键是章 id，与 chapters/<id>.json 对应。 */
export const chapterIndexSchema = z.object({
  version: z.number().int().default(1),
  chapters: z.record(idSchema, chapterMetaSchema),
});

export type ChapterIndex = z.infer<typeof chapterIndexSchema>;

/** 作品元数据。 */
export const workSchema = z.object({
  id: idSchema,
  title: z.string(),
  type: z.string().default(""),
  /** 作品简介：导入时由标题之前的前置信息填充，可随时编辑。 */
  synopsis: z.string().default(""),
  /**
   * 后续导入默认整理段落。
   *
   * 这是作品级偏好，不会在开关变化时静默改写正文；已有正文由书本设置
   * 里的“整理现有正文”显式触发，二者语义分开。
   */
  autoParagraph: z.boolean().default(true),
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
  /**
   * 每日写作量：YYYY-MM-DD → 当日净增字数。
   *
   * 存"净增"而非"当日总量"：改写旧段落会让当日总量回落，
   * 曲线就变成锯齿状；净增才反映真实推进速度，且重排历史时仍可累加。
   * 键数随天数缓慢增长（每年 365 条，几 KB），无需清理。
   */
  daily: z.record(z.string(), z.number().int()).default({}),
  /**
   * 写作目标。
   *
   * 用户要能按自己的节奏设目标（日更 500 字、日更 2000 字等），
   * 而不是被写死一个常量。0 表示不设目标——那时进度条不该出现，
   * 否则一根永远 0% 的条只会让人以为哪里坏了。
   */
  dailyGoal: z.number().int().min(0).default(0),
  /**
   * 曲线展示口径。
   *
   * - `net`：当日净增字数（默认）。改写旧段落会让当日数字回落，
   *   曲线呈锯齿，但反映真实推进量。
   * - `total`：当日累计字数。曲线平滑，适合看"哪天写得少"。
   * 用户可选，因为两种曲线回答的问题不同：前者答"我推进了多少"，
   * 后者答"哪天偷懒了"。
   */
  curveMode: z.enum(["net", "total"]).default("net"),
  /** 每个作品的字数。 */
  workWords: z.record(idSchema, z.number().int()).default({}),
  /** 提及索引，为 v2 增强导出预留。 */
  mentions: mentionIndexSchema.default({}),
});

export type Stats = z.infer<typeof statsSchema>;

/** 工作区清单：作品顺序与归档状态。 */
export const workspaceSchema = z.object({
  version: z.number().int().default(1),
  /**
   * 工作区别名。
   *
   * 目录名常是随手起的（"wirting"、"新建文件夹"），而用户心里
   * 这个库有个正式称呼。改名要动磁盘路径、波及所有作品目录，
   * 所以名字与路径分开：路径是地址，alias 是这个地址的显示名。
   */
  alias: z.string().default(""),
  /** 作品 id 顺序。 */
  order: z.array(idSchema),
  /** 归档作品 id（不参与常规显示，但保留可恢复）。 */
  archived: z.array(idSchema).default([]),
});

export type Workspace = z.infer<typeof workspaceSchema>;
