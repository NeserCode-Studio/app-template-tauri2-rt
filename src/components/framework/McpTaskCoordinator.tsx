import { useEffect, useRef } from "react";

import { useLibrary } from "@/contexts/library";
import { useOutline } from "@/contexts/outline";
import { APP_PAGE_PATHS, useAppNavigation } from "@/lib/navigation";
import { useMcpActivity } from "@/mcp/use-activity";
import McpTaskOverlay from "./McpTaskOverlay";

export default function McpTaskCoordinator() {
  const activity = useMcpActivity();
  const { currentWorkId, setCurrentWorkId } = useLibrary();
  const { openChapter } = useOutline();
  const { navigateDirect } = useAppNavigation();
  const handled = useRef(new Set<string>());

  useEffect(() => {
    const activeIds = new Set(activity.active.map((task) => task.id));
    for (const id of handled.current) {
      if (!activeIds.has(id)) handled.current.delete(id);
    }
    for (const task of activity.active) {
      if (!task.page || handled.current.has(task.id)) continue;
      handled.current.add(task.id);

      if (task.workId && task.chapterId) {
        openChapter(task.workId, task.chapterId);
      } else if (task.workId && task.workId !== currentWorkId) {
        setCurrentWorkId(task.workId);
      }

      const page =
        task.page === "editor" && !task.workId && !currentWorkId
          ? "library"
          : task.page;
      navigateDirect(APP_PAGE_PATHS[page]);
    }
  }, [
    activity.active,
    currentWorkId,
    navigateDirect,
    openChapter,
    setCurrentWorkId,
  ]);

  return <McpTaskOverlay />;
}
