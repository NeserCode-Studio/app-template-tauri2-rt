import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

export type McpEditorOperationStatus =
  "receiving" | "queued" | "running" | "completed" | "failed" | "cancelled";

export interface McpEditorOperation {
  id: string;
  requestId: string | null;
  streamId: string | null;
  toolName: string;
  workId: string;
  chapterId: string;
  status: McpEditorOperationStatus;
  previewText: string;
  receivedChars: number;
  receivedChunks: number;
  chunkTotal: number;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  error?: string;
}

interface OperationTimer {
  clearTimer: number | null;
  expiryTimer: number | null;
}

interface BeginEditorOperationInput {
  id: string;
  requestId?: string | null;
  streamId?: string | null;
  toolName: string;
  workId: string;
  chapterId: string;
  previewText?: string;
  receivedChars?: number;
  receivedChunks?: number;
  chunkTotal?: number;
}

const MIN_VISIBLE_MS = 1_200;
const FINISHED_HOLD_MS = 350;
const ORPHANED_STREAM_TTL_MS = 5 * 60 * 1_000;
const operations = new Map<string, McpEditorOperation>();
const timers = new Map<string, OperationTimer>();
const listeners = new Set<() => void>();
let snapshot: readonly McpEditorOperation[] = [];

function publish(): void {
  snapshot = [...operations.values()].sort(
    (left, right) => right.updatedAt - left.updatedAt
  );
  for (const listener of listeners) listener();
}

function clearTimers(id: string): void {
  const timer = timers.get(id);
  if (!timer) return;
  if (timer.clearTimer !== null) window.clearTimeout(timer.clearTimer);
  if (timer.expiryTimer !== null) window.clearTimeout(timer.expiryTimer);
  timers.delete(id);
}

function removeOperation(id: string): void {
  clearTimers(id);
  if (operations.delete(id)) publish();
}

function scheduleOrphanExpiry(id: string): void {
  const current = timers.get(id) ?? {
    clearTimer: null,
    expiryTimer: null,
  };
  if (current.expiryTimer !== null) window.clearTimeout(current.expiryTimer);
  current.expiryTimer = window.setTimeout(
    () => removeOperation(id),
    ORPHANED_STREAM_TTL_MS
  );
  timers.set(id, current);
}

function upsert(
  input: BeginEditorOperationInput,
  status: McpEditorOperationStatus
): McpEditorOperation {
  const now = Date.now();
  const existing = operations.get(input.id);
  const next: McpEditorOperation = {
    id: input.id,
    requestId: input.requestId ?? existing?.requestId ?? null,
    streamId: input.streamId ?? existing?.streamId ?? null,
    toolName: input.toolName,
    workId: input.workId,
    chapterId: input.chapterId,
    status,
    previewText: input.previewText ?? existing?.previewText ?? "",
    receivedChars:
      input.receivedChars ??
      existing?.receivedChars ??
      input.previewText?.length ??
      0,
    receivedChunks: input.receivedChunks ?? existing?.receivedChunks ?? 0,
    chunkTotal: input.chunkTotal ?? existing?.chunkTotal ?? 0,
    startedAt: existing?.startedAt ?? now,
    updatedAt: now,
  };
  operations.set(input.id, next);
  scheduleOrphanExpiry(input.id);
  publish();
  return next;
}

export function beginMcpEditorOperation(
  input: BeginEditorOperationInput
): void {
  clearTimers(input.id);
  operations.delete(input.id);
  upsert(input, "receiving");
}

export function receiveMcpEditorChunk(input: {
  streamId: string;
  toolName: string;
  workId: string;
  chapterId: string;
  previewText: string;
  receivedChunks: number;
  chunkTotal: number;
}): void {
  const current = operations.get(input.streamId);
  upsert(
    {
      id: input.streamId,
      streamId: input.streamId,
      toolName: input.toolName,
      workId: input.workId,
      chapterId: input.chapterId,
      previewText: input.previewText,
      receivedChars: input.previewText.length,
      receivedChunks: input.receivedChunks,
      chunkTotal: input.chunkTotal,
      requestId: current?.requestId ?? null,
    },
    "receiving"
  );
}

