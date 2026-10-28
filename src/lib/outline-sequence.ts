import type { OutlineNode } from "@/shared/schema";

function byOutlineOrder(a: OutlineNode, b: OutlineNode): number {
  if (a.order !== b.order) return a.order - b.order;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * 按结构树的视觉顺序展开章节。
 *
 * 顶层卷与游离章共用 order 序列，必须交错排列；卷内章再按各自
 * order 展开。不能把游离章整体放在卷前，否则“最后一卷的末章”
 * 会因为后面还有游离章而被误判成中间章节。
 */
export function orderedChapterNodes(
  chapters: OutlineNode[],
  volumes: OutlineNode[]
): OutlineNode[] {
  const byParent = new Map<string | null, OutlineNode[]>();
  for (const node of chapters) {
    const list = byParent.get(node.parentId);
    if (list) list.push(node);
    else byParent.set(node.parentId, [node]);
  }
  for (const list of byParent.values()) list.sort(byOutlineOrder);

  const topLevel = [
    ...volumes.filter((volume) => volume.parentId === null),
    ...(byParent.get(null) ?? []),
  ].sort(byOutlineOrder);

  return topLevel.flatMap((node) =>
    node.type === "volume" ? (byParent.get(node.id) ?? []) : [node]
  );
}
