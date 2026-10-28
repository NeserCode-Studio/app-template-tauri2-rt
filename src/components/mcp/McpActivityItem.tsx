import {
  Ban,
  BookMarked,
  BookOpen,
  CheckCircle2,
  CircleX,
  Clock3,
  LoaderCircle,
  Target,
  UserRound,
} from "lucide-react";

import { useI18n } from "@/composables";
import type { McpActivity, McpActivityStatus } from "@/mcp/activity";
import { mcpToolLabel } from "@/mcp/tool-labels";

function statusIcon(status: McpActivityStatus, className = "icon-sm") {
  switch (status) {
    case "completed":
      return <CheckCircle2 className={`${className} text-emerald-600`} />;
    case "failed":
      return <CircleX className={`${className} text-destructive`} />;
    case "cancelled":
      return <Ban className={`${className} text-muted-foreground`} />;
    default:
      return <LoaderCircle className={`${className} animate-spin`} />;
  }
}

function statusKey(status: McpActivityStatus): string {
  switch (status) {
    case "completed":
      return "Mcp.task.completed";
    case "failed":
      return "Mcp.task.failed";
    case "cancelled":
      return "Mcp.task.cancelled";
    default:
      return "Mcp.task.running";
  }
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

function formatDuration(
  activity: McpActivity,
  t: (key: string) => string
): string {
  const end = activity.finishedAt ?? activity.updatedAt;
  const seconds = Math.max(0, (end - activity.startedAt) / 1_000);
  const rounded =
    seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString();
  return t("Mcp.page.durationSeconds").replace("{seconds}", rounded);
}

function relativeTime(timestamp: number, language: string): string {
  const seconds = Math.round((timestamp - Date.now()) / 1_000);
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  return formatter.format(Math.round(minutes / 60), "hour");
}

export function McpActivitySummary({ activity }: { activity: McpActivity }) {
  const { lang, t } = useI18n();
  const time = relativeTime(activity.finishedAt ?? activity.updatedAt, lang);

  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md px-2 py-2">
      <span className="mt-0.5 shrink-0">{statusIcon(activity.status)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="min-w-0 flex-1 truncate text-xs font-medium">
            {mcpToolLabel(activity.toolName, lang)}
          </p>
          <time className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {time}
          </time>
        </div>
        <p className="text-muted-foreground mt-0.5 truncate text-xs">
          {activity.targetLabel
            ? `${activity.targetLabel} · ${t(statusKey(activity.status))}`
            : `${t(statusKey(activity.status))} · ${activity.clientName}`}
        </p>
      </div>
    </div>
  );
}

export function McpActivityItem({
  activity,
  workTitle,
  chapterTitle,
}: {
  activity: McpActivity;
  workTitle?: string | null;
  chapterTitle?: string | null;
}) {
  const { lang, t } = useI18n();
  const label = mcpToolLabel(activity.toolName, lang);
  const workTarget =
    workTitle ?? (activity.workId ? shortId(activity.workId) : null);
  const chapterTarget =
    chapterTitle ?? (activity.chapterId ? shortId(activity.chapterId) : null);
  const targetLabel = activity.targetLabel?.trim() || null;
  const finishedAt = activity.finishedAt ?? activity.updatedAt;
  const timing =
    activity.status === "running"
      ? t("Mcp.page.runningFor").replace(
          "{duration}",
          formatDuration(activity, t)
        )
      : `${relativeTime(finishedAt, lang)} · ${formatDuration(activity, t)}`;
  const detail = activity.error ?? activity.detail;

  return (
    <li className="hover:bg-muted/35 px-3 py-3 transition-colors">
      <div className="flex min-w-0 items-start gap-3">
        <span className="bg-muted/70 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md">
          {statusIcon(activity.status)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{label}</p>
              <div className="text-muted-foreground mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                {targetLabel ? (
                  <span className="flex min-w-0 items-center gap-1">
                    <Target className="size-3 shrink-0" />
                    <span className="max-w-64 truncate">{targetLabel}</span>
                  </span>
                ) : null}
                {workTarget ? (
                  <span className="flex min-w-0 items-center gap-1">
                    <BookOpen className="size-3 shrink-0" />
                    <span className="max-w-48 truncate">{workTarget}</span>
                  </span>
                ) : null}
                {chapterTarget ? (
                  <span className="flex min-w-0 items-center gap-1">
                    <BookMarked className="size-3 shrink-0" />
                    <span className="max-w-48 truncate">{chapterTarget}</span>
                  </span>
                ) : null}
              </div>
            </div>
            <span
              className={[
                "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
                activity.status === "completed"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : activity.status === "failed"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground",
              ].join(" ")}
            >
              {statusIcon(activity.status, "size-3")}
              {activity.queued
                ? t("Mcp.task.queued")
                : t(statusKey(activity.status))}
            </span>
          </div>
          <div className="text-muted-foreground mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <code className="max-w-full truncate font-mono">
              {activity.toolName}
            </code>
            <span className="flex min-w-0 items-center gap-1">
              <UserRound className="size-3 shrink-0" />
              <span className="max-w-40 truncate">{activity.clientName}</span>
            </span>
            <span className="flex items-center gap-1 whitespace-nowrap">
              <Clock3 className="size-3 shrink-0" />
              {timing}
            </span>
            {activity.resultCount && activity.resultCount > 1 ? (
              <span>
                {t("Mcp.page.resultCount").replace(
                  "{count}",
                  String(activity.resultCount)
                )}
              </span>
            ) : null}
          </div>
          {detail ? (
            <p
              className={[
                "mt-2 line-clamp-2 text-xs leading-relaxed",
                activity.error ? "text-destructive" : "text-muted-foreground",
              ].join(" ")}
            >
              {detail}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}
