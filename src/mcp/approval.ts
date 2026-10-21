export interface ApprovalRequest {
  id: string;
  toolName: string;
  title: string;
  target: string;
  summary: string;
  risk: "R2" | "R3";
  requestedAt: number;
  expiresAt: number;
}

type ApprovalListener = (requests: ApprovalRequest[]) => void;

const pending = new Map<
  string,
  {
    request: ApprovalRequest;
    resolve: (approved: boolean) => void;
    timer: number;
  }
>();
const listeners = new Set<ApprovalListener>();

function notify(): void {
  const requests = [...pending.values()]
    .map((entry) => entry.request)
    .sort((a, b) => a.requestedAt - b.requestedAt);
  for (const listener of listeners) listener(requests);
}

export function subscribeApprovals(listener: ApprovalListener): () => void {
  listeners.add(listener);
  listener([...pending.values()].map((entry) => entry.request));
  return () => listeners.delete(listener);
}

export function requestApproval(
  request: Omit<ApprovalRequest, "id" | "requestedAt" | "expiresAt">
): Promise<boolean> {
  const id = crypto.randomUUID();
  const requestedAt = Date.now();
  const expiresAt = requestedAt + 120_000;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      entry.resolve(false);
      notify();
    }, 120_000);
    pending.set(id, {
      request: { ...request, id, requestedAt, expiresAt },
      resolve,
      timer,
    });
    notify();
  });
}

export function resolveApproval(id: string, approved: boolean): void {
  const entry = pending.get(id);
  if (!entry) return;
  window.clearTimeout(entry.timer);
  pending.delete(id);
  entry.resolve(approved);
  notify();
}

export function pendingApprovals(): ApprovalRequest[] {
  return [...pending.values()]
    .map((entry) => entry.request)
    .sort((a, b) => a.requestedAt - b.requestedAt);
}
