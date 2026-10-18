import { useMemo } from "react";
import { ArrowDown, ArrowUp, BookOpen, Combine, MoreHorizontal, Scissors, Trash2 } from "lucide-react";
import { Pencil } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/composables";
import { useCodex } from "@/contexts/codex";
import { usePreferences } from "@/contexts/preferences";
import type { Card } from "@/shared/schema";
import TextContextMenu from "./TextContextMenu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Button } from "@/components/ui/button";

/**
 * 正文里的素材提及：悬停浮出条目速览。
 *
 * 高亮只是"这里有个名字"的信号，用户真正需要的是"这个人是谁"——
 * 不查就得打断写作去翻素材库。加悬停卡后，鼠标一过就知道，
 * 点一下才跳转。
 */
function MentionHover({
  entryId,
  text,
  color,
  onOpenEntry,
}: {
  entryId: string;
  text: string;
  color: string;
  onOpenEntry?: (entryId: string) => void;
}) {
  const { t } = useI18n();
  const { entries, colorOf } = useCodex();
  const entry = entries.find((e) => e.id === entryId) ?? null;
  if (!entry) return <mark className="rounded-sm px-0.5">{text}</mark>;

  return (
    <HoverCard openDelay={300} closeDelay={120}>
      <HoverCardTrigger asChild>
        <mark
          className="cursor-help rounded-sm px-0.5 text-foreground"
          style={{ backgroundColor: `${color}2e` }}
        >
          {text}
        </mark>
      </HoverCardTrigger>
      {/*
       * 信息密度按"以后还会加字段"来设计：正文摘要限制两行、标签与按钮压到
       * 一行，整体走紧凑排版，避免后续每加一个属性就把卡片撑高。
       */}
      {/*
       * 右侧的"打开素材库"按钮与左侧标题行同高：把头部行和按钮并排在同一个
       * flex 行里，按钮不再另起一行独占高度。
       */}
      <HoverCardContent className="flex w-64 items-start gap-2 p-2.5 text-xs" align="start">
        <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline gap-1.5">
          <span
            className="size-1.5 shrink-0 translate-y-px rounded-full"
            style={{ backgroundColor: colorOf(entry.type) }}
          />
          <span className="truncate text-[13px] font-medium leading-tight">{entry.name}</span>
          <span className="ml-auto shrink-0 text-[10px] leading-tight text-muted-foreground/60">
            {t(`Codex.type.${entry.type}`)}
          </span>
        </div>
        {entry.aliases.length ? (
          <p className="truncate pl-3 text-[11px] leading-tight text-muted-foreground/70">
            / {entry.aliases.join(" / ")}
          </p>
        ) : null}
        {entry.body ? (
          <p className="line-clamp-2 pl-3 text-[11px] leading-snug text-muted-foreground">
            {entry.body}
          </p>
        ) : null}
        {entry.tags.length ? (
          <p className="flex flex-wrap gap-1 pl-3 text-[10px] text-muted-foreground/60">
            {entry.tags.map((tag) => (
              <span key={tag} className="rounded-sm bg-accent/60 px-1 py-px">
                {tag}
              </span>
            ))}
          </p>
        ) : null}
        </div>
        {onOpenEntry ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-[22px] shrink-0 px-1.5 text-[11px]"
            onClick={() => onOpenEntry(entryId)}
            title={t("Codex.library.title")}
          >
            <BookOpen className="icon-sm" />
          </Button>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * 把正文按素材提及切成片段。
 *
 * 必须按**最长优先**匹配：`张三丰` 里同时含 `张三` 与 `丰`（后者是别的条目名）
 * 时，若先匹配短名就会把长名切成碎片。同时用 `Set` 一次判定所有边界，
 * 避免对每个候选名都扫一遍整段——长章里这个开销是平方级的。
 */
function splitByMentions(
  text: string,
  names: Map<string, string>
): { text: string; entryId: string | null }[] {
  if (!names.size || !text) return [{ text, entryId: null }];

  /* 长度降序，保证长名先占住区间。 */
  const candidates = [...names.keys()].sort((a, b) => b.length - a.length);
  const hits: { start: number; end: number; id: string }[] = [];

  for (const name of candidates) {
    if (!name) continue;
    let from = 0;
    for (;;) {
      const at = text.indexOf(name, from);
      if (at < 0) break;
      const end = at + name.length;
      /* 已被更长的匹配覆盖则跳过，不重复高亮。 */
      if (!hits.some((h) => at < h.end && end > h.start)) {
        hits.push({ start: at, end, id: names.get(name)! });
      }
      from = end;
    }
  }
  if (!hits.length) return [{ text, entryId: null }];

  hits.sort((a, b) => a.start - b.start);
  const out: { text: string; entryId: string | null }[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start > cursor) out.push({ text: text.slice(cursor, h.start), entryId: null });
    out.push({ text: text.slice(h.start, h.end), entryId: h.id });
    cursor = h.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), entryId: null });
  return out;
}

export interface CardItemProps {
  card: Card;
  index: number;
  total: number;
  /** 专注模式：非当前卡片降到 35% 不透明度。 */
  dimmed: boolean;
  /** 打字机模式：当前卡片是否固定在视口舒适线。 */
  isActive: boolean;
  /** 载入输入框编辑。 */
  onEdit: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onSplit: (index: number) => void;
  onMergeDown: (index: number) => void;
  onDelete: (index: number) => void;
  /** 打开素材库并选中该条目（hover 卡片点击时）。 */
  onOpenCodexEntry?: (entryId: string) => void;
}

