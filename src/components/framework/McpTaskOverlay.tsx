import { useEffect, useState } from "react";
import { LoaderCircle, LockKeyhole } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/composables";
import { subscribeApprovals } from "@/mcp/approval";
import { useMcpActivity } from "@/mcp/use-activity";

export default function McpTaskOverlay() {
  const { t } = useI18n();
  const activity = useMcpActivity();
  const [approvalCount, setApprovalCount] = useState(0);
  useEffect(
    () => subscribeApprovals((requests) => setApprovalCount(requests.length)),
    []
  );
  const blockingTasks = activity.active.filter((item) => !item.interruptible);
  const task = blockingTasks[0];

  if (!task || approvalCount > 0) return null;

  const total = task.total ?? 0;
  const done = Math.max(0, task.progress ?? 0);
  const determinate = total > 0;
  const percent = determinate
    ? Math.min(100, Math.round((done / total) * 100))
    : null;

  return (
    <div
      className="bg-background/78 fixed inset-x-0 top-8 bottom-0 z-[100] flex items-center justify-center p-6 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-mcp-task-overlay
    >
      <div className="bg-card w-full max-w-md overflow-hidden rounded-md border shadow-xl">
        <div className="flex items-start gap-3 border-b px-5 py-4">
          <span className="bg-accent text-accent-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md">
            <LoaderCircle className="size-4 animate-spin" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t(task.operationKey)}</p>
            <p className="text-muted-foreground mt-1 truncate text-xs">
              {task.clientName}
              {task.clientVersion ? ` · v${task.clientVersion}` : ""}
            </p>
          </div>
          <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-[11px]">
            <LockKeyhole className="size-3" />
            {t("Mcp.task.uninterruptible")}
          </span>
        </div>

        <div className="px-5 py-4">
          <div className="mb-2 flex min-w-0 items-center justify-between gap-4 text-xs">
            <span className="text-muted-foreground min-w-0 truncate">
              {task.refreshing
                ? t("Mcp.task.refreshing")
                : (task.detail ?? t(task.operationKey))}
            </span>
            <span className="text-foreground shrink-0 tabular-nums">
              {determinate ? `${done}/${total} · ${percent}%` : "1"}
            </span>
          </div>
          {determinate ? (
            <Progress value={percent ?? 0} className="h-1.5" />
          ) : (
            <div className="bg-muted h-1.5 overflow-hidden rounded-full">
              <div className="long-task-progress-indeterminate bg-primary h-full rounded-full" />
            </div>
          )}
          {blockingTasks.length > 1 ? (
            <p className="text-muted-foreground mt-3 text-[11px]">
              {t("Mcp.task.moreBlocking").replace(
                "{count}",
                String(blockingTasks.length - 1)
              )}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
