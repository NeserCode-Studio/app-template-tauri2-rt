import {
  Archive,
  ArchiveRestore,
  BookOpen,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  onDelete: (workId: string) => void;
}

/** 把毫秒时间戳格式化为本地日期 YYYY-MM-DD。 */
function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * 单张作品卡片。
 *
 * 本地纯文本写作工具不产出封面，因此不设封面位：
 * 纵向空间全部让给文字信息，卡片横向压缩为列表式，
 * 一屏能看到更多作品，而不是每部作品占掉一整屏。
 */
export default function WorkCard({
  work,
  words,
  isCurrent,
  onOpen,
  onRename,
  onArchive,
  onUnarchive,
  onDelete,
}: WorkCardProps) {
  const { t } = useI18n();

  return (
    <div className="group flex items-center gap-2 rounded-md border px-3 py-2 transition-colors hover:border-foreground/20 hover:bg-accent/30">
      <button
        type="button"
        onClick={() => onOpen(work.id)}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
      >
        <div className="flex w-full items-center gap-2">
          <span className="truncate text-sm font-medium">{work.title}</span>
          {work.archived ? (
            <span className="shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground">
              {t("Library.card.archivedBadge")}
            </span>
          ) : null}
          {isCurrent ? (
            <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          ) : null}
        </div>

        <div className="flex w-full items-center gap-1.5 text-xs text-muted-foreground">
          <span className="shrink-0 tabular-nums">
            {words} {t("Library.card.words")}
          </span>
          {work.type ? (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{work.type}</span>
            </>
          ) : null}
          <span className="ml-auto shrink-0 tabular-nums opacity-70">
            {formatDate(work.updatedAt)}
          </span>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="secondary"
          className="h-7"
          onClick={() => onOpen(work.id)}
          disabled={work.archived}
        >
          <BookOpen className="icon-sm" />
          <span className="hidden sm:inline">{t("Library.action.continue")}</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={t("Titlebar.menu.turnto")}
            >
              <MoreHorizontal className="icon-sm" />
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
            {/*
             * 删除放最后并染成破坏色：它紧挨着归档，而两者后果
             * 差一个量级——归档一键可回，删除要进回收站再捞。
             * 确认由上层的输入确认弹窗负责，这里只负责发起。
             */}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => onDelete(work.id)}
            >
              <Trash2 className="icon-sm" />
              {t("Library.action.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
