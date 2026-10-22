import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowUpRight,
  Ban,
  CheckCircle2,
  CircleX,
  LoaderCircle,
  RadioTower,
  ShieldAlert,
  X,
} from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/composables";
import { createLogger } from "@/lib/logger";
import { APP_PAGE_PATHS, useAppNavigation } from "@/lib/navigation";
import {
  displayedActivityBatch,
  type McpActivityBatch,
} from "@/mcp/activity-batch";
import { updateActivity } from "@/mcp/activity";
import { subscribeApprovals } from "@/mcp/approval";
import { useMcpRuntime } from "@/mcp/runtime";
import { mcpToolLabel } from "@/mcp/tool-labels";
import { useMcpActivity } from "@/mcp/use-activity";

const log = createLogger("McpActivity");

function statusIcon(batch: McpActivityBatch) {
  switch (batch.status) {
    case "completed":
      return <CheckCircle2 className="size-4 text-emerald-600" />;
    case "failed":
      return <CircleX className="text-destructive size-4" />;
    case "cancelled":
      return <Ban className="text-muted-foreground size-4" />;
    default:
      return <LoaderCircle className="size-4 animate-spin" />;
  }
}

export default function McpActivityIndicator() {
  const { lang, t } = useI18n();
  const runtime = useMcpRuntime();
  const activity = useMcpActivity();
  const { navigateDirect } = useAppNavigation();
  const [approvalCount, setApprovalCount] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(
    () => subscribeApprovals((requests) => setApprovalCount(requests.length)),
    []
  );

  const batch = useMemo(
    () => displayedActivityBatch(activity, now),
    [activity, now]
  );

  useEffect(() => {
    if (!batch?.expiresAt || batch.activeCount) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(50, batch.expiresAt - Date.now() + 20)
    );
    return () => window.clearTimeout(timer);
  }, [batch?.activeCount, batch?.expiresAt, batch?.id]);

  const cancelTask = async () => {
    const task = batch?.currentTask;
    if (!task || task.status !== "running") return;
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

  const title =
    batch?.status === "running"
      ? t("Mcp.batch.title")
      : batch?.status === "failed"
        ? t("Mcp.batch.titleFailed")
        : batch?.status === "cancelled"
          ? t("Mcp.batch.titleCancelled")
          : t("Mcp.batch.titleCompleted");
  const currentTask = batch?.currentTask;
  const currentProgress =
    currentTask?.total !== undefined
      ? t("Mcp.batch.currentProgress")
          .replace("{done}", String(currentTask.progress ?? 0))
          .replace("{total}", String(currentTask.total))
      : null;
  const currentLabel = currentTask
    ? [
        mcpToolLabel(currentTask.toolName, lang),
        currentTask.targetLabel,
        currentTask.queued
          ? t("Mcp.task.queued")
          : currentTask.refreshing
            ? t("Mcp.task.refreshing")
            : currentTask.error,
        currentProgress,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  const clientLabel = batch
    ? batch.clientNames.length === 1
      ? batch.clientNames[0]
      : t("Mcp.batch.clients").replace(
          "{count}",
          String(batch.clientNames.length)
        )
    : null;
  const summary = batch
    ? [
        t("Mcp.batch.total").replace("{count}", String(batch.total)),
        batch.runningCount
          ? t("Mcp.batch.running").replace(
              "{count}",
              String(batch.runningCount)
            )
          : null,
        batch.queuedCount
          ? t("Mcp.batch.queued").replace("{count}", String(batch.queuedCount))
          : null,
        batch.failedCount
          ? t("Mcp.batch.failed").replace("{count}", String(batch.failedCount))
          : null,
        batch.cancelledCount
          ? t("Mcp.batch.cancelled").replace(
              "{count}",
              String(batch.cancelledCount)
            )
          : null,
        clientLabel,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  const canCancel =
    currentTask?.status === "running" &&
    currentTask.interruptible &&
    !currentTask.cancelling;

  if (!batch && !approvalCount && runtime.phase !== "degraded") {
    return null;
  }

  return (
    <div
      className="fixed bottom-4 left-4 z-[105] flex w-[23rem] max-w-[calc(100vw-2rem)] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {batch ? (
        <div
          key={batch.id}
          data-mcp-batch-toast
          className="bg-background/95 animate-in fade-in slide-in-from-bottom-2 rounded-md border shadow-lg backdrop-blur duration-200"
        >
          <div className="flex min-w-0 items-start gap-2 px-3 py-2.5">
            <span className="mt-0.5 shrink-0">{statusIcon(batch)}</span>
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              title={t("Mcp.batch.view")}
              onClick={() => navigateDirect(APP_PAGE_PATHS.mcp)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {title}
                </span>
                <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
                  {t("Mcp.batch.progress")
                    .replace("{done}", String(batch.finishedCount))
                    .replace("{total}", String(batch.total))}
                </span>
                <ArrowUpRight className="text-muted-foreground size-3.5 shrink-0" />
              </span>
              <span className="text-muted-foreground mt-1 block truncate text-[11px]">
                {currentLabel}
              </span>
              <Progress
                value={batch.percent}
                className="mt-2 h-1 [&_[data-slot=progress-indicator]]:duration-200"
              />
              <span className="text-muted-foreground mt-1.5 block truncate text-[11px]">
                {summary}
              </span>
            </button>
            {canCancel ? (
              <button
                type="button"
                className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded-sm"
                aria-label={t("Mcp.task.cancel")}
                title={t("Mcp.task.cancel")}
                onClick={() => void cancelTask()}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {approvalCount ? (
        <button
          type="button"
          className="bg-background/95 hover:bg-accent flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs shadow-lg backdrop-blur"
          onClick={() => navigateDirect(APP_PAGE_PATHS.mcp)}
        >
          <ShieldAlert className="size-4 text-amber-600" />
          <span>
            {t("Mcp.activity.approval").replace(
              "{count}",
              String(approvalCount)
            )}
          </span>
        </button>
      ) : null}

      {!batch && !approvalCount && runtime.phase === "degraded" ? (
        <button
          type="button"
          className="bg-background/95 hover:bg-accent flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs shadow-lg backdrop-blur"
          onClick={() => navigateDirect(APP_PAGE_PATHS.mcp)}
        >
          <RadioTower className="size-4 text-amber-600" />
          <span>{t("Mcp.status.degraded")}</span>
        </button>
      ) : null}
    </div>
  );
}