export function queueMcpEditorOperation(input: {
  id: string;
  requestId: string;
  toolName: string;
  workId: string;
  chapterId: string;
  previewText: string;
  receivedChunks?: number;
  chunkTotal?: number;
}): void {
  const current = operations.get(input.id);
  upsert(
    {
      ...input,
      streamId:
        current?.streamId ?? (input.id !== input.requestId ? input.id : null),
      receivedChars: input.previewText.length,
    },
    "queued"
  );
}

export function markMcpEditorOperationRunning(id: string): void {
  const current = operations.get(id);
  if (!current) return;
  upsert(
    {
      id,
      requestId: current.requestId,
      streamId: current.streamId,
      toolName: current.toolName,
      workId: current.workId,
      chapterId: current.chapterId,
      previewText: current.previewText,
      receivedChars: current.receivedChars,
      receivedChunks: current.receivedChunks,
      chunkTotal: current.chunkTotal,
    },
    "running"
  );
}

export function finishMcpEditorOperation(
  id: string,
  status: Extract<
    McpEditorOperationStatus,
    "completed" | "failed" | "cancelled"
  >,
  error?: string
): void {
  const current = operations.get(id);
  if (!current) return;
  const now = Date.now();
  const next: McpEditorOperation = {
    ...current,
    status,
    error,
    finishedAt: now,
    updatedAt: now,
  };
  operations.set(id, next);

  const timer = timers.get(id) ?? {
    clearTimer: null,
    expiryTimer: null,
  };
  if (timer.expiryTimer !== null) {
    window.clearTimeout(timer.expiryTimer);
    timer.expiryTimer = null;
  }
  if (timer.clearTimer !== null) window.clearTimeout(timer.clearTimer);
  const clearAt = Math.max(
    now + FINISHED_HOLD_MS,
    current.startedAt + MIN_VISIBLE_MS
  );
  timer.clearTimer = window.setTimeout(
    () => removeOperation(id),
    Math.max(0, clearAt - now)
  );
  timers.set(id, timer);
  publish();
}

export function clearMcpEditorOperations(): void {
  for (const id of operations.keys()) clearTimers(id);
  operations.clear();
  publish();
}

export function subscribeMcpEditorOperations(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMcpEditorOperations(): readonly McpEditorOperation[] {
  return snapshot;
}

export function useMcpEditorOperation(
  workId: string,
  chapterId: string
): (McpEditorOperation & { visibleText: string }) | null {
  const all = useSyncExternalStore(
    subscribeMcpEditorOperations,
    getMcpEditorOperations,
    getMcpEditorOperations
  );
  const operation = useMemo(() => {
    const matching = all.filter(
      (item) => item.workId === workId && item.chapterId === chapterId
    );
    return (
      matching.find(
        (item) =>
          item.status !== "completed" &&
          item.status !== "failed" &&
          item.status !== "cancelled"
      ) ??
      matching[0] ??
      null
    );
  }, [all, workId, chapterId]);
  const [visibleChars, setVisibleChars] = useState(0);

  useEffect(() => {
    setVisibleChars(0);
  }, [operation?.id]);

  useEffect(() => {
    if (!operation?.previewText) return;
    const target = operation.previewText.length;
    const step = 6;
    let timer: number | null = null;
    const tick = () => {
      setVisibleChars((current) => {
        const next = Math.min(target, current + step);
        if (next >= target && timer !== null) {
          window.clearInterval(timer);
          timer = null;
        }
        return next;
      });
    };
    timer = window.setInterval(tick, 16);
    tick();
    return () => {
      if (timer !== null) window.clearInterval(timer);
    };
  }, [operation?.id, operation?.previewText]);

  if (!operation) return null;
  return {
    ...operation,
    visibleText: operation.previewText.slice(0, visibleChars),
  };
}
