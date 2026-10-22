/*
 * Refactoring UI constraint brief:
 * Primary: recent MCP operations and their exact targets.
 * Secondary: service and workspace metadata in the compact header.
 * Tertiary: client names and permission details.
 * One primary action: manage connection.
 * Tokens: background/muted/border/destructive plus the existing spacing and
 * type scales. The operation list is unframed; only hover states add a tint.
 */

import { useMemo, useState } from "react";
import { History, Search, Server, Settings2 } from "lucide-react";

import { McpActivityItem } from "@/components/mcp/McpActivityItem";
import McpStatusDialog from "@/components/framework/McpStatusDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/composables";
import { useLibrary } from "@/contexts/library";
import { useOutline } from "@/contexts/outline";
import { useWorkspace } from "@/contexts/workspace";
import type { McpActivity, McpActivityStatus } from "@/mcp/activity";
import { useMcpActivity } from "@/mcp/use-activity";
import { useMcpRuntime } from "@/mcp/runtime";
import { mcpToolLabel } from "@/mcp/tool-labels";

type RecentFilter = "all" | Exclude<McpActivityStatus, "running">;

const RECENT_FILTERS: RecentFilter[] = [
  "all",
  "completed",
  "failed",
  "cancelled",
];

function filterLabelKey(filter: RecentFilter): string {
  return `Mcp.page.filter.${filter}`;
}

function targetTitles(
  activity: McpActivity,
  works: Record<string, { title: string }>,
  currentWorkId: string | null,
  chapters: Array<{ id: string; title: string }>
): { workTitle: string | null; chapterTitle: string | null } {
  const workTitle = activity.workId
    ? (works[activity.workId]?.title ?? null)
    : null;
  const chapterTitle =
    activity.chapterId && activity.workId === currentWorkId
      ? (chapters.find((chapter) => chapter.id === activity.chapterId)?.title ??
        null)
      : null;
  return { workTitle, chapterTitle };
}

