import { useEffect, useState } from "react";
import {
  BookMarked,
  BookOpen,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/composables";
import { useWorkspace } from "@/contexts/workspace";
import { useAppNavigation } from "@/lib/navigation";

const OPEN_DELAY_MS = 1500;

type WorkspaceOpenIntent = "create" | "change" | "recent";

interface PendingWorkspaceOpen {
  path: string;
  intent: WorkspaceOpenIntent;
}

export default function Home() {
  const { t } = useI18n();
  const { go } = useAppNavigation();
  const { root, recent, isOpen, pickPath, open } = useWorkspace();
  const hasWorkspace = Boolean(isOpen && root);
  const [pendingOpen, setPendingOpen] =
    useState<PendingWorkspaceOpen | null>(null);
  const [progress, setProgress] = useState(0);

  function queueWorkspaceOpen(path: string, intent: WorkspaceOpenIntent) {
    if (pendingOpen) return;
    setProgress(0);
    setPendingOpen({ path, intent });
  }

  async function chooseWorkspace(intent: Exclude<WorkspaceOpenIntent, "recent">) {
    const selected = await pickPath();
    if (selected) queueWorkspaceOpen(selected, intent);
  }

  /*
   * 目录选定后先让首页完成一段可感知的进入过程，再一次性切换 root 和路由。
   * 两个状态同步落地，避免首页先渲染成“已打开工作区”再跳页造成按钮闪动。
   */
  useEffect(() => {
    if (!pendingOpen) return;
    const startedAt = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const value = Math.min(
        100,
        ((now - startedAt) / OPEN_DELAY_MS) * 100
      );
      setProgress(value);
      if (value < 100) {
        frame = requestAnimationFrame(tick);
        return;
      }
      open(pendingOpen.path);
      go("library");
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [go, open, pendingOpen]);

  return (
    <div className="view scrollbar-app bg-background h-full w-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-6 py-12 sm:px-8">
        <div className="row-label">
          <BookMarked className="icon-sm" />
          {t("Home.title")}
        </div>
        <h1 className="mt-3 text-2xl font-semibold">
          {hasWorkspace
            ? t("Home.workspacePicker")
            : t("Library.empty.noWorkspace")}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-lg text-sm leading-relaxed">
          {hasWorkspace
            ? t("Home.workspacePickerHint")
            : t("Library.workspace.hint")}
        </p>

        <div className="border-border/70 mt-8 border-y py-7">
          <div className="flex flex-wrap gap-2">
            {hasWorkspace ? (
              <Button size="lg" onClick={() => go("library")}>
                <BookOpen className="icon-md" />
                {t("Home.openLibrary")}
              </Button>
            ) : null}
            <Button
              size="lg"
              variant={hasWorkspace ? "outline" : "default"}
              disabled={Boolean(pendingOpen)}
              onClick={() => void chooseWorkspace("create")}
            >
              <FolderPlus className="icon-md" />
              {t("Library.workspace.pick")}
            </Button>
            <Button
              size="lg"
              variant="outline"
              disabled={Boolean(pendingOpen)}
              onClick={() => void chooseWorkspace("change")}
            >
              {pendingOpen?.intent === "change" ? (
                <LoaderCircle className="icon-md animate-spin" />
              ) : (
                <FolderOpen className="icon-md" />
              )}
              {hasWorkspace
                ? t("Library.workspace.change")
                : t("Library.workspace.open")}
            </Button>
          </div>

          {pendingOpen ? (
            <div
              role="status"
              aria-live="polite"
              className="bg-muted/30 mt-5 rounded-md border px-3 py-2.5"
            >
              <div className="flex items-center gap-3">
                <LoaderCircle className="text-muted-foreground size-4 shrink-0 animate-spin" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {t("Home.openingWorkspace")}
                  </p>
                  <p
                    className="text-muted-foreground mt-0.5 truncate text-xs"
                    title={pendingOpen.path}
                  >
                    {pendingOpen.path}
                  </p>
                </div>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {Math.round(progress)}%
                </span>
              </div>
              <Progress
                value={progress}
                className="mt-2.5 h-1.5"
                aria-label={t("Home.openingWorkspace")}
              />
            </div>
          ) : null}

          {recent.length ? (
            <section className="mt-7">
              <h2 className="row-label">{t("Library.workspace.recent")}</h2>
              <div className="mt-3 flex flex-col gap-1">
                {recent.map((path) => (
                  <button
                    key={path}
                    type="button"
                    disabled={Boolean(pendingOpen)}
                    onClick={() => queueWorkspaceOpen(path, "recent")}
                    className="group hover:bg-accent/55 flex w-full items-center gap-3 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors disabled:pointer-events-none disabled:opacity-55 aria-busy:border-primary/25 aria-busy:bg-accent/45"
                    aria-busy={pendingOpen?.path === path}
                  >
                    <FolderOpen className="icon-sm text-muted-foreground/60 shrink-0" />
                    <span className="text-muted-foreground group-hover:text-foreground min-w-0 flex-1 truncate text-sm">
                      {path}
                    </span>
                    {pendingOpen?.path === path ? (
                      <LoaderCircle className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
                    ) : (
                      <ChevronRight className="text-muted-foreground/40 size-3.5 shrink-0" />
                    )}
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
