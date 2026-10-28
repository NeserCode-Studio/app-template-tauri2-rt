import { useMemo } from "react";

import { useCodex } from "@/contexts/codex";
import { usePreferences } from "@/contexts/preferences";
import type { Card, Chapter } from "@/shared/schema";
import { splitByMentions } from "./mentions";

/**
 * 邻章只读正文。
 *
 * 连续章节流里，环绕当前章的几章是"拿来对照的"，不是"拿来改的"。
 * 因此这里只做渲染：提及高亮、悬停卡与可编辑章保持同一套实现
 * （见 ./mentions），但不挂右键菜单、不挂段首编辑入口。
 *
 * 少了这些入口是刻意的：让用户在只读章里看到"能改"的 affordance，
 * 点了却要先把编辑目标切过去，比没有更糟。
 */

export default function ReadonlyChapter({
  chapter,
  onOpenCodexEntry,
}: {
  chapter: Chapter;
  onOpenCodexEntry?: (entryId: string) => void;
}) {
  const { entries, colorOf } = useCodex();
  const { prefs } = usePreferences();

  const mentionMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) {
      map.set(e.name, e.id);
      for (const alias of e.aliases) if (alias) map.set(alias, e.id);
    }
    return map;
  }, [entries]);

  const colorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) map.set(e.id, colorOf(e.type));
    return map;
  }, [entries, colorOf]);

  return (
    <div className="article-body prose-article mx-auto flex flex-col pl-9">
      {chapter.cards.map((card: Card) => (
        <p
          key={card.id}
          className={[
            "article-paragraph py-0.5 pr-1 pl-7",
            card.text.trim() ? "" : "is-empty text-muted-foreground/40",
          ].join(" ")}
        >
          {card.text.trim()
            ? (prefs.highlightMentions
                ? splitByMentions(card.text, mentionMap)
                : [{ text: card.text, entryId: null }]
              ).map((part, i) =>
                part.entryId ? (
                  <mark
                    key={i}
                    className="cursor-help rounded-sm px-0.5 text-foreground"
                    style={{ backgroundColor: `${colorById.get(part.entryId) ?? "#888"}2e` }}
                    onClick={() => onOpenCodexEntry?.(part.entryId!)}
                    title={part.text}
                  >
                    {part.text}
                  </mark>
                ) : (
                  <span key={i}>{part.text}</span>
                )
              )
            : " "}
        </p>
      ))}
    </div>
  );
}
