import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import type { LongTaskState } from "@/contexts/long-task";

export default function LongTaskOverlay({
  task,
  visible,
}: {
  task: LongTaskState | null;
  visible: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const taskId = task?.id ?? null;

  useEffect(() => {
    if (taskId === null || !visible) return;
    const previous = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [taskId, visible]);

  if (!task || !visible) return null;

  const total = task.total ?? 0;
  const done = Math.max(0, task.done ?? 0);
  const determinate = total > 0;
  const percent = determinate
    ? Math.min(100, Math.round((done / total) * 100))
    : null;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="bg-background/75 fixed inset-0 z-[120] flex items-center justify-center p-6 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="long-task-title"
      aria-describedby={task.description ? "long-task-description" : undefined}
      aria-busy="true"
      data-long-task-overlay
      onKeyDown={(event) => {
        if (event.key === "Tab") event.preventDefault();
      }}
    >
      <div className="bg-card w-full max-w-md overflow-hidden rounded-md border shadow-xl">
        <div className="flex items-start gap-3 border-b px-5 py-4">
          <span className="bg-accent text-accent-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md">
            <Loader2 className="size-4 animate-spin" />
          </span>
          <div className="min-w-0 flex-1">
            <p id="long-task-title" className="text-sm font-semibold">
              {task.title}
            </p>
            {task.description ? (
              <p
                id="long-task-description"
                className="text-muted-foreground mt-1 text-xs leading-relaxed"
              >
                {task.description}
              </p>
            ) : null}
          </div>
        </div>

        <div className="px-5 py-4" aria-live="polite">
          <div className="mb-2 flex min-w-0 items-center justify-between gap-4 text-xs">
            <span className="text-muted-foreground min-w-0 truncate">
              {task.detail || task.title}
            </span>
            {determinate ? (
              <span className="text-foreground shrink-0 tabular-nums">
                {done}/{total} · {percent}%
              </span>
            ) : (
              <span className="text-muted-foreground shrink-0">…</span>
            )}
          </div>

          {determinate ? (
            <Progress value={percent ?? 0} className="h-1.5" />
          ) : (
            <div className="bg-muted h-1.5 overflow-hidden rounded-full">
              <div className="long-task-progress-indeterminate bg-primary h-full rounded-full" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
