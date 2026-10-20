import { useMemo } from "react";
import {
  Archive,
  BookMarked,
  BookOpen,
  ChevronRight,
  Clock,
  Database,
  FolderOpen,
  Layers3,
  PenLine,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/composables";
import { useLibrary } from "@/contexts/library";
import { useWorkspace } from "@/contexts/workspace";
import { useAppNavigation } from "@/lib/navigation";
import type { Work } from "@/shared/schema";

function formatDate(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

export default function Home() {
  const { t } = useI18n();
  const { go } = useAppNavigation();
  const { root, recent, isOpen, pick, open } = useWorkspace();
  const { workspace, works, currentWorkId, setCurrentWorkId } = useLibrary();

  const activeWorks = useMemo<Work[]>(() => {
    if (!workspace) return [];
    return workspace.order
      .map((id) => works[id])
      .filter((work): work is Work => Boolean(work));
  }, [workspace, works]);

  const recentWorks = useMemo(
    () =>
      [...activeWorks].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4),
    [activeWorks]
  );

  const focusWork =
    activeWorks.find((work) => work.id === currentWorkId) ??
    recentWorks[0] ??
    null;

  const archivedCount = workspace?.archived.length ?? 0;
  const workspaceName = workspace?.alias?.trim() || t("Home.currentWorkspace");

  function openWork(workId: string) {
    setCurrentWorkId(workId);
    go("editor");
  }

  if (!isOpen || !root) {
    return (
      <div className="view scrollbar-app bg-background h-full w-full overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-6 py-12 sm:px-8">
          <div className="row-label">
            <BookMarked className="icon-sm" />
            {t("Home.title")}
          </div>
          <h1 className="mt-3 text-2xl font-semibold">
            {t("Library.empty.noWorkspace")}
          </h1>
          <p className="text-muted-foreground mt-2 max-w-lg text-sm leading-relaxed">
            {t("Library.workspace.hint")}
          </p>

          <div className="border-border/70 mt-8 border-y py-7">
            <Button size="lg" onClick={() => void pick()}>
              <FolderOpen className="icon-md" />
              {t("Library.workspace.pick")}
            </Button>
            {recent.length ? (
              <section className="mt-7">
                <h2 className="row-label">{t("Library.workspace.recent")}</h2>
                <div className="mt-3 flex flex-col gap-1">
                  {recent.map((path) => (
                    <button
                      key={path}
                      type="button"
                      onClick={() => open(path)}
                      className="group hover:bg-accent/55 flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors"
                    >
                      <FolderOpen className="icon-sm text-muted-foreground/60 shrink-0" />
                      <span className="text-muted-foreground group-hover:text-foreground min-w-0 flex-1 truncate text-sm">
                        {path}
                      </span>
                      <ChevronRight className="text-muted-foreground/40 size-3.5 shrink-0" />
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view scrollbar-app bg-background h-full w-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-10 px-6 py-10 sm:px-8">
        <header className="border-border/70 flex flex-col gap-5 border-b pb-6 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="row-label">
              <BookMarked className="icon-sm" />
              {t("Home.title")}
            </div>
            <h1 className="mt-2 truncate text-2xl font-semibold">
              {workspaceName}
            </h1>
            <p
              className="text-muted-foreground/75 mt-1 max-w-xl truncate text-xs"
              title={root}
            >
              {root}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => go("library")}>
              <BookOpen className="icon-md" />
              {t("Library.title")}
            </Button>
            <Button onClick={() => go("library", { intent: "create-work" })}>
              <Plus className="icon-md" />
              {t("Library.action.new")}
            </Button>
          </div>
        </header>

        <section className="border-border/80 bg-card relative overflow-hidden rounded-md border">
          <div className="bg-primary/55 absolute inset-y-0 left-0 w-1" />
          <div className="grid gap-8 px-6 py-6 md:grid-cols-[minmax(0,1fr)_15rem] md:px-8">
            <div className="min-w-0">
              <div className="row-label">
                <PenLine className="icon-sm" />
                {t("Home.continue")}
              </div>
              {focusWork ? (
                <>
                  <h2 className="mt-3 truncate text-xl font-semibold">
                    {focusWork.title}
                  </h2>
                  <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    {focusWork.type ? <span>{focusWork.type}</span> : null}
                    {focusWork.type ? <span aria-hidden>·</span> : null}
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3" />
                      {t("Home.updated")} {formatDate(focusWork.updatedAt)}
                    </span>
                  </div>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <Button onClick={() => openWork(focusWork.id)}>
                      <BookOpen className="icon-md" />
                      {t("Library.action.continue")}
                    </Button>
                    <Button variant="outline" onClick={() => go("codex")}>
                      <Database className="icon-md" />
                      {t("Codex.library.title")}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="mt-3 text-xl font-semibold">
                    {t("Library.empty.noWorks")}
                  </h2>
                  <p className="text-muted-foreground mt-2 text-sm">
                    {t("Library.empty.noWorksHint")}
                  </p>
                  <Button
                    className="mt-6"
                    onClick={() => go("library", { intent: "create-work" })}
                  >
                    <Plus className="icon-md" />
                    {t("Library.action.new")}
                  </Button>
                </>
              )}
            </div>

            <div className="border-border/70 grid grid-cols-2 gap-5 border-t pt-5 md:border-t-0 md:border-l md:pt-0 md:pl-8">
              <div>
                <Layers3 className="icon-sm text-muted-foreground/60" />
                <p className="mt-5 text-2xl font-semibold tabular-nums">
                  {activeWorks.length}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {t("Home.activeWorks")}
                </p>
              </div>
              <div>
                <Archive className="icon-sm text-muted-foreground/60" />
                <p className="mt-5 text-2xl font-semibold tabular-nums">
                  {archivedCount}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {t("Home.archivedWorks")}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold">{t("Home.recent")}</h2>
              <p className="text-muted-foreground mt-1 text-xs">
                {t("Home.recentHint")}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => go("library")}
            >
              {t("Home.openLibrary")}
              <ChevronRight className="icon-sm" />
            </Button>
          </div>

          {recentWorks.length ? (
            <div className="divide-border/70 border-border/70 mt-3 flex flex-col divide-y border-y">
              {recentWorks.map((work) => (
                <button
                  key={work.id}
                  type="button"
                  onClick={() => openWork(work.id)}
                  className="group hover:bg-accent/45 flex w-full items-center gap-4 px-2.5 py-3 text-left transition-colors"
                >
                  <span className="border-border/70 bg-muted/35 flex size-8 shrink-0 items-center justify-center rounded-md border">
                    <BookOpen className="icon-sm text-muted-foreground/70" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {work.title}
                    </span>
                    <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                      {[work.type, formatDate(work.updatedAt)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <ChevronRight className="icon-sm text-muted-foreground/35 shrink-0 transition-transform group-hover:translate-x-0.5" />
                </button>
              ))}
            </div>
          ) : (
            <div className="border-border/70 text-muted-foreground mt-3 border-y py-8 text-center text-sm">
              {t("Library.empty.noWorksHint")}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
