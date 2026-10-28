import { z } from "zod";

import { AppError } from "./errors";
import { requireRoot, requireWorkId } from "./helpers";
import { saveChapterCommand } from "./chapter";
import { defineAppCommand } from "./types";
import {
  cardsToText,
  countWords,
  dropHistory,
  historyText,
  listHistory,
  loadChapter,
  loadChapterMetas,
  rollbackTo,
} from "@/services/chapter";
import { loadOutline } from "@/services/outline";
import { cardSchema, type Card, type Chapter } from "@/shared/schema";
import { paragraphsFromText } from "@/lib/chinese-paragraphs";

const cardInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    text: z.string().max(200_000),
    created_at: z.number().int().nonnegative().optional(),
    updated_at: z.number().int().nonnegative().optional(),
  })
  .strict();

function cardsFromInput(
  cards: z.infer<typeof cardInputSchema>[],
  existing: Card[] = []
): Card[] {
  const now = Date.now();
  return cards.map((card, index) => {
    const previous = existing[index];
    return cardSchema.parse({
      id: card.id ?? previous?.id ?? crypto.randomUUID(),
      text: card.text,
      createdAt: card.created_at ?? previous?.createdAt ?? now + index,
      updatedAt: card.updated_at ?? now + index,
    });
  });
}

function cardsFromText(text: string): Card[] {
  const now = Date.now();
  const paragraphs = paragraphsFromText(text);
  const blocks = paragraphs.length ? paragraphs : text.trim() ? [text] : [];
  return blocks.map((block, index) =>
    cardSchema.parse({
      id: crypto.randomUUID(),
      text: block,
      createdAt: now + index,
      updatedAt: now + index,
    })
  );
}

async function requireChapter(
  root: string,
  workId: string,
  chapterId: string
): Promise<Chapter> {
  const chapter = await loadChapter(root, workId, chapterId);
  if (!chapter) {
    throw new AppError("not_found", "The chapter was not found or is unreadable.");
  }
  return chapter;
}

const chapterList = defineAppCommand({
  id: "novels_chapter_list",
  title: "List chapters",
  description:
    "List chapter metadata from the chapter index in outline order with pagination.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    })
    .strict(),
  permission: "read",
  risk: "R0",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(input, context) {
    const root = requireRoot(context);
    const workId = requireWorkId(context, input.work_id);
    const [outline, metas] = await Promise.all([
      loadOutline(root, workId),
      loadChapterMetas(root, workId),
    ]);
    const items = outline.nodes
      .filter((node) => node.type === "chapter")
      .sort((a, b) => a.order - b.order)
      .map((node) => ({
        id: node.id,
        title: node.title,
        parent_id: node.parentId,
        order: node.order,
        status: node.status,
        synopsis: node.synopsis,
        updated_at: metas[node.id]?.updatedAt ?? node.updatedAt,
        words: metas[node.id]?.words ?? 0,
      }));
    const page = items.slice(input.offset, input.offset + input.limit);
    const next = input.offset + page.length;
    return {
      work_id: workId,
      items: page,
      total_count: items.length,
      count: page.length,
      offset: input.offset,
      has_more: next < items.length,
      next_offset: next < items.length ? next : null,
    };
  },
});

const chapterGet = defineAppCommand({
  id: "novels_chapter_get",
  title: "Get chapter",
  description:
    "Return chapter metadata and a card range. Use card_start/card_end for large chapters.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      chapter_id: z.string().uuid(),
      card_start: z.number().int().nonnegative().default(0),
      card_end: z.number().int().positive().optional(),
    })
    .strict(),
  permission: "read",
  risk: "R0",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(input, context) {
    const root = requireRoot(context);
    const workId = requireWorkId(context, input.work_id);
    const chapter = await requireChapter(root, workId, input.chapter_id);
    const end = Math.min(
      chapter.cards.length,
      input.card_end ?? input.card_start + 40
    );
    const cards = chapter.cards.slice(input.card_start, end);
    return {
      chapter: {
        id: chapter.id,
        title: chapter.title,
        status: chapter.status,
        revision: chapter.revision,
        cursor: chapter.cursor,
        updated_at: chapter.updatedAt,
        words: countWords(cardsToText(chapter.cards)),
        card_count: chapter.cards.length,
      },
      cards,
      card_start: input.card_start,
      card_end: end,
      has_more: end < chapter.cards.length,
      text: cards.map((card) => card.text).join("\n"),
    };
  },
});

