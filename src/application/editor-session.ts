export interface EditorSessionSnapshot {
  workId: string | null;
  chapterId: string | null;
  dirty: boolean;
  saving: boolean;
}

type FlushHandler = () => Promise<void>;

let snapshot: EditorSessionSnapshot = {
  workId: null,
  chapterId: null,
  dirty: false,
  saving: false,
};
let flushHandler: FlushHandler | null = null;

export function setEditorSession(next: EditorSessionSnapshot): void {
  snapshot = next;
}

export function clearEditorSession(chapterId?: string): void {
  if (chapterId && snapshot.chapterId !== chapterId) return;
  snapshot = {
    workId: null,
    chapterId: null,
    dirty: false,
    saving: false,
  };
  flushHandler = null;
}

export function registerEditorFlush(handler: FlushHandler | null): void {
  flushHandler = handler;
}

export function getEditorSession(): EditorSessionSnapshot {
  return snapshot;
}

export async function flushCurrentChapter(): Promise<void> {
  if (flushHandler) await flushHandler();
}
