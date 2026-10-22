import type { McpActivity, McpActivitySnapshot } from "./activity";

export const MCP_BATCH_IDLE_MS = 800;
export const MCP_BATCH_MIN_VISIBLE_MS = 1_200;
export const MCP_BATCH_COMPLETED_VISIBLE_MS = 2_400;
export const MCP_BATCH_FAILED_VISIBLE_MS = 4_000;

export type McpActivityBatchStatus =
  "running" | "completed" | "failed" | "cancelled";

export interface McpActivityBatch {
  id: string;
  tasks: McpActivity[];
  clientNames: string[];
  activeCount: number;
  runningCount: number;
  queuedCount: number;
  finishedCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  total: number;
  percent: number;
  status: McpActivityBatchStatus;
  currentTask: McpActivity | null;
  startedAt: number;
  finishedAt: number | null;
  expiresAt: number | null;
}

interface MutableBatch {
  tasks: McpActivity[];
  hasActive: boolean;
  lastStartedAt: number;
  lastFinishedAt: number | null;
}

function byStartTime(left: McpActivity, right: McpActivity): number {
  return left.startedAt - right.startedAt || left.id.localeCompare(right.id);
}

function currentRunningTask(tasks: McpActivity[]): McpActivity | null {
  return (
    tasks
      .filter((task) => !task.queued)
      .sort((left, right) => left.startedAt - right.startedAt)[0] ?? null
  );
}

function finalizeBatch(tasks: McpActivity[]): McpActivityBatch {
  const active = tasks.filter((task) => task.status === "running");
  const terminal = tasks.filter((task) => task.status !== "running");
  const runningCount = active.filter((task) => !task.queued).length;
  const queuedCount = active.filter((task) => task.queued).length;
  const completedCount = terminal.filter(
    (task) => task.status === "completed"
  ).length;
  const failedCount = terminal.filter(
    (task) => task.status === "failed"
  ).length;
  const cancelledCount = terminal.filter(
    (task) => task.status === "cancelled"
  ).length;
  const finishedCount = terminal.length;
  const total = tasks.length;
  const finishedAt = active.length
    ? null
    : Math.max(...terminal.map((task) => task.finishedAt ?? 0));
  const status: McpActivityBatchStatus = active.length
    ? "running"
    : failedCount > 0
      ? "failed"
      : completedCount === 0 && cancelledCount > 0
        ? "cancelled"
        : "completed";
  const startedAt = tasks[0].startedAt;
  const holdMs =
    status === "failed"
      ? MCP_BATCH_FAILED_VISIBLE_MS
      : MCP_BATCH_COMPLETED_VISIBLE_MS;
  const expiresAt =
    finishedAt === null
      ? null
      : Math.max(startedAt + MCP_BATCH_MIN_VISIBLE_MS, finishedAt + holdMs);
  const currentTask =
    currentRunningTask(active) ??
    active.find((task) => task.queued) ??
    terminal.sort(
      (left, right) => (right.finishedAt ?? 0) - (left.finishedAt ?? 0)
    )[0] ??
    null;

  return {
    id: tasks[0].id,
    tasks,
    clientNames: [...new Set(tasks.map((task) => task.clientName))],
    activeCount: active.length,
    runningCount,
    queuedCount,
    finishedCount,
    completedCount,
    failedCount,
    cancelledCount,
    total,
    percent: total ? Math.round((finishedCount / total) * 100) : 0,
    status,
    currentTask,
    startedAt,
    finishedAt,
    expiresAt,
  };
}

export function buildActivityBatches(
  activities: McpActivity[]
): McpActivityBatch[] {
  const sorted = [...activities].sort(byStartTime);
  const latestByClient = new Map<string, MutableBatch>();
  const batches: MutableBatch[] = [];

  for (const task of sorted) {
    let mutable = latestByClient.get(task.clientName);
    const quietSince = mutable
      ? (mutable.lastFinishedAt ?? mutable.lastStartedAt)
      : null;
    const joinsCurrent =
      mutable &&
      (mutable.hasActive ||
        (quietSince !== null &&
          task.startedAt - quietSince <= MCP_BATCH_IDLE_MS));

    if (!mutable || !joinsCurrent) {
      mutable = {
        tasks: [],
        hasActive: false,
        lastStartedAt: task.startedAt,
        lastFinishedAt: null,
      };
      latestByClient.set(task.clientName, mutable);
      batches.push(mutable);
    }

    mutable.tasks.push(task);
    mutable.lastStartedAt = Math.max(mutable.lastStartedAt, task.startedAt);
    mutable.hasActive ||= task.status === "running";
    if (task.finishedAt !== undefined) {
      mutable.lastFinishedAt = Math.max(
        mutable.lastFinishedAt ?? 0,
        task.finishedAt
      );
    }
  }

  return batches.map((batch) => finalizeBatch(batch.tasks));
}

function mergeBatches(batches: McpActivityBatch[]): McpActivityBatch {
  if (batches.length === 1) return batches[0];
  return finalizeBatch(
    batches.flatMap((batch) => batch.tasks).sort(byStartTime)
  );
}

export function displayedActivityBatch(
  snapshot: McpActivitySnapshot,
  now = Date.now()
): McpActivityBatch | null {
  const batches = buildActivityBatches([
    ...snapshot.active,
    ...snapshot.recent,
  ]);
  const activeBatches = batches.filter((batch) => batch.activeCount > 0);
  if (activeBatches.length) return mergeBatches(activeBatches);

  return (
    batches
      .filter((batch) => batch.expiresAt !== null && now < batch.expiresAt)
      .sort(
        (left, right) => (right.finishedAt ?? 0) - (left.finishedAt ?? 0)
      )[0] ?? null
  );
}
