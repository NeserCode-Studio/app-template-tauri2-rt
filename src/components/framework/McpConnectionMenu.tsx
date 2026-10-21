import { useState } from "react";
import {
  Ban,
  CheckCircle2,
  CircleX,
  History,
  LoaderCircle,
  RadioTower,
  Server,
} from "lucide-react";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  MenubarContent,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from "@/components/ui/menubar";
import { useI18n } from "@/composables";
import { useWorkspace } from "@/contexts/workspace";
import type { McpActivity, McpActivityStatus } from "@/mcp/activity";
import { useMcpActivity } from "@/mcp/use-activity";
import { useMcpRuntime } from "@/mcp/runtime";
import McpStatusDialog from "./McpStatusDialog";

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

function taskProgress(activity: McpActivity): string | null {
  const total = activity.total ?? activity.resultCount;
  if (!total) return null;
  const done = activity.progress ?? (activity.status === "running" ? 0 : total);
  return `${Math.min(done, total)}/${total}`;
}

function TaskLine({ activity }: { activity: McpActivity }) {
  const { t } = useI18n();
  const progress = taskProgress(activity);

  return (
    <div className="flex min-w-0 items-start gap-2 px-2 py-1.5">
      <span className="mt-0.5 shrink-0">{statusIcon(activity.status)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-xs font-medium">
            {t(activity.operationKey)}
          </span>
          {progress ? (
            <span className="text-muted-foreground ml-auto shrink-0 text-[11px] tabular-nums">
              {progress}
            </span>
          ) : null}
        </div>
        <div className="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px]">
          <span className="min-w-0 truncate">{activity.clientName}</span>
          <span className="shrink-0">
            ·{" "}
            {t(
              activity.interruptible
                ? "Mcp.task.interruptible"
                : "Mcp.task.uninterruptible"
            )}
          </span>
        </div>
        {activity.detail || activity.error || activity.refreshing ? (
          <p className="text-muted-foreground mt-1 line-clamp-2 text-[11px] leading-relaxed">
            {activity.refreshing
              ? t("Mcp.task.refreshing")
              : (activity.error ?? activity.detail)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function McpConnectionMenu() {
  const { t } = useI18n();
  const { root } = useWorkspace();
  const runtime = useMcpRuntime();
  const activity = useMcpActivity();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const connectedClients = runtime.status.connectedClients;
  const activeTasks = activity.active;
  const recentTasks = activity.recent;

  if (!root) return null;

  const summary = t("Mcp.connections.count").replace(
    "{count}",
    String(connectedClients)
  );

  return (
    <>
      <MenubarMenu>
        <MenubarTrigger className="h-full max-w-44 gap-1.5 px-2 text-xs">
          {activeTasks.length ? (
            <LoaderCircle className="icon-sm animate-spin" />
          ) : runtime.phase === "degraded" ? (
            <RadioTower className="icon-sm text-amber-600" />
          ) : (
            <RadioTower className="icon-sm text-emerald-600" />
          )}
          <span className="truncate">{summary}</span>
        </MenubarTrigger>
        <MenubarContent
          align="start"
          className="w-[18rem] max-w-[calc(100vw-2rem)]"
        >
          <div className="max-h-[min(70vh,28rem)] overflow-x-hidden overflow-y-auto">
            <MenubarLabel className="flex items-center gap-2">
              <Server className="icon-sm" />
              {t("Mcp.connections.title")}
            </MenubarLabel>
            <div className="text-muted-foreground grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-2 pb-2 text-[11px]">
              <span>{t("Mcp.statusLabel")}</span>
              <span className="min-w-0 text-right break-all">
                {runtime.phase === "ready"
                  ? t("Mcp.status.ready")
                  : runtime.phase === "starting"
                    ? t("Mcp.status.starting")
                    : runtime.phase === "degraded"
                      ? t("Mcp.status.degraded")
                      : t("Mcp.status.stopped")}
              </span>
              <span>{t("Mcp.endpoint")}</span>
              <span className="truncate text-right">
                {runtime.status.endpoint ?? "-"}
              </span>
            </div>

            <MenubarSeparator />
            <MenubarLabel className="text-xs">
              {t("Mcp.connections.clients").replace(
                "{count}",
                String(connectedClients)
              )}
            </MenubarLabel>
            {runtime.status.clients.length ? (
              runtime.status.clients.map((client) => (
                <div
                  key={`${client.name}:${client.version ?? ""}`}
                  className="flex min-w-0 items-center gap-2 px-2 py-1 text-xs"
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                  <span className="min-w-0 flex-1 truncate">
                    {client.title || client.name}
                  </span>
                  {client.version ? (
                    <span className="text-muted-foreground shrink-0 text-[11px]">
                      v{client.version}
                    </span>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-muted-foreground px-2 py-1 text-[11px]">
                {t("Mcp.connections.noClients")}
              </p>
            )}

            <MenubarSeparator />
            <MenubarLabel>{t("Mcp.task.active")}</MenubarLabel>
            {activeTasks.length ? (
              activeTasks
                .slice(0, 5)
                .map((item) => <TaskLine key={item.id} activity={item} />)
            ) : (
              <p className="text-muted-foreground px-2 py-1 text-[11px]">
                {t("Mcp.task.noActive")}
              </p>
            )}

            {recentTasks.length ? (
              <>
                <MenubarSeparator />
                <HoverCard openDelay={160} closeDelay={120}>
                  <HoverCardTrigger asChild>
                    <button
                      type="button"
                      className="hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-hidden"
                    >
                      <History className="icon-sm" />
                      <span className="min-w-0 flex-1 truncate">
                        {t("Mcp.task.recent")}
                      </span>
                      <span className="text-muted-foreground shrink-0 tabular-nums">
                        {recentTasks.length}
                      </span>
                    </button>
                  </HoverCardTrigger>
                  <HoverCardContent
                    side="right"
                    align="start"
                    sideOffset={8}
                    className="max-h-[min(70vh,28rem)] w-[min(22rem,calc(100vw-2rem))] overflow-x-hidden overflow-y-auto p-2"
                  >
                    <div className="flex items-center justify-between gap-3 px-2 pb-2">
                      <span className="text-xs font-medium">
                        {t("Mcp.task.recent")}
                      </span>
                      <span className="text-muted-foreground text-[11px] tabular-nums">
                        {recentTasks.length}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {recentTasks.map((item) => (
                        <TaskLine key={item.id} activity={item} />
                      ))}
                    </div>
                  </HoverCardContent>
                </HoverCard>
              </>
            ) : null}

            <MenubarSeparator />
            <MenubarItem onSelect={() => setDetailsOpen(true)}>
              <Server className="icon-sm" />
              {t("Mcp.manage")}
            </MenubarItem>
          </div>
        </MenubarContent>
      </MenubarMenu>
      <McpStatusDialog open={detailsOpen} onOpenChange={setDetailsOpen} />
    </>
  );
}
