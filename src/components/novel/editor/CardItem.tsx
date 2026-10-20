import { useMemo } from "react";
import { BookOpen } from "lucide-react";
import { Pencil } from "lucide-react";

import { useI18n } from "@/composables";
import { useCodex } from "@/contexts/codex";
import { usePreferences } from "@/contexts/preferences";
import { typeLabel } from "@/services/codex";
import { splitByMentions } from "./mentions";
import type { Card } from "@/shared/schema";
import TextContextMenu from "./TextContextMenu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
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
  const { entries, mentions, typeConfigs, colorOf } = useCodex();
  const entry = entries.find((e) => e.id === entryId) ?? null;
  if (!entry) return <mark className="rounded-sm px-0.5">{text}</mark>;
  const type = typeConfigs.find((item) => item.id === entry.typeId);
  const chapterCount = mentions[entryId]?.length ?? 0;

  return (
    <HoverCard openDelay={300} closeDelay={120}>
      <HoverCardTrigger asChild>
        <mark
          className="text-foreground cursor-help rounded-sm px-0.5"
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
      <HoverCardContent
        className="flex w-64 items-start gap-2 p-2.5 text-xs"
        align="start"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-baseline gap-1.5">
            <span
              className="size-1.5 shrink-0 translate-y-px rounded-full"
              style={{ backgroundColor: colorOf(entry.typeId) }}
            />
            <span className="truncate text-[13px] leading-tight font-medium">
              {entry.name}
            </span>
            <span className="text-muted-foreground/60 ml-auto shrink-0 text-[10px] leading-tight">
              {typeLabel(type, t)}
            </span>
          </div>
          {entry.aliases.length ? (
            <p className="text-muted-foreground/70 truncate pl-3 text-[11px] leading-tight">
              / {entry.aliases.join(" / ")}
            </p>
          ) : null}
          {entry.summary ? (
            <p className="text-muted-foreground line-clamp-2 pl-3 text-[11px] leading-snug">
              {entry.summary}
            </p>
          ) : null}
          {entry.tags.length ? (
            <p className="text-muted-foreground/60 flex flex-wrap gap-1 pl-3 text-[10px]">
              {entry.tags.map((tag) => (
                <span key={tag} className="bg-accent/60 rounded-sm px-1 py-px">
                  {tag}
                </span>
              ))}
            </p>
          ) : null}
          <p className="text-muted-foreground/60 pl-3 text-[10px] leading-tight">
            {chapterCount} {t("Codex.mentions.chapters")}
          </p>
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

export interface CardItemProps {
  card: Card;
  index: number;
  total: number;
  /** 专注模式：非当前卡片降到 35% 不透明度。 */
  dimmed: boolean;
  /** 当前正在编辑的已有段落。 */
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
    const candidates = new Map<string, Set<string>>();
    const add = (word: string, id: string) => {
      const key = word.trim();
      if (!key) return;
      candidates.set(key, new Set([...(candidates.get(key) ?? []), id]));
    };
    for (const e of entries) {
      add(e.name, e.id);
      for (const alias of e.aliases) add(alias, e.id);
    }
    const map = new Map<string, string>();
    for (const [word, ids] of candidates) {
      if (ids.size === 1) map.set(word, ids.values().next().value as string);
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
    for (const e of entries) map.set(e.id, colorOf(e.typeId));
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
          "group article-paragraph relative cursor-text rounded-sm py-0.5 pr-1 pl-7 transition-opacity",
          dimmed ? "opacity-35" : "opacity-100",
          isActive ? "is-editing" : "hover:bg-accent/20",
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
            "text-muted-foreground/40 absolute top-0 left-0 flex h-full w-6 items-center justify-center rounded",
            "hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring focus-visible:ring-1 focus-visible:outline-none",
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

        <p
          className={
            isEmpty ? "is-empty text-muted-foreground/40 min-h-[1lh]" : ""
          }
        >
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

        {/*
         * 原先这里挂过一个悬停浮现的操作菜单（拆分 / 拼合 / 上下移 / 删除）。
         * 已移除：四个操作在右键菜单里全都有，而悬停菜单会在鼠标扫过
         * 正文时不断闪现——恰好在阅读时最密集的地方制造视觉噪音，
         * 而且它浮在段落右上角，会遮住相邻段落的行尾。
         * 右键是那个层级该有的入口：它按需出现，不抢注意力。
         */}
      </div>
    </TextContextMenu>
  );
}