export default function Mcp() {
  const { lang, t } = useI18n();
  const { root } = useWorkspace();
  const { workspace, works, currentWorkId } = useLibrary();
  const { chapters } = useOutline();
  const runtime = useMcpRuntime();
  const activity = useMcpActivity();
  const [manageOpen, setManageOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RecentFilter>("all");

  const stateLabel =
    runtime.phase === "ready"
      ? t("Mcp.status.ready")
      : runtime.phase === "starting"
        ? t("Mcp.status.starting")
        : runtime.phase === "degraded"
          ? t("Mcp.status.degraded")
          : t("Mcp.status.stopped");

  const recent = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return activity.recent.filter((item) => {
      if (filter !== "all" && item.status !== filter) return false;
      if (!needle) return true;
      const { workTitle, chapterTitle } = targetTitles(
        item,
        works,
        currentWorkId,
        chapters
      );
      return [
        mcpToolLabel(item.toolName, lang),
        item.toolName,
        item.clientName,
        item.targetLabel,
        workTitle,
        chapterTitle,
        item.detail,
        item.error,
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase()
        .includes(needle);
    });
  }, [activity.recent, chapters, currentWorkId, filter, lang, query, works]);

  const rootParts = root?.split(/[\\/]/).filter(Boolean) ?? [];
  const workspaceName =
    workspace?.alias?.trim() || rootParts[rootParts.length - 1] || root || "-";
  const workCount = Object.keys(works).length;
  const clientNames = runtime.status.clients
    .map((client) => client.title || client.name)
    .join(" · ");

  if (!root) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div>
          <Server className="text-muted-foreground mx-auto size-5" />
          <p className="mt-3 text-sm font-medium">
            {t("Mcp.page.workspaceRequired")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background flex h-full min-h-0 w-full flex-col overflow-hidden">
      <header className="shrink-0 border-b px-4 py-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <div className="flex items-center gap-4">
            <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">
              {t("Mcp.page.title")}
            </h1>
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              onClick={() => setManageOpen(true)}
            >
              <Settings2 className="size-3.5" />
              {t("Mcp.page.manage")}
            </Button>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2 text-xs">
            <span className="flex items-center gap-2">
              <span
                className={[
                  "size-1.5 rounded-full",
                  runtime.phase === "ready"
                    ? "bg-emerald-500"
                    : runtime.phase === "degraded"
                      ? "bg-amber-500"
                      : "bg-muted-foreground",
                ].join(" ")}
              />
              {stateLabel}
            </span>
            <code
              className="text-muted-foreground max-w-full truncate"
              title={runtime.status.endpoint ?? undefined}
            >
              {runtime.status.endpoint ?? "-"}
            </code>
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="text-muted-foreground">
                {t("Mcp.page.workspace")}
              </span>
              <span className="min-w-0 truncate font-medium">
                {workspaceName}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {t("Codex.scope.worksCount").replace(
                  "{count}",
                  String(workCount)
                )}
              </span>
            </span>
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="text-muted-foreground">
                {t("Mcp.page.connectedClients")}
              </span>
              <span className="min-w-0 truncate font-medium">
                {clientNames || t("Mcp.connections.noClients")}
              </span>
            </span>
          </div>

          <dl className="grid grid-cols-3 gap-x-6 gap-y-3">
            <div className="min-w-0">
              <dt className="text-muted-foreground text-xs">
                {t("Mcp.page.active")}
              </dt>
              <dd className="mt-1 text-sm font-semibold tabular-nums">
                {activity.active.length}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground text-xs">
                {t("Mcp.page.permission")}
              </dt>
              <dd className="mt-1 truncate text-sm font-semibold">
                {t(`Mcp.permission.${runtime.accessLevel}`)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground text-xs">
                {t("Mcp.page.recent")}
              </dt>
              <dd className="mt-1 text-sm font-semibold tabular-nums">
                {activity.recent.length}
              </dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="scrollbar-app min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
          <section
            aria-labelledby="mcp-active-heading"
            className="mb-8 min-w-0"
          >
            <div>
              <h2 id="mcp-active-heading" className="text-base font-semibold">
                {t("Mcp.page.currentTasks")}
              </h2>
              <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                {t("Mcp.page.resultCount").replace(
                  "{count}",
                  String(activity.active.length)
                )}
              </p>
            </div>

            {activity.active.length ? (
              <ul className="border-border/60 divide-border/60 mt-3 divide-y overflow-hidden rounded-md border">
                {activity.active.map((item) => {
                  const { workTitle, chapterTitle } = targetTitles(
                    item,
                    works,
                    currentWorkId,
                    chapters
                  );
                  return (
                    <McpActivityItem
                      key={item.id}
                      activity={item}
                      workTitle={workTitle}
                      chapterTitle={chapterTitle}
                    />
                  );
                })}
              </ul>
            ) : (
              <p className="text-muted-foreground mt-3 text-xs">
                {t("Mcp.page.noActive")}
              </p>
            )}
          </section>

          <section aria-labelledby="mcp-recent-heading" className="min-w-0">
            <div>
              <h2 id="mcp-recent-heading" className="text-base font-semibold">
                {t("Mcp.page.recent")}
              </h2>
              <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                {t("Mcp.page.resultCount").replace(
                  "{count}",
                  String(activity.recent.length)
                )}
              </p>
            </div>

            {activity.recent.length ? (
              <>
                <div className="mt-4 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative w-full sm:max-w-72">
                    <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={t("Mcp.page.search")}
                      aria-label={t("Mcp.page.search")}
                      className="h-9 pl-8 text-sm"
                    />
                  </div>
                  <div
                    role="group"
                    aria-label={t("Mcp.page.recent")}
                    className="bg-muted flex h-9 w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-md p-0.5"
                  >
                    {RECENT_FILTERS.map((item) => (
                      <button
                        key={item}
                        type="button"
                        aria-pressed={filter === item}
                        className={[
                          "h-8 shrink-0 rounded px-2.5 text-xs whitespace-nowrap transition-colors",
                          filter === item
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        ].join(" ")}
                        onClick={() => setFilter(item)}
                      >
                        {t(filterLabelKey(item))}
                      </button>
                    ))}
                  </div>
                </div>

                {recent.length ? (
                  <ul className="border-border/60 divide-border/60 mt-3 divide-y overflow-hidden rounded-md border">
                    {recent.map((item) => {
                      const { workTitle, chapterTitle } = targetTitles(
                        item,
                        works,
                        currentWorkId,
                        chapters
                      );
                      return (
                        <McpActivityItem
                          key={item.id}
                          activity={item}
                          workTitle={workTitle}
                          chapterTitle={chapterTitle}
                        />
                      );
                    })}
                  </ul>
                ) : (
                  <div className="mt-3 px-4 py-10 text-center">
                    <p className="text-sm font-medium">
                      {t("Mcp.page.emptyFiltered")}
                    </p>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground mt-2 text-xs underline-offset-4 hover:underline"
                      onClick={() => {
                        setQuery("");
                        setFilter("all");
                      }}
                    >
                      {t("Mcp.page.clearFilters")}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="mt-3 px-6 py-12 text-center">
                <span className="bg-muted text-muted-foreground mx-auto flex size-10 items-center justify-center rounded-full">
                  <History className="size-4" />
                </span>
                <p className="mt-3 text-sm font-semibold">
                  {t("Mcp.page.empty.title")}
                </p>
                <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-xs leading-relaxed">
                  {t("Mcp.page.empty.hint")}
                </p>
              </div>
            )}
          </section>
        </div>
      </div>

      <McpStatusDialog open={manageOpen} onOpenChange={setManageOpen} />
    </div>
  );
}
