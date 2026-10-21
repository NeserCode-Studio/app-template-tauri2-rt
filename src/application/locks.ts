const tails = new Map<string, Promise<void>>();

export async function withKeyedLock<T>(
  key: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  tails.set(key, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}

export function chapterLockKey(
  root: string,
  workId: string,
  chapterId: string
): string {
  return `chapter:${root}:${workId}:${chapterId}`;
}

export function workLockKey(root: string, workId: string): string {
  return `work:${root}:${workId}`;
}

export function workspaceLockKey(root: string): string {
  return `workspace:${root}`;
}
