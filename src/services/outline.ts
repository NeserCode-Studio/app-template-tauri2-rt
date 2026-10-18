/**
 * 结构树服务：卷 / 章 / 场景的扁平节点数组，持久化到 outline.json。
 *
 * 节点关系由 parentId 表达，顺序由 order 表达，避免用文件夹层级
 * 隐式表达层级，保证排序与升降级可靠。
 */

import { createFs, joinRel } from "./fs";
import { outlineFile } from "./paths";
import {
  chapterSchema,
  outlineSchema,
  outlineNodeSchema,
  type Outline,
  type OutlineNode,
} from "@/shared/schema";
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
  input: {
    type: OutlineNode["type"];
    title: string;
    parentId: string | null;
    /**
     * 显式指定节点 id。
     *
     * 章节点必须复用章文件自身的 id：正文落盘在 `chapters/<id>.json`，
     * 而打开哪一章由结构树 id 决定。两者若各自生成随机 id，
     * 打开章节就会按结构树 id 去找一个不存在的文件。
     */
    id?: string;
  }
): Promise<Outline> {
  const outline = await loadOutline(root, workId);
  const now = Date.now();
  const node: OutlineNode = outlineNodeSchema.parse({
    id: input.id ?? crypto.randomUUID(),
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

/**
 * 修复历史遗留：结构树里的章 id 与章文件名对不上。
 *
 * 成因是早期版本建章时，章文件与结构树节点各自生成了一个随机 id，
 * 于是 `chapters/<outlineId>.json` 永远不存在。对用户的表现是
 * "章节切不动、保存后重进是空章"。
 *
 * 配对依据用创建时间邻近度：同一次建章产生的两个 createdAt 只差十几毫秒，
 * 而彼此无关的章节相隔通常以秒计。标题不可靠——早期版本所有章都叫
 * "新建章节"，按标题配对会歧义。
 *
 * 只接受互相都是最近邻的配对（双向唯一），并要求时间差在容差内，
 * 避免把两章内容串错。对不上的保持原样，宁可不修也不弄错。
 */
export async function reconcileChapterIds(
  root: string,
  workId: string,
  outline: Outline
): Promise<Outline> {
  const fs2 = createFs(root);
  let files: string[];
  try {
    files = await fs2.readDir(joinRel("works", workId, "chapters"));
  } catch {
    return outline;
  }

  const onDisk = files.filter((f) => f.endsWith(".json"));
  if (!onDisk.length) return outline;
  const diskIds = new Set(onDisk.map((f) => f.slice(0, -".json".length)));

  const broken = outline.nodes.filter(
    (n) => n.type === "chapter" && !diskIds.has(n.id)
  );
  if (!broken.length) return outline;

  const claimed = new Set(
    outline.nodes.filter((n) => n.type === "chapter" && diskIds.has(n.id)).map((n) => n.id)
  );
  /** 盘面上无人认领的章文件。 */
  const free = onDisk.map((f) => f.slice(0, -".json".length)).filter((id) => !claimed.has(id));
  if (!free.length) return outline;

  /** 读出每个游离章文件的创建时间与标题。 */
  const infos = new Map<string, { createdAt: number; title: string }>();
  for (const id of free) {
    try {
      const raw = await fs2.readText(joinRel("works", workId, "chapters", id + ".json"));
      const parsed = chapterSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        infos.set(id, { createdAt: parsed.data.createdAt, title: parsed.data.title });
      }
    } catch (err) {
      log.warn("reconcile: chapter unreadable", id, err);
    }
  }
  if (!infos.size) return outline;

  /** 同一时刻建的两章误差在百毫秒内；超过这个跨度就不认。 */
  const TOLERANCE_MS = 5_000;
  const used = new Set<string>();
  const mapping = new Map<string, string>();
  for (const node of broken) {
    /* 在尚未被认领的游离章文件里找时间最近的一个。 */
    let bestId: string | null = null;
    let bestDelta = Infinity;
    for (const [diskId, info] of infos) {
      if (used.has(diskId)) continue;
      const delta = Math.abs(info.createdAt - node.createdAt);
      if (delta > TOLERANCE_MS) continue;
      if (delta < bestDelta) {
        bestDelta = delta;
        bestId = diskId;
      }
    }
    if (!bestId) continue;

    /*
     * 双向唯一性校验：该文件到这个节点的距离必须严格小于它到任何其他
     * 待配对节点的距离。否则说明两个章节在时间上挨得太近，分不清谁是谁，
     * 这时宁可不修，也不把两章内容串起来。
     */
    const fileCreatedAt = infos.get(bestId)!.createdAt;
    let ambiguous = false;
    for (const other of broken) {
      if (other.id === node.id || used.has(other.id)) continue;
      if (Math.abs(fileCreatedAt - other.createdAt) <= bestDelta) {
        ambiguous = true;
        break;
      }
    }
    if (ambiguous) continue;

    used.add(bestId);
    mapping.set(node.id, bestId);
  }
  if (!mapping.size) return outline;

  const next: Outline = {
    nodes: outline.nodes.map((n) => {
      const diskId = mapping.get(n.id);
      return diskId ? { ...n, id: diskId } : n;
    }),
  };
  await saveOutline(root, workId, next);
  log.warn("reconciled chapter ids", { workId, mapping: Object.fromEntries(mapping) });
  return next;
}
