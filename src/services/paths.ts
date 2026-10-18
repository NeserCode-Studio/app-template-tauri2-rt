/**
 * 工作区路径计算：从工作区根到各类磁盘文件的相对路径。
 */

import { joinRel } from "./fs";

export const WORKSPACE_FILE = "novels-yes.json";
export const WORKS_DIR = "works";
export const TRASH_DIR = ".trash";

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
export function codexEntryFile(workId: string, type: string, entryId: string): string {
  return joinRel(WORKS_DIR, workId, "codex", type, entryId + ".json");
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
