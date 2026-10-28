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

/**
 * 按指针位置计算同级插入下标。
 *
 * dnd-kit 的 `over` 依赖碰撞检测的结果，而碰撞检测在 WebView 里
 * 反复失准（表现为预览会动、松手复原）。这里改用拖拽元素松手时的
 * 实际矩形来算：取被拖元素的纵向中心，在同级列表里找第一个
 * "中心在它下方"的元素，下标就是插入位置。
 *
 * 好处是判断依据与用户眼睛看到的预览完全一致——预览把元素挪到了
 * 哪，这个函数就算到哪，不会出现"看到的顺序"和"写盘的顺序"不一致。
 *
 * @param centers 同级元素的纵向中心（不含被拖元素），须按当前视觉顺序排列
 * @param draggedCenter 被拖元素当前的纵向中心
 * @returns 插入下标；落在末尾时返回 centers.length
 */
export function computeIndexByPosition(centers: number[], draggedCenter: number): number {
  for (let i = 0; i < centers.length; i += 1) {
    if (centers[i] > draggedCenter) return i;
  }
  return centers.length;
}
