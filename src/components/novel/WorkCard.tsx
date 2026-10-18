import { BookOpen, MoreHorizontal, Archive, ArchiveRestore, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/composables";
import type { Work } from "@/shared/schema";

export interface WorkCardProps {
  work: Work;
  words: number;
  /** 是否为当前正在写的作品。 */
  isCurrent: boolean;
  onOpen: (workId: string) => void;
  onRename: (workId: string) => void;
  onArchive: (workId: string) => void;
  onUnarchive: (workId: string) => void;
}

/**
 * 单张作品卡片：封面位、标题、类型标签、总字数、继续写作按钮。
 *
 * 封面暂用首字母占位（计划书 M1 的"封面占位"），后续可接本地图片。
 */
export default function WorkCard({
  work,
  words,
  isCurrent,
  onOpen,
  onRename,
  onArchive,
  onUnarchive,
}: WorkCardProps) {
  const { t } = useI18n();

  return (
    <Card className="group flex flex-col overflow-hidden transition-colors hover:border-foreground/20">
      <button
        type="button"
        onClick={() => onOpen(work.id)}
        className="flex flex-col text-left"
      >
        {/* 封面占位：用标题首字符 */}
        <div className="flex aspect-[3/4] w-full items-center justify-center bg-muted/40 text-4xl font-semibold text-muted-foreground/50">
          {work.title.trim().charAt(0) || "?"}
        </div>

        <CardHeader className="gap-1 px-4 py-3">
          <CardTitle className="flex items-center gap-2 text-base leading-tight">
            <span className="truncate">{work.title}</span>
            {work.archived ? (
              <Badge variant="secondary" className="shrink-0 text-xs">
                {t("Library.card.archivedBadge")}
              </Badge>
            ) : null}
          </CardTitle>
          {work.type ? (
            <p className="truncate text-xs text-muted-foreground">{work.type}</p>
          ) : null}
        </CardHeader>
      </button>

      <CardContent className="px-4 pb-2">
        <p className="text-xs text-muted-foreground">
          {words} {t("Library.card.words")}
        </p>
      </CardContent>

      <CardFooter className="mt-auto gap-2 px-4 pb-3">
        <Button
          size="sm"
          className="flex-1"
          onClick={() => onOpen(work.id)}
          disabled={work.archived}
        >
          <BookOpen className="icon-md" />
          {t("Library.action.continue")}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" aria-label={t("Titlebar.menu.turnto")}>
              <MoreHorizontal className="icon-md" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onRename(work.id)}>
              <Pencil className="icon-sm" />
              {t("Library.action.rename")}
            </DropdownMenuItem>
            {work.archived ? (
              <DropdownMenuItem onSelect={() => onUnarchive(work.id)}>
                <ArchiveRestore className="icon-sm" />
                {t("Library.action.unarchive")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => onArchive(work.id)}>
                <Archive className="icon-sm" />
                {t("Library.action.archive")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardFooter>

      {isCurrent ? (
        <div className="h-0.5 w-full bg-primary" aria-hidden />
      ) : null}
    </Card>
  );
}
