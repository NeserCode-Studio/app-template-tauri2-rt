/**
 * 结构树服务：卷 / 章 / 场景的扁平节点数组，持久化到 outline.json。
 *
 * 节点关系由 parentId 表达，顺序由 order 表达，避免用文件夹层级
 * 隐式表达层级，保证排序与升降级可靠。
 */

import { createFs } from "./fs";
import { outlineFile } from "./paths";
import { outlineSchema, outlineNodeSchema, type Outline, type OutlineNode } from "@/shared/schema";
import { createLogger } from "@/lib/logger";

const log = createLogger("OutlineService");

export function emptyOutline(): Outline {
  return { nodes: [] };
}

/** 读取结构树；文件不存在或解析失败回退到空树。 */
export async function loadOutline(root: string, workId: string): Promise<Outline> {
  const fs2 = createFs(root);
  const file = outlineFile(workId);
  if (!(await fs2.exists(file))) return emptyOutline();
  try {
    return outlineSchema.parse(JSON.parse(await fs2.readText(file)));
  } catch (err) {
    log.error("outline parse failed", workId, err);
    return emptyOutline();
  }
}

/** 持久化结构树。 */
export async function saveOutline(root: string, workId: string, outline: Outline): Promise<void> {
  const fs2 = createFs(root);
  const validated = outlineSchema.parse(outline);
  await fs2.writeText(outlineFile(workId), JSON.stringify(validated, null, 2));
}

/** 计算同一父节点下的最大 order，用于追加新节点。 */
function nextOrder(outline: Outline, parentId: string | null): number {
  const siblings = outline.nodes.filter((n) => n.parentId === parentId);
  return siblings.length ? Math.max(...siblings.map((n) => n.order)) + 1 : 0;
}

/** 新增节点（volume / chapter / scene）。 */
export async function addNode(
  root: string,
  workId: string,
  input: { type: OutlineNode["type"]; title: string; parentId: string | null }
): Promise<Outline> {
  const outline = await loadOutline(root, workId);
  const now = Date.now();
  const node: OutlineNode = outlineNodeSchema.parse({
    id: crypto.randomUUID(),
    type: input.type,
    title: input.title,
    parentId: input.parentId,
    order: nextOrder(outline, input.parentId),
    createdAt: now,
    updatedAt: now,
  });
  const next = { nodes: [...outline.nodes, node] };
  await saveOutline(root, workId, next);
  return next;
}

/** 原地更新节点字段（title / status / synopsis / collapsed）。 */
export async function updateNode(
  root: string,
  workId: string,
  nodeId: string,
  patch: Partial<Pick<OutlineNode, "title" | "status" | "synopsis" | "collapsed" | "order" | "parentId">>
): Promise<Outline> {
  const outline = await loadOutline(root, workId);
  const nodes = outline.nodes.map((n) =>
    n.id === nodeId ? outlineNodeSchema.parse({ ...n, ...patch, updatedAt: Date.now() }) : n
  );
  const next = { nodes };
  await saveOutline(root, workId, next);
  return next;
}

/** 删除节点及其所有后代（级联）。 */
export async function removeNode(root: string, workId: string, nodeId: string): Promise<Outline> {
  const outline = await loadOutline(root, workId);
  const toRemove = new Set<string>([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of outline.nodes) {
      if (n.parentId && toRemove.has(n.parentId) && !toRemove.has(n.id)) {
        toRemove.add(n.id);
        changed = true;
      }
    }
  }
  const next = { nodes: outline.nodes.filter((n) => !toRemove.has(n.id)) };
  await saveOutline(root, workId, next);
  return next;
}