const chapterSave = defineAppCommand({
  id: "novels_chapter_save",
  title: "Save chapter",
  description:
    "Replace a chapter's cards using expected_revision. A stale revision returns revision_conflict.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      chapter_id: z.string().uuid(),
      expected_revision: z.number().int().nonnegative(),
      cards: z.array(cardInputSchema).max(100_000),
      snapshot: z.boolean().default(true),
    })
    .strict(),
  permission: "write",
  risk: "R1",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async execute(input, context) {
    const root = requireRoot(context);
    const workId = requireWorkId(context, input.work_id);
    const chapter = await requireChapter(root, workId, input.chapter_id);
    return saveChapterCommand(
      {
        root,
        workId,
        chapter,
        cards: cardsFromInput(input.cards, chapter.cards),
        expectedRevision: input.expected_revision,
        snapshot: input.snapshot,
        source: "mcp",
      },
      {
        onWordsCommitted: async () => {
          context.progress.report({
            progress: 1,
            total: 1,
            message: "Chapter saved",
          });
        },
      }
    );
  },
});

const chapterAppend = defineAppCommand({
  id: "novels_chapter_append",
  title: "Append to chapter",
  description:
    "Append text or cards to a chapter using expected_revision. Text is split into paragraphs.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      chapter_id: z.string().uuid(),
      expected_revision: z.number().int().nonnegative(),
      text: z.string().max(500_000).optional(),
      cards: z.array(cardInputSchema).max(10_000).optional(),
    })
    .strict()
    .refine(
      (value) => Boolean(value.text?.trim()) || Boolean(value.cards?.length),
      "Provide non-empty text or cards."
    ),
  permission: "write",
  risk: "R1",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async execute(input, context) {
    const root = requireRoot(context);
    const workId = requireWorkId(context, input.work_id);
    const chapter = await requireChapter(root, workId, input.chapter_id);
    const appended = input.cards?.length
      ? cardsFromInput(input.cards)
      : cardsFromText(input.text ?? "");
    return saveChapterCommand({
      root,
      workId,
      chapter,
      cards: [...chapter.cards, ...appended],
      expectedRevision: input.expected_revision,
      source: "mcp",
    });
  },
});

const chapterReplace = defineAppCommand({
  id: "novels_chapter_replace",
  title: "Replace chapter text",
  description:
    "Replace all chapter text with paragraphs derived from text. expected_revision is required.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      chapter_id: z.string().uuid(),
      expected_revision: z.number().int().nonnegative(),
      text: z.string().max(500_000),
    })
    .strict(),
  permission: "write",
  risk: "R1",
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  async execute(input, context) {
    const root = requireRoot(context);
    const workId = requireWorkId(context, input.work_id);
    const chapter = await requireChapter(root, workId, input.chapter_id);
    return saveChapterCommand({
      root,
      workId,
      chapter,
      cards: cardsFromText(input.text),
      expectedRevision: input.expected_revision,
      source: "mcp",
    });
  },
});

const chapterSplitCard = defineAppCommand({
  id: "novels_chapter_split_card",
  title: "Split chapter card",
  description:
    "Split one card at a character offset, preserving card order and history.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      chapter_id: z.string().uuid(),
      expected_revision: z.number().int().nonnegative(),
      card_index: z.number().int().nonnegative(),
      offset: z.number().int().positive(),
    })
    .strict(),
  permission: "write",
  risk: "R1",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async execute(input, context) {
    const root = requireRoot(context);
    const workId = requireWorkId(context, input.work_id);
    const chapter = await requireChapter(root, workId, input.chapter_id);
    const card = chapter.cards[input.card_index];
    if (!card) throw new AppError("not_found", "The card was not found.");
    const head = card.text.slice(0, input.offset).trim();
    const tail = card.text.slice(input.offset).trim();
    if (!head || !tail) {
      throw new AppError(
        "invalid_argument",
        "offset must leave non-empty text on both sides of the split."
      );
    }
    const now = Date.now();
    const nextCard = cardSchema.parse({
      id: crypto.randomUUID(),
      text: tail,
      createdAt: now,
      updatedAt: now,
    });
    const cards = [
      ...chapter.cards.slice(0, input.card_index),
      { ...card, text: head, updatedAt: now },
      nextCard,
      ...chapter.cards.slice(input.card_index + 1),
    ];
    return saveChapterCommand({
      root,
      workId,
      chapter,
      cards,
      expectedRevision: input.expected_revision,
      source: "mcp",
    });
  },
});

