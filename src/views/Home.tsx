import { BookMarked, BookOpen, ChevronRight, FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/composables";
import { useWorkspace } from "@/contexts/workspace";
import { useAppNavigation } from "@/lib/navigation";

export default function Home() {
  const { t } = useI18n();
  const { go } = useAppNavigation();
  const { root, recent, isOpen, pick, open } = useWorkspace();
  const hasWorkspace = Boolean(isOpen && root);

  async function chooseWorkspace() {
    const selected = await pick();
    if (selected) go("library");
  }

  function openRecentWorkspace(path: string) {
    open(path);
    go("library");
  }

  return (
    <div className="view scrollbar-app bg-neutral-50 h-full w-full overflow-y-auto dark:bg-neutral-700">
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
              onClick={() => void chooseWorkspace()}
            >
              <FolderOpen className="icon-md" />
              {t("Library.workspace.pick")}
            </Button>
          </div>
          {recent.length ? (
            <section className="mt-7">
              <h2 className="row-label">{t("Library.workspace.recent")}</h2>
              <div className="mt-3 flex flex-col gap-1">
                {recent.map((path) => (
                  <button
                    key={path}
                    type="button"
                    onClick={() => openRecentWorkspace(path)}
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