/**
 * 单张卡片：文字所在即光标所在。
 *
 * 卡片是编辑器的最小重算单元——高亮、提及、标签只在这张卡上计算，
 * 而不是整章重扫。点击即载入底部输入框编辑。
 */
export default function CardItem({
  card,
  index,
  total,
  dimmed,
  isActive,
  onEdit,
  onMoveUp,
  onMoveDown,
  onSplit,
  onMergeDown,
  onDelete,
  onOpenCodexEntry,
}: CardItemProps) {
  const { t } = useI18n();
  const { entries, colorOf } = useCodex();
  const { prefs } = usePreferences();
  const isEmpty = card.text.trim().length === 0;

  /* 名称 → 条目 id。别名一并纳入：正文里常写的是别名而非本名。 */
  const mentionMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) {
      map.set(e.name, e.id);
      for (const alias of e.aliases) if (alias) map.set(alias, e.id);
    }
    return map;
  }, [entries]);

  const parts = useMemo(
    () =>
      prefs.highlightMentions
        ? splitByMentions(card.text, mentionMap)
        : [{ text: card.text, entryId: null }],
    [card.text, mentionMap, prefs.highlightMentions]
  );

  /** 高亮色按条目所属类型取：颜色是类型级设置，不逐条目存。 */
  const colorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) map.set(e.id, colorOf(e.type));
    return map;
  }, [entries, colorOf]);

  return (
    <TextContextMenu
      index={index}
      total={total}
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      onSplit={onSplit}
      onMergeDown={onMergeDown}
      onDelete={onDelete}
    >
    <div
      data-card-index={index}
      className={[
        /*
         * 卡片本身不再吞点击：正文要保持可选中，才能右键复制、
         * 拖选片段去搜索。编辑改由段首的序号区触发（见 onEdit）。
         *
         * 序号与编辑图标合并成一个区域：两者都锚在同一行的同一侧，
         * 分开放会让左侧留白变成两条互不相干的窄带，视觉上像错位。
         */
        "group relative article-paragraph cursor-text rounded-sm py-0.5 pr-1 pl-7 transition-opacity",
        dimmed ? "opacity-35" : "opacity-100",
        isActive ? "bg-accent/40" : "hover:bg-accent/20",
      ].join(" ")}
    >
      {/*
       * 段首的序号 + 编辑入口合成一个区域。
       *
       * 静止时显示序号（纯提示，告诉用户这是第几张卡），
       * 悬停或编辑中时原位换成铅笔。同一块 24px 宽的空间，
       * 不会因为切换而让正文左右抖动。
       */}
      <button
        type="button"
        aria-label={t("Editor.card.edit")}
        title={t("Editor.card.edit")}
        className={[
          "absolute left-0 top-0 flex h-full w-6 items-center justify-center rounded text-muted-foreground/40",
          "hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        ].join(" ")}
        onClick={(e) => {
          e.stopPropagation();
          onEdit(index);
        }}
      >
        <span
          className={[
            "card-index transition-opacity",
            isActive ? "opacity-0" : "opacity-100 group-hover:opacity-0",
          ].join(" ")}
        >
          {index + 1}
        </span>
        <Pencil
          className={[
            "icon-sm absolute transition-opacity",
            isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          ].join(" ")}
        />
      </button>

      <p className={isEmpty ? "is-empty min-h-[1lh] text-muted-foreground/40" : ""}>
        {isEmpty
          ? " "
          : parts.map((part, i) =>
              part.entryId ? (
                <MentionHover
                  key={i}
                  entryId={part.entryId}
                  text={part.text}
                  color={colorById.get(part.entryId) ?? "#7c3aed"}
                  onOpenEntry={onOpenCodexEntry}
                />
              ) : (
                <span key={i}>{part.text}</span>
              )
            )}
      </p>

      {/* 操作菜单：悬停或聚焦时浮现，不干扰阅读 */}
      <div
        className={[
          "absolute -top-3 right-0 flex items-center gap-0.5 rounded-md border bg-background/95 px-0.5 py-0.5 shadow-sm",
          "opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
          isActive ? "opacity-100" : "",
        ].join(" ")}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              aria-label={t("Editor.card.more")}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="icon-sm" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem
              disabled={index === 0}
              onSelect={() => onMoveUp(index)}
            >
              <ArrowUp className="icon-sm" />
              {t("Editor.card.moveUp")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index === total - 1}
              onSelect={() => onMoveDown(index)}
            >
              <ArrowDown className="icon-sm" />
              {t("Editor.card.moveDown")}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              disabled={isEmpty}
              onSelect={() => onSplit(index)}
            >
              <Scissors className="icon-sm" />
              {t("Editor.card.split")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index === total - 1}
              onSelect={() => onMergeDown(index)}
            >
              <Combine className="icon-sm" />
              {t("Editor.card.merge")}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onDelete(index)}
            >
              <Trash2 className="icon-sm" />
              {t("Editor.card.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

    </div>
    </TextContextMenu>
  );
}
