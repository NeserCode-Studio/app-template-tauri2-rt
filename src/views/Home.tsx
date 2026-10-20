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
import { useI18n } from "@/composables";
import { useWorkspace } from "@/contexts/workspace";
import { useAppNavigation } from "@/lib/navigation";

const OPEN_DELAY_MS = 2500;

type WorkspaceOpenIntent = "create" | "change" | "recent";

interface PendingWorkspaceOpen {
  path: string;
  intent: WorkspaceOpenIntent;
}

function workspaceName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || path;
}

function openedAtLabel(
  timestamp: number | undefined,
  lang: string,
  fallback: string
): string {
  if (!timestamp) return fallback;
  const formatter = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const elapsed = timestamp - Date.now();
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  if (Math.abs(elapsed) < hour) {
    return formatter.format(Math.round(elapsed / minute), "minute");
  }
  if (Math.abs(elapsed) < day) {
    return formatter.format(Math.round(elapsed / hour), "hour");
  }
  if (Math.abs(elapsed) < day * 30) {
    return formatter.format(Math.round(elapsed / day), "day");
  }
  return new Intl.DateTimeFormat(lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

function WorkspaceRow({
  path,
  current,
  busy,
  progress,
  openedAt,
  disabled,
  onClick,
}: {
  path: string;
  current: boolean;
  busy: boolean;
  progress: number;
  openedAt?: number;
  disabled: boolean;
  onClick: () => void;
}) {
  const { lang, t } = useI18n();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="group hover:bg-accent/55 relative flex w-full items-start gap-3 overflow-hidden rounded-md border border-transparent px-2.5 py-2.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-55 aria-busy:border-primary/25"
      aria-busy={busy}
    >
      {busy ? (
        <span
          aria-hidden="true"
          className="bg-primary/10 absolute inset-y-0 left-0 w-full origin-left"
          style={{ transform: `scaleX(${progress / 100})` }}
        />
      ) : null}
      <FolderOpen className="text-muted-foreground/60 relative z-10 mt-0.5 size-4 shrink-0" />
      <span className="relative z-10 min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="group-hover:text-foreground truncate text-sm font-medium">
            {workspaceName(path)}
          </span>
          {current ? (
            <span className="bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 shrink-0 rounded border border-emerald-600/20 px-1.5 py-0.5 text-[10px] font-medium">
              {t("Home.currentWorkspace")}
            </span>
          ) : null}
        </span>
        <span
          className="text-muted-foreground/70 mt-0.5 block truncate text-[11px]"
          title={path}
        >
          {path}
        </span>
        <span className="text-muted-foreground/55 mt-1 block text-[11px]">
          {t("Home.openedAt").replace(
            "{time}",
            busy
              ? t("Home.openedJustNow")
              : openedAtLabel(openedAt, lang, t("Home.openedUnknown"))
          )}
        </span>
      </span>
      {busy ? (
        <span className="text-muted-foreground relative z-10 mt-1 flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums">
          <span>{Math.round(progress)}%</span>
          <LoaderCircle className="size-3.5 animate-spin" />
        </span>
      ) : (
        <ChevronRight className="text-muted-foreground/40 relative z-10 mt-1 size-3.5 shrink-0" />
      )}
    </button>
  );
}

export default function Home() {
  const { t } = useI18n();
  const { go } = useAppNavigation();
  const {
    root,
    recent,
    recentOpenedAt,
    pickPath,
    open,
  } = useWorkspace();
  const [pendingOpen, setPendingOpen] =
    useState<PendingWorkspaceOpen | null>(null);
  const [progress, setProgress] = useState(0);
  const selectedRoot = pendingOpen?.path ?? root;
  const hasSelection = Boolean(selectedRoot);
  const otherRecent = recent.filter((path) => path !== selectedRoot);

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
      setProgress(100);
      frame = requestAnimationFrame(() => {
        open(pendingOpen.path);
        go("library");
      });
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
          {hasSelection
            ? t("Home.workspacePicker")
            : t("Library.empty.noWorkspace")}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-lg text-sm leading-relaxed">
          {hasSelection
            ? t("Home.workspacePickerHint")
            : t("Library.workspace.hint")}
        </p>

        {selectedRoot ? (
          <div className="mt-4">
            <WorkspaceRow
              path={selectedRoot}
              current
              busy={pendingOpen?.path === selectedRoot}
              progress={progress}
              openedAt={recentOpenedAt[selectedRoot]}
              disabled={Boolean(pendingOpen)}
              onClick={() => queueWorkspaceOpen(selectedRoot, "recent")}
            />
          </div>
        ) : null}

        <div className="mt-6">
          <div className="flex flex-wrap gap-2">
            {hasSelection ? (
              <Button
                size="lg"
                disabled={Boolean(pendingOpen)}
                onClick={() => {
                  if (root) queueWorkspaceOpen(root, "recent");
                }}
              >
                <BookOpen className="icon-md" />
                {t("Home.openLibrary")}
              </Button>
            ) : null}
            <Button
              size="lg"
              variant={hasSelection ? "outline" : "default"}
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
              <FolderOpen className="icon-md" />
              {hasSelection
                ? t("Library.workspace.change")
                : t("Library.workspace.open")}
            </Button>
          </div>

          {pendingOpen ? (
            <span className="sr-only" role="status" aria-live="polite">
              {t("Home.openingWorkspace")} {Math.round(progress)}%
            </span>
          ) : null}

          {otherRecent.length ? (
            <section className="mt-7 border-t pt-5">
              <h2 className="row-label">{t("Home.otherRecentWorkspaces")}</h2>
              <div className="mt-3 flex flex-col gap-1">
                {otherRecent.map((path) => (
                  <WorkspaceRow
                    key={path}
                    path={path}
                    current={false}
                    busy={false}
                    progress={0}
                    openedAt={recentOpenedAt[path]}
                    disabled={Boolean(pendingOpen)}
                    onClick={() => queueWorkspaceOpen(path, "recent")}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
