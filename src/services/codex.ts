/**
 * 素材库服务：人物 / 地点 / 物品等类型化条目。
 *
 * 条目按类型分目录存为 json，含名称、别名、标签、自由文本、关联。
 */

import { createFs } from "./fs";
import { codexDir, codexEntryFile } from "./paths";
import { z } from "zod";
import { createLogger } from "@/lib/logger";

const log = createLogger("CodexService");

export const CODEX_TYPES = ["character", "place", "item", "faction", "timeline", "concept"] as const;
export type CodexType = (typeof CODEX_TYPES)[number];

export const codexEntrySchema = z.object({
  id: z.string().uuid(),
  type: z.enum(CODEX_TYPES),
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  body: z.string().default(""),
  /** 关联的其他条目 id。 */
  links: z.array(z.string()).default([]),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export type CodexEntry = z.infer<typeof codexEntrySchema>;

/** 列出某类型下的所有条目 id（文件名即 id）。 */
export async function listEntries(root: string, workId: string, type: CodexType): Promise<string[]> {
  const fs2 = createFs(root);
  const dir = codexDir(workId, type);
  if (!(await fs2.exists(dir))) return [];
  return fs2.readDir(dir);
}

/** 读取单个条目。 */
export async function loadEntry(root: string, workId: string, type: CodexType, entryId: string): Promise<CodexEntry | null> {
  const fs2 = createFs(root);
  const file = codexEntryFile(workId, type, entryId);
  if (!(await fs2.exists(file))) return null;
  try {
    return codexEntrySchema.parse(JSON.parse(await fs2.readText(file)));
  } catch (err) {
    log.error("codex entry parse failed", entryId, err);
    return null;
  }
}

/** 保存条目。 */
export async function saveEntry(root: string, workId: string, entry: CodexEntry): Promise<void> {
  const fs2 = createFs(root);
  const validated = codexEntrySchema.parse({ ...entry, updatedAt: Date.now() });
  await fs2.writeText(codexEntryFile(workId, entry.type, validated.id), JSON.stringify(validated, null, 2));
}

/** 新建并保存条目。 */
export async function createEntry(
  root: string,
  workId: string,
  type: CodexType,
  name: string
): Promise<CodexEntry> {
  const fs2 = createFs(root);
  const now = Date.now();
  const entry: CodexEntry = codexEntrySchema.parse({
    id: crypto.randomUUID(),
    type,
    name,
    createdAt: now,
    updatedAt: now,
  });
  await fs2.createDir(codexDir(workId, type));
  await saveEntry(root, workId, entry);
  return entry;
}

/** 删除条目。 */
export async function removeEntry(root: string, workId: string, entry: CodexEntry): Promise<void> {
  const fs2 = createFs(root);
  await fs2.remove(codexEntryFile(workId, entry.type, entry.id));
}
