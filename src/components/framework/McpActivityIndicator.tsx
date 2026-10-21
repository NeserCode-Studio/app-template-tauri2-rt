import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Ban,
  CheckCircle2,
  CircleX,
  LoaderCircle,
  RadioTower,
  ShieldAlert,
  X,
} from "lucide-react";

import { useI18n } from "@/composables";
import { createLogger } from "@/lib/logger";
import {
  updateActivity,
  type McpActivity,
  type McpActivityStatus,
} from "@/mcp/activity";
import { subscribeApprovals } from "@/mcp/approval";
import { useMcpRuntime } from "@/mcp/runtime";
import { useMcpActivity } from "@/mcp/use-activity";
import McpStatusDialog from "./McpStatusDialog";

const log = createLogger("McpActivity");
const COMPLETED_VISIBLE_MS = 3_500;

function statusIcon(status: McpActivityStatus) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="icon-sm text-emerald-600" />;
    case "failed":
      return <CircleX className="icon-sm text-destructive" />;
    case "cancelled":
      return <Ban className="icon-sm text-muted-foreground" />;
    default:
      return <LoaderCircle className="icon-sm animate-spin" />;
  }
}

export default function McpActivityIndicator() {
  const { t } = useI18n();
  const runtime = useMcpRuntime();
  const activity = useMcpActivity();
  const [approvalCount, setApprovalCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(
    () => subscribeApprovals((requests) => setApprovalCount(requests.length)),
    []
  );
  useEffect(() => {
    const nextExpiry = activity.recent
      .filter((item) => item.interruptible)
      .map((item) => (item.finishedAt ?? 0) + COMPLETED_VISIBLE_MS)
      .filter((expiresAt) => expiresAt > now)
      .sort((left, right) => left - right)[0];
    if (!nextExpiry) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(50, nextExpiry - Date.now() + 20)
    );
    return () => window.clearTimeout(timer);
  }, [activity.recent, now]);

  const activeTasks = activity.active.filter((item) => item.interruptible);
  const completedTasks = activity.recent
    .filter(
      (item) =>
        item.interruptible &&
        (item.finishedAt ?? 0) > now - COMPLETED_VISIBLE_MS
    )
    .slice(0, 3);
  const tasks = [...activeTasks, ...completedTasks].slice(0, 3);
  const hiddenCount = activeTasks.length + completedTasks.length - tasks.length;

  const cancelTask = async (task: McpActivity) => {
    updateActivity(task.id, { cancelling: true });
    try {
      await invoke("mcp_bridge_cancel", { requestId: task.id });
    } catch (err) {
      updateActivity(task.id, { cancelling: false });
      log.warn("MCP task cancellation failed", {
        requestId: task.id,
        err,
      });
    }
  };

  if (!tasks.length && !approvalCount && runtime.phase !== "degraded") {
    return null;
  }

  return (
    <>
      <div className="fixed bottom-4 left-4 z-[105] flex w-[21rem] max-w-[calc(100vw-2rem)] flex-col gap-2">
        {tasks.map((task) => {
          const total = task.total ?? task.resultCount ?? 1;
          const done =
            task.progress ??
            (task.status === "running" ? 0 : (task.resultCount ?? total));
          const countLabel = `${Math.min(done, total)}/${total}`;
          const canCancel =
            task.status === "running" && task.interruptible && !task.cancelling;

          return (
            <div
              key={task.id}
              className="bg-background/95 flex min-w-0 items-start gap-2 rounded-md border px-3 py-2.5 text-xs shadow-lg backdrop-blur"
            >
              <span className="mt-0.5 shrink-0">{statusIcon(task.status)}</span>
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => setOpen(true)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {t(task.operationKey)}
                  </span>
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {countLabel}
                  </span>
                </span>
                <span className="text-muted-foreground mt-0.5 block truncate text-[11px]">
                  {task.refreshing
                    ? t("Mcp.task.refreshing")
                    : (task.error ??
                      task.detail ??
                      t(
                        task.status === "running"
                          ? "Mcp.task.running"
                          : task.status === "completed"
                            ? "Mcp.task.completed"
                            : task.status === "failed"
                              ? "Mcp.task.failed"
                              : "Mcp.task.cancelled"
                      ))}
                </span>
              </button>
              {canCancel ? (
                <button
                  type="button"
                  className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded-sm"
                  aria-label={t("Mcp.task.cancel")}
                  title={t("Mcp.task.cancel")}
                  onClick={() => void cancelTask(task)}
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          );
        })}

        {hiddenCount > 0 ? (
          <button
            type="button"
            className="text-muted-foreground bg-background/90 hover:bg-accent self-start rounded-md border px-2.5 py-1 text-[11px] shadow-sm"
            onClick={() => setOpen(true)}
          >
            {t("Mcp.task.more").replace("{count}", String(hiddenCount))}
          </button>
        ) : null}

        {approvalCount ? (
          <button
            type="button"
            className="bg-background/95 hover:bg-accent flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs shadow-lg backdrop-blur"
            onClick={() => setOpen(true)}
          >
            <ShieldAlert className="icon-sm text-amber-600" />
            <span>
              {t("Mcp.activity.approval").replace(
                "{count}",
                String(approvalCount)
              )}
            </span>
          </button>
        ) : null}

        {!tasks.length && !approvalCount && runtime.phase === "degraded" ? (
          <button
            type="button"
            className="bg-background/95 hover:bg-accent flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs shadow-lg backdrop-blur"
            onClick={() => setOpen(true)}
          >
            <RadioTower className="icon-sm text-amber-600" />
            <span>{t("Mcp.status.degraded")}</span>
          </button>
        ) : null}
      </div>
      <McpStatusDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
