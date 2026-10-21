import { AppError, RevisionConflictError } from "./errors";
import { getEditorSession } from "./editor-session";
import { chapterLockKey, withKeyedLock } from "./locks";
import { createLogger } from "@/lib/logger";
import {
  cardsToText,
  countWords,
  loadChapter,
  saveChapter,
} from "@/services/chapter";
import type { Card, Chapter } from "@/shared/schema";

const log = createLogger("ChapterCommand");

export type ChapterCommandSource = "ui" | "mcp";

export interface SaveChapterCommandInput {
  root: string;
  workId: string;
  chapter: Chapter;
  cards: Card[];
  cursor?: Chapter["cursor"];
  history?: Chapter["history"];
  expectedRevision?: number;
  snapshot?: boolean;
  source?: ChapterCommandSource;
}

export interface SaveChapterCommandDependencies {
  syncMentions?: (
    workId: string,
    chapterId: string,
    text: string
  ) => Promise<void>;
  onWordsCommitted?: (
    chapterWords: number,
    previousChapterWords?: number
  ) => void | Promise<void>;
  onSaved?: (chapter: Chapter) => void | Promise<void>;
}

export interface SaveChapterCommandResult {
  chapter: Chapter;
  wrote: boolean;
  previousWords: number;
  nextWords: number;
}

function sameCards(left: Card[], right: Card[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (card, index) =>
        card.id === right[index].id && card.text === right[index].text
    )
  );
}

function assertEditorAvailable(
  workId: string,
  chapterId: string,
  source: ChapterCommandSource
): void {
  if (source !== "mcp") return;
  const session = getEditorSession();
  if (
    session.workId === workId &&
    session.chapterId === chapterId &&
    (session.dirty || session.saving)
  ) {
    throw new AppError(
      "chapter_busy",
      "The chapter is open in the editor with unsaved or in-flight changes. Save or close it before retrying.",
      { workId, chapterId, dirty: session.dirty, saving: session.saving }
    );
  }
}

/**
 * Shared chapter save pipeline used by both the editor and MCP handlers.
 *
 * The disk file is the source of truth. Callers provide the revision they read,
 * and the keyed lock plus service-level check prevent stale overwrites.
 */
export async function saveChapterCommand(
  input: SaveChapterCommandInput,
  dependencies: SaveChapterCommandDependencies = {}
): Promise<SaveChapterCommandResult> {
  const source = input.source ?? "ui";
  if (source === "mcp" && input.expectedRevision === undefined) {
    throw new AppError(
      "invalid_argument",
      "expected_revision is required for external chapter writes."
    );
  }

  return withKeyedLock(
    chapterLockKey(input.root, input.workId, input.chapter.id),
    async () => {
      assertEditorAvailable(input.workId, input.chapter.id, source);
      const current = await loadChapter(
        input.root,
        input.workId,
        input.chapter.id
      );
      if (
        current &&
        input.expectedRevision !== undefined &&
        current.revision !== input.expectedRevision
      ) {
        throw new RevisionConflictError(current.revision, current.updatedAt);
      }

      const base = current ?? input.chapter;
      const cursor = input.cursor ?? base.cursor;
      const previousWords = countWords(cardsToText(base.cards));
      const nextWords = countWords(cardsToText(input.cards));
      const unchanged =
        sameCards(base.cards, input.cards) &&
        base.cursor.cardIndex === cursor.cardIndex &&
        base.cursor.offset === cursor.offset &&
        (input.history === undefined || input.history === base.history);
      if (unchanged) {
        return {
          chapter: base,
          wrote: false,
          previousWords,
          nextWords,
        };
      }

      const next: Chapter = {
        ...base,
        cards: input.cards,
        cursor,
        ...(input.history !== undefined ? { history: input.history } : {}),
      };
      const saved = await saveChapter(
        input.root,
        input.workId,
        next,
        input.snapshot ?? true,
        true,
        input.expectedRevision
      );

      if (dependencies.syncMentions) {
        try {
          await dependencies.syncMentions(
            input.workId,
            saved.id,
            cardsToText(saved.cards)
          );
        } catch (err) {
          log.warn("mention sync failed after chapter save", err);
        }
      }
      if (dependencies.onWordsCommitted) {
        try {
          await dependencies.onWordsCommitted(nextWords, previousWords);
        } catch (err) {
          log.warn("word accounting failed after chapter save", err);
        }
      }
      if (dependencies.onSaved) {
        try {
          await dependencies.onSaved(saved);
        } catch (err) {
          log.warn("post-save callback failed", err);
        }
      }

      log.info("chapter command saved", {
        workId: input.workId,
        chapterId: saved.id,
        revision: saved.revision,
        source,
        cards: saved.cards.length,
        previousWords,
        nextWords,
      });
      return {
        chapter: saved,
        wrote: true,
        previousWords,
        nextWords,
      };
    }
  );
}
