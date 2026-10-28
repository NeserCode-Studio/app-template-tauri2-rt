import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Clock3,
  FileText,
  MoreHorizontal,
  Settings2,
  Tag,
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
  onSettings: (workId: string) => void;
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
  onSettings,
  onArchive,
  onUnarchive,
  onDelete,
}: WorkCardProps) {
  const { t } = useI18n();

  return (
    <div className="group hover:bg-accent/25 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-2 py-3 transition-colors">
      <button
        type="button"
        onClick={() => onOpen(work.id)}
        disabled={work.archived}
        className="min-w-0 text-left disabled:cursor-default"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{work.title}</span>
          {work.archived ? (
            <span className="border-border text-muted-foreground shrink-0 rounded border px-1 text-[10px]">
              {t("Library.card.archivedBadge")}
            </span>
          ) : null}
          {isCurrent ? (
            <span
              className="bg-primary size-1.5 shrink-0 rounded-full"
              aria-hidden
            />
          ) : null}
        </div>

        <div className="text-muted-foreground mt-1.5 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {work.synopsis.trim() ? (
            <span className="text-muted-foreground/80 line-clamp-1 min-w-0 basis-full">
              {work.synopsis.trim()}
            </span>
          ) : null}
          <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">
            <FileText className="icon-sm opacity-60" />
            {words} {t("Library.card.words")}
          </span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <Tag className="icon-sm shrink-0 opacity-60" />
            <span className="truncate">
              {work.type || t("Library.card.uncategorized")}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">
            <Clock3 className="icon-sm opacity-60" />
            {t("Library.card.updated")} {formatDate(work.updatedAt)}
          </span>
          <span className="hidden shrink-0 items-center gap-1 tabular-nums opacity-75 md:inline-flex">
            {t("Library.card.created")} {formatDate(work.createdAt)}
          </span>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        {work.archived ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2"
            onClick={() => onUnarchive(work.id)}
          >
            <ArchiveRestore className="icon-sm" />
            <span className="hidden md:inline">
              {t("Library.action.unarchive")}
            </span>
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            className="h-7 px-2"
            onClick={() => onOpen(work.id)}
          >
            <BookOpen className="icon-sm" />
            <span className="hidden md:inline">
              {t("Library.action.continue")}
            </span>
          </Button>
        )}

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
            {work.archived ? null : (
              /*
               * 归档作品不给打开书本设置。
               *
               * 归档的含义是"收起来、不再动"，继续写作按钮已经禁用了，
               * 留着设置入口等于在这个状态下还允许改作品本身。这里在菜单层
               * 直接不给，而不是点进去再报错——归档是明确的静默状态，
               * 不该有"你不能这么做"的错误提示来打断它。
               */
              <DropdownMenuItem onSelect={() => onSettings(work.id)}>
                <Settings2 className="icon-sm" />
                {t("Library.action.settings")}
              </DropdownMenuItem>
            )}
            {work.archived ? null : (
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
