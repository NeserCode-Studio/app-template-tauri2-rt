import { useMemo } from "react";
import { ArrowDown, ArrowUp, Combine, MoreHorizontal, Scissors, Trash2 } from "lucide-react";

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
  onClick: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onSplit: (index: number) => void;
  onMergeDown: (index: number) => void;
  onDelete: (index: number) => void;
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
  onClick,
  onMoveUp,
  onMoveDown,
  onSplit,
  onMergeDown,
  onDelete,
}: CardItemProps) {
  const { t } = useI18n();
  const { entries } = useCodex();
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

  return (
    <div
      role="button"
      tabIndex={0}
      data-card-index={index}
      onClick={() => onClick(index)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(index);
        }
      }}
      className={[
        "group relative article-paragraph cursor-text rounded-sm px-1 py-0.5 transition-opacity",
        dimmed ? "opacity-35" : "opacity-100",
        isActive ? "bg-accent/40" : "hover:bg-accent/20",
      ].join(" ")}
    >
      <p className={isEmpty ? "is-empty min-h-[1lh] text-muted-foreground/40" : ""}>
        {isEmpty
          ? " "
          : parts.map((part, i) =>
              part.entryId ? (
                <mark
                  key={i}
                  className="rounded-sm bg-primary/15 px-0.5 text-foreground"
                >
                  {part.text}
                </mark>
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
              aria-label={t("Editor.card.edit")}
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

      {/* 卡片序号：仅在悬停时淡入，帮助定位光标 */}
      <span className="absolute -left-8 top-0 w-6 text-right text-xs text-muted-foreground/0 tabular-nums transition-colors group-hover:text-muted-foreground/40">
        {index + 1}
      </span>
    </div>
  );
}
