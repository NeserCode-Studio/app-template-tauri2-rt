/**
 * 工作区路径计算：从工作区根到各类磁盘文件的相对路径。
 */

import { joinRel } from "./fs";

export const WORKSPACE_FILE = "novels-yes.json";
export const WORKS_DIR = "works";
export const TRASH_DIR = ".trash";
/**
 * 素材库目录。
 *
 * 与 `works/` 同级：素材库属于工作区而非单部作品——同一个人物、
 * 地点会横跨多部作品复用，按作品各存一套必然产生分裂的副本。
 */
export const CODEX_DIR = "codex";

/** 工作区级素材库根目录。 */
export function codexRootDir(): string {
  return CODEX_DIR;
}

/** 工作区清单文件。 */
export function workspaceFile(): string {
  return WORKSPACE_FILE;
}

/** 单个作品目录。 */
export function workDir(workId: string): string {
  return joinRel(WORKS_DIR, workId);
}

/** 作品元数据文件。 */
export function workMetaFile(workId: string): string {
  return joinRel(WORKS_DIR, workId, "work.json");
}

/** 作品结构树文件。 */
export function outlineFile(workId: string): string {
  return joinRel(WORKS_DIR, workId, "outline.json");
}

/** 作品统计文件。 */
export function statsFile(workId: string): string {
  return joinRel(WORKS_DIR, workId, "stats.json");
}

/** 章数据文件（json 为唯一事实来源）。 */
export function chapterFile(workId: string, chapterId: string): string {
  return joinRel(WORKS_DIR, workId, "chapters", chapterId + ".json");
}

/** 章纯文本视图（由 cards 生成，供导出 / 外部编辑）。 */
export function chapterTextFile(workId: string, chapterId: string): string {
  return joinRel(WORKS_DIR, workId, "texts", chapterId + ".txt");
}

/** 素材条目目录（按类型分目录）。 */
export function codexDir(workId: string, type: string): string {
  return joinRel(WORKS_DIR, workId, "codex", type);
}

/** 素材条目文件。 */
export function codexEntryFile(
  workId: string,
  type: string,
  entryId: string
): string {
  return joinRel(WORKS_DIR, workId, "codex", type, entryId + ".json");
}

/** 工作区级素材条目目录（全部类型混放，类型记在条目内）。 */
export function codexEntriesDir(): string {
  return joinRel(CODEX_DIR, "entries");
}

/** 工作区级素材条目文件。 */
export function codexEntryFileShared(entryId: string): string {
  return joinRel(CODEX_DIR, "entries", entryId + ".json");
}

/** 素材库类型配置（名称键、高亮颜色、字段定义、排序）。 */
export function codexTypesFile(): string {
  return joinRel(CODEX_DIR, "types.json");
}

/**
 * 素材库关系边文件（V2）。
 *
 * 关系边是「两个条目之间的事实」，独立成文件而不是塞进条目：
 * 任何一边存都要在另一边复制一份，于是必须做同步——F22 那一串
 * 「清单 / 内存 / 磁盘三者不同步」的病根就是"同一个事实存在多处"。
 * 独立成文件后只有一个真相来源，同步在结构上不可能出错。
 */
export function codexRelationsFile(): string {
  return joinRel(CODEX_DIR, "relations.json");
}

/**
 * 素材库提及索引（V2）。
 *
 * 索引跨作品，而素材库是工作区级；每部作品各存一份全局索引是 N 份重复。
 */
export function codexMentionsFile(): string {
  return joinRel(CODEX_DIR, "mentions.json");
}

/**
 * V1 素材库备份目录（V2 迁移前整体复制一份）。
 *
 * 迁移失败不阻断使用：条目仍可读写，只是停留在旧结构。
 * 这份备份是用户「数据是我的，不能被一次升级弄丢」的兜底。
 */
export function codexLegacyBackupDir(): string {
  return joinRel(CODEX_DIR, "legacy-backup");
}

/** 回收站目录（工作区内）。 */
export function trashDir(): string {
  return TRASH_DIR;
}

/** 回收站内的清单文件：记录被删项的原始路径与类型，供恢复使用。 */
export function trashIndexFile(): string {
  return joinRel(TRASH_DIR, "index.json");
}

/** 单条回收记录在清单里的存放文件。 */
export function trashItemFile(itemId: string): string {
  return joinRel(TRASH_DIR, itemId + ".json");
}