const chapterMergeCards = defineAppCommand({
  id: "novels_chapter_merge_cards",
  title: "Merge chapter cards",
  description:
    "Merge one card with the following card using expected_revision.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      chapter_id: z.string().uuid(),
      expected_revision: z.number().int().nonnegative(),
      card_index: z.number().int().nonnegative(),
    })
    .strict(),
  permission: "write",
  risk: "R1",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async execute(input, context) {
    const root = requireRoot(context);
    const workId = requireWorkId(context, input.work_id);
    const chapter = await requireChapter(root, workId, input.chapter_id);
    const card = chapter.cards[input.card_index];
    const nextCard = chapter.cards[input.card_index + 1];
    if (!card || !nextCard) {
      throw new AppError(
        "not_found",
        "Both the card and the following card must exist."
      );
    }
    const merged: Card = {
      ...card,
      text: `${card.text.trimEnd()}${nextCard.text}`,
      updatedAt: Date.now(),
    };
    const cards = [
      ...chapter.cards.slice(0, input.card_index),
      merged,
      ...chapter.cards.slice(input.card_index + 2),
    ];
    return saveChapterCommand({
      root,
      workId,
      chapter,
      cards,
      expectedRevision: input.expected_revision,
      source: "mcp",
    });
  },
});

const chapterHistoryList = defineAppCommand({
  id: "novels_chapter_history_list",
  title: "List chapter history",
  description:
    "List current and historical chapter snapshots with timestamps, card counts and previews.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      chapter_id: z.string().uuid(),
    })
    .strict(),
  permission: "read",
  risk: "R0",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(input, context) {
    const root = requireRoot(context);
    const workId = requireWorkId(context, input.work_id);
    const chapter = await requireChapter(root, workId, input.chapter_id);
    return { revision: chapter.revision, items: listHistory(chapter) };
  },
});

const chapterHistoryRead = defineAppCommand({
  id: "novels_chapter_history_read",
  title: "Read chapter history",
  description:
    "Read a historical snapshot by index. Use -1 for the current body.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      chapter_id: z.string().uuid(),
      index: z.number().int().min(-1),
    })
    .strict(),
  permission: "read",
  risk: "R0",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(input, context) {
    const root = requireRoot(context);
    const workId = requireWorkId(context, input.work_id);
    const chapter = await requireChapter(root, workId, input.chapter_id);
    const paragraphs = historyText(chapter, input.index);
    return {
      index: input.index,
      paragraphs,
      text: paragraphs.join("\n"),
      words: countWords(paragraphs.join("\n")),
    };
  },
});

const chapterHistoryRestore = defineAppCommand({
  id: "novels_chapter_history_restore",
  title: "Restore chapter history",
  description:
    "Restore a historical snapshot as the current body with a new revision.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      chapter_id: z.string().uuid(),
      expected_revision: z.number().int().nonnegative(),
      index: z.number().int().nonnegative(),
    })
    .strict(),
  permission: "write",
  risk: "R2",
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  async execute(input, context) {
    const root = requireRoot(context);
    const workId = requireWorkId(context, input.work_id);
    const chapter = await requireChapter(root, workId, input.chapter_id);
    const restored = rollbackTo(chapter, input.index);
    if (restored === chapter) {
      throw new AppError("not_found", "The history snapshot was not found.");
    }
    return saveChapterCommand({
      root,
      workId,
      chapter,
      cards: restored.cards,
      history: restored.history,
      expectedRevision: input.expected_revision,
      snapshot: false,
      source: "mcp",
    });
  },
});

const chapterHistoryDelete = defineAppCommand({
  id: "novels_chapter_history_delete",
  title: "Delete chapter history",
  description:
    "Delete one historical snapshot without creating another body snapshot.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      chapter_id: z.string().uuid(),
      expected_revision: z.number().int().nonnegative(),
      index: z.number().int().nonnegative(),
    })
    .strict(),
  permission: "write",
  risk: "R2",
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(input, context) {
    const root = requireRoot(context);
    const workId = requireWorkId(context, input.work_id);
    const chapter = await requireChapter(root, workId, input.chapter_id);
    const next = dropHistory(chapter, input.index);
    if (next === chapter) {
      throw new AppError("not_found", "The history snapshot was not found.");
    }
    return saveChapterCommand({
      root,
      workId,
      chapter,
      cards: chapter.cards,
      history: next.history,
      expectedRevision: input.expected_revision,
      snapshot: false,
      source: "mcp",
    });
  },
});

export const CHAPTER_COMMANDS = [
  chapterList,
  chapterGet,
  chapterSave,
  chapterAppend,
  chapterReplace,
  chapterSplitCard,
  chapterMergeCards,
  chapterHistoryList,
  chapterHistoryRead,
  chapterHistoryRestore,
  chapterHistoryDelete,
] as const;
