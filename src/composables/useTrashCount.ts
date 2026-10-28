import { useEffect, useState } from "react";

import { listTrash, TRASH_CHANGED_EVENT } from "@/services/trash";

/** 回收站入口共用的可恢复数量。 */
export function useTrashCount(root: string | null, revision = 0): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;

    const reload = async () => {
      if (!root) {
        if (active) setCount(0);
        return;
      }
      try {
        const items = await listTrash(root);
        if (active) setCount(items.length);
      } catch {
        if (active) setCount(0);
      }
    };

    void reload();
    window.addEventListener(TRASH_CHANGED_EVENT, reload);
    return () => {
      active = false;
      window.removeEventListener(TRASH_CHANGED_EVENT, reload);
    };
  }, [revision, root]);

  return count;
}
