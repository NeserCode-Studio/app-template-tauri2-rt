/**
 * 工作区服务：选择 / 创建工作区目录，并维护 novels-yes.json 清单。
 *
 * 工作区根是用户选定的文件夹（通过 @tauri-apps/plugin-dialog 选择）。
 * 这里不持有全局状态，所有方法都需要 caller 传入 root。
 * 全局状态由 WorkspaceContext 在 React 侧维护。
 */

import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { createFs } from "./fs";
import { moveToTrash } from "./trash";
import { workspaceFile, workMetaFile, workDir } from "./paths";
import { workspaceSchema, type Workspace, workSchema, type Work } from "@/shared/schema";
import { createLogger } from "@/lib/logger";

const log = createLogger("WorkspaceService");

/** 默认工作区清单。 */
export function emptyWorkspace(): Workspace {
  return { version: 1, alias: "", order: [], archived: [] };
}

/** 弹出目录选择框，返回用户选定的绝对路径或 null。 */
export async function pickWorkspaceDir(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择 novels-yes 书库目录",
  });
  if (Array.isArray(selected)) return selected[0] ?? null;
  return selected;
}

/**
 * 在系统文件管理器里打开工作区目录。
 *
 * 用 `revealItemInDir` 而不是 openUrl：前者会把资源管理器定位到该目录，
 * 后者按 URL 语义处理，本地路径在各平台行为不一致。
 */
export async function revealWorkspaceDir(root: string): Promise<void> {
  await revealItemInDir(root);
}

/**
 * 删除一部作品：整部目录移入回收站，清单同步摘除。
 *
 * 走回收站而非直接删目录：一部作品可能是几百章正文，
 * "误点了删除"不该等同于永久丢失。卷与章的删除已经这样处理，
 * 作品是它们的父级，标准必须一致。
 */
export async function deleteWork(
  root: string,
  ws: Workspace,
  workId: string,
  title: string
): Promise<Workspace> {
  await moveToTrash(root, {
    kind: "work",
    originId: workId,
    paths: [workDir(workId)],
    title,
  });
  const next = workspaceSchema.parse({
    ...ws,
    order: ws.order.filter((id) => id !== workId),
    archived: ws.archived.filter((id) => id !== workId),
  });
  await saveWorkspace(root, next);
  log.info("work moved to trash", { workId });
  return next;
}

/** 读取工作区清单；若文件不存在或解析失败则回退到空清单并写入。 */
export async function loadWorkspace(root: string): Promise<Workspace> {
  const fs2 = createFs(root);
  const file = workspaceFile();
  if (!(await fs2.exists(file))) {
    const ws = emptyWorkspace();
    await saveWorkspace(root, ws);
    return ws;
  }
  try {
    const raw = await fs2.readText(file);
    const parsed = workspaceSchema.parse(JSON.parse(raw));
    log.info("workspace loaded", { works: parsed.order.length });
    return parsed;
  } catch (err) {
    log.error("workspace parse failed, resetting", err);
    const ws = emptyWorkspace();
    await saveWorkspace(root, ws);
    return ws;
  }
}

/** 持久化工作区清单。 */
export async function saveWorkspace(root: string, ws: Workspace): Promise<void> {
  const fs2 = createFs(root);
  const validated = workspaceSchema.parse(ws);
  await fs2.writeText(workspaceFile(), JSON.stringify(validated, null, 2));
}

/** 新建作品：创建目录与 work.json，并把 id 追加到清单顺序。 */
export async function createWork(
  root: string,
  ws: Workspace,
  title: string,
  type = ""
): Promise<{ ws: Workspace; work: Work }> {
  const fs2 = createFs(root);
  const now = Date.now();
  const work: Work = workSchema.parse({
    id: crypto.randomUUID(),
    title,
    type,
    createdAt: now,
    updatedAt: now,
  });
  await fs2.createDir(workDir(work.id));
  await fs2.writeText(workMetaFile(work.id), JSON.stringify(work, null, 2));

  const next = workspaceSchema.parse({
    ...ws,
    order: [...ws.order, work.id],
  });
  await saveWorkspace(root, next);
  log.info("work created", { id: work.id, title });
  return { ws: next, work };
}

/** 读取作品元数据。 */
export async function loadWork(root: string, workId: string): Promise<Work> {
  const fs2 = createFs(root);
  const raw = await fs2.readText(workMetaFile(workId));
  return workSchema.parse(JSON.parse(raw));
}

/** 保存作品元数据。 */
export async function saveWork(root: string, work: Work): Promise<void> {
  const fs2 = createFs(root);
  const validated = workSchema.parse({ ...work, updatedAt: Date.now() });
  await fs2.writeText(workMetaFile(work.id), JSON.stringify(validated, null, 2));
}

/** 把作品移入归档（保留数据，仅从常规列表移除）。 */
export async function archiveWork(root: string, ws: Workspace, workId: string): Promise<Workspace> {
  const next = workspaceSchema.parse({
    ...ws,
    order: ws.order.filter((id) => id !== workId),
    archived: ws.archived.includes(workId) ? ws.archived : [...ws.archived, workId],
  });
  await saveWorkspace(root, next);
  return next;
}

/** 从归档恢复。 */
export async function unarchiveWork(root: string, ws: Workspace, workId: string): Promise<Workspace> {
  const next = workspaceSchema.parse({
    ...ws,
    order: ws.order.includes(workId) ? ws.order : [...ws.order, workId],
    archived: ws.archived.filter((id) => id !== workId),
  });
  await saveWorkspace(root, next);
  return next;
}
