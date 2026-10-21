import type { AppPage } from "@/lib/navigation";

export type McpActivityStatus =
  "running" | "completed" | "failed" | "cancelled";

export interface McpActivityDescriptor {
  toolName: string;
  operationKey: string;
  page: AppPage | null;
  interruptible: boolean;
  workId?: string | null;
  chapterId?: string | null;
  total?: number;
}

export interface McpActivity extends McpActivityDescriptor {
  id: string;
  clientName: string;
  clientVersion?: string;
  status: McpActivityStatus;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  progress?: number;
  detail?: string;
  resultCount?: number;
  error?: string;
  cancelling?: boolean;
  refreshing?: boolean;
}

export interface McpActivitySnapshot {
  active: McpActivity[];
  recent: McpActivity[];
}

type ActivityListener = (snapshot: McpActivitySnapshot) => void;

const active = new Map<string, McpActivity>();
let recent: McpActivity[] = [];
const listeners = new Set<ActivityListener>();
const MAX_RECENT = 500;
const RECENT_RETENTION_MS = 30 * 60 * 1_000;

function pruneRecent(now = Date.now()): void {
  recent = recent
    .filter((item) => now - (item.finishedAt ?? now) < RECENT_RETENTION_MS)
    .slice(0, MAX_RECENT);
}

function snapshot(): McpActivitySnapshot {
  pruneRecent();
  return {
    active: [...active.values()].sort((a, b) => a.startedAt - b.startedAt),
    recent: [...recent].sort(
      (a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)
    ),
  };
}

function notify(): void {
  const next = snapshot();
  for (const listener of listeners) listener(next);
}

export function subscribeActivity(listener: ActivityListener): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

export function beginActivity(
  id: string,
  clientName: string,
  clientVersion: string | undefined,
  descriptor: McpActivityDescriptor
): void {
  const now = Date.now();
  active.set(id, {
    ...descriptor,
    id,
    clientName,
    clientVersion,
    status: "running",
    startedAt: now,
    updatedAt: now,
  });
  notify();
}

export function updateActivity(
  id: string,
  patch: Partial<
    Pick<
      McpActivity,
      "progress" | "total" | "detail" | "cancelling" | "refreshing" | "error"
    >
  >
): void {
  const current = active.get(id);
  if (!current) return;
  active.set(id, {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  });
  notify();
}

export function finishActivity(
  id: string,
  status: Exclude<McpActivityStatus, "running">,
  patch: Partial<Pick<McpActivity, "resultCount" | "error" | "detail">> = {}
): void {
  const current = active.get(id);
  if (!current) return;
  const now = Date.now();
  active.delete(id);
  recent.unshift({
    ...current,
    ...patch,
    status,
    finishedAt: now,
    updatedAt: now,
    cancelling: false,
    refreshing: false,
  });
  pruneRecent(now);
  notify();
}

export function currentActivitySnapshot(): McpActivitySnapshot {
  return snapshot();
}

export function clearActivityHistory(): void {
  active.clear();
  recent = [];
  notify();
}
