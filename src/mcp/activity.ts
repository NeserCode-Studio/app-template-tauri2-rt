export interface McpActivity {
  id: string;
  clientName: string;
  toolName: string;
  startedAt: number;
}

type ActivityListener = (activities: McpActivity[]) => void;

const active = new Map<string, McpActivity>();
const listeners = new Set<ActivityListener>();

function notify(): void {
  const items = [...active.values()].sort((a, b) => a.startedAt - b.startedAt);
  for (const listener of listeners) listener(items);
}

export function subscribeActivity(listener: ActivityListener): () => void {
  listeners.add(listener);
  listener([...active.values()]);
  return () => listeners.delete(listener);
}

export function beginActivity(
  id: string,
  clientName: string,
  toolName: string
): void {
  active.set(id, { id, clientName, toolName, startedAt: Date.now() });
  notify();
}

export function endActivity(id: string): void {
  if (!active.delete(id)) return;
  notify();
}

export function activeActivities(): McpActivity[] {
  return [...active.values()];
}
