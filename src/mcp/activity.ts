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
  targetLabel?: string | null;
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
  queued?: boolean;
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
const ACTIVITY_STORAGE_PREFIX = "novels-yes:mcp-recent-activity:";
const NOTIFY_THROTTLE_MS = 120;
let activityScope = "global";
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let lastNotifiedAt = 0;

function pruneRecent(now = Date.now()): void {
  recent = recent
    .filter((item) => now - (item.finishedAt ?? now) < RECENT_RETENTION_MS)
    .slice(0, MAX_RECENT);
}

function storedActivity(value: unknown): McpActivity | null {
  if (!value || typeof value !== "object") return null;
  const item = value as McpActivity;
  if (
    typeof item.id !== "string" ||
    typeof item.toolName !== "string" ||
    typeof item.operationKey !== "string" ||
    typeof item.clientName !== "string" ||
    typeof item.startedAt !== "number" ||
    typeof item.updatedAt !== "number" ||
    typeof item.finishedAt !== "number" ||
    (item.status !== "completed" &&
      item.status !== "failed" &&
      item.status !== "cancelled")
  ) {
    return null;
  }
  return {
    ...item,
    interruptible: Boolean(item.interruptible),
    page: item.page ?? null,
    detail: item.detail?.slice(0, 240),
    error: item.error?.slice(0, 240),
    queued: false,
    cancelling: false,
    refreshing: false,
  };
}

function loadRecentScope(scope: string): McpActivity[] {
  try {
    const raw = window.localStorage.getItem(ACTIVITY_STORAGE_PREFIX + scope);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(storedActivity)
      .filter((item): item is McpActivity => item !== null);
  } catch {
    return [];
  }
}

function persistRecent(): void {
  try {
    const key = ACTIVITY_STORAGE_PREFIX + activityScope;
    if (!recent.length) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(recent));
  } catch {
    /* Local storage may be unavailable; activity still works in memory. */
  }
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

function emit(): void {
  lastNotifiedAt = Date.now();
  const next = snapshot();
  for (const listener of listeners) listener(next);
}

function notify(): void {
  if (!listeners.size) return;
  const elapsed = Date.now() - lastNotifiedAt;
  if (elapsed >= NOTIFY_THROTTLE_MS) {
    if (notifyTimer) {
      clearTimeout(notifyTimer);
      notifyTimer = null;
    }
    emit();
    return;
  }
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    emit();
  }, NOTIFY_THROTTLE_MS - elapsed);
}

function notifyImmediately(): void {
  if (notifyTimer) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
  emit();
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
  if (
    descriptor.toolName === "novels_navigate" ||
    descriptor.toolName === "novels_open_chapter"
  ) {
    notifyImmediately();
  } else {
    notify();
  }
}

export function updateActivity(
  id: string,
  patch: Partial<
    Pick<
      McpActivity,
      | "progress"
      | "total"
      | "detail"
      | "cancelling"
      | "refreshing"
      | "error"
      | "queued"
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
    queued: false,
    finishedAt: now,
    updatedAt: now,
    cancelling: false,
    refreshing: false,
  });
  pruneRecent(now);
  persistRecent();
  notify();
}

export function currentActivitySnapshot(): McpActivitySnapshot {
  return snapshot();
}

export function clearActivityHistory(): void {
  active.clear();
  recent = [];
  persistRecent();
  notifyImmediately();
}

export function setActivityScope(scope: string): void {
  if (scope === activityScope) return;
  activityScope = scope;
  active.clear();
  recent = loadRecentScope(scope);
  pruneRecent();
  persistRecent();
  notifyImmediately();
}
