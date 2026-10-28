/**
 * 结构操作的命令历史栈。
 *
 * 浏览器的原生 undo 只作用于输入框缓冲区，管不到卡片的新增 / 重排 /
 * 删除 / 拆分 / 合并这类结构变化，因此编辑器必须自建历史。
 *
 * 设计取舍：只存「操作前的卡片数组快照」，不做命令模式。
 * 单章 3 万字以内、卡片通常几十到几百张，快照成本可接受；
 * 换来的是实现简单、撤销行为绝对正确（不会出现状态漂移）。
 */

export interface HistoryOptions {
  /** 保留的最大历史长度。 */
  limit?: number;
}

export class CommandHistory<T> {
  /** past[i] 是第 i 步操作之前的快照。 */
  private past: T[] = [];
  private future: T[] = [];
  /** 当前状态，用于在 record 时捕获"操作前"的值。 */
  private current: T;
  private readonly limit: number;

  constructor(initial: T, options: HistoryOptions = {}) {
    this.current = initial;
    this.limit = options.limit ?? 100;
  }

  /** 提交一次新的当前状态（即"操作已完成"）。 */
  record(next: T): void {
    if (this.equal(next, this.current)) return;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = next;
    // 新操作会作废 redo 分支。
    this.future.length = 0;
  }

  /** 撤销：返回上一状态；无可撤销时返回 null。 */
  undo(): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.unshift(this.current);
    this.current = prev;
    return prev;
  }

  /** 重做：返回下一状态；无可重做时返回 null。 */
  redo(): T | null {
    const next = this.future.shift();
    if (next === undefined) return null;
    this.past.push(this.current);
    this.current = next;
    return next;
  }

  /** 是否可撤销 / 可重做。 */
  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** 当前状态（引用）。 */
  get value(): T {
    return this.current;
  }

  /** 外部直接替换当前状态（如切章加载），会清空历史。 */
  reset(next: T): void {
    this.current = next;
    this.past.length = 0;
    this.future.length = 0;
  }

  /** 深比较：卡片数组按引用比较即可（每次操作都产生新数组）。 */
  private equal(a: T, b: T): boolean {
    return a === b;
  }
}
