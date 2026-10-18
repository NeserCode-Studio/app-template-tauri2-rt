/**
 * 结构树同级换位的下标计算。
 *
 * 服务端 `moveNode` 的语义是「把被拖节点从原列表取出后，插入到
 * targetIndex 处」，所以必须在**不含自己**的列表里找目标位置。
 * 直接用含自己的列表下标会整体偏移一位，插回去就是原位——
 * 表现正是"能拖、预览会动、一松手复原"。
 *
 * 独立成模块而不是塞在组件里：交互无法在无头环境复现，把算法
 * 抽成纯函数才能脱离 React 直接验证它的对错。
 */

export function computeMoveIndex(
  siblings: { id: string }[],
  nodeId: string,
  targetId: string
): number {
  const without = siblings.filter((n) => n.id !== nodeId);
  const index = without.findIndex((n) => n.id === targetId);
  /* 目标不在同组，或自己已经在目标之前，无需写入。 */
  if (index < 0) return -1;
  const current = siblings.findIndex((n) => n.id === nodeId);
  if (current === index) return -1;
  return index;
}
