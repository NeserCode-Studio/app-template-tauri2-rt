const CHAPTER_BODY_WRITE_TOOLS = new Set([
  "novels_chapter_save",
  "novels_chapter_append",
  "novels_chapter_replace",
  "novels_chapter_split_card",
  "novels_chapter_merge_cards",
  "novels_chapter_history_restore",
  "novels_chapter_history_delete",
]);

export interface ChapterWriteTarget {
  workId: string;
  chapterId: string;
}

function stringArgument(
  argumentsValue: Record<string, unknown>,
  key: string
): string | null {
  const value = argumentsValue[key];
  return typeof value === "string" && value ? value : null;
}

export function chapterWriteTarget(
  toolName: string,
  argumentsValue: Record<string, unknown>,
  fallbackWorkId: string | null
): ChapterWriteTarget | null {
  const isChapterBodyWrite =
    CHAPTER_BODY_WRITE_TOOLS.has(toolName) ||
    (toolName === "novels_import_commit" &&
      argumentsValue.target === "chapter");
  if (!isChapterBodyWrite) return null;

  const chapterId = stringArgument(argumentsValue, "chapter_id");
  const workId =
    stringArgument(argumentsValue, "work_id") ?? fallbackWorkId ?? null;
  if (!chapterId || !workId) return null;
  return { workId, chapterId };
}

export function chapterWritePreviewText(
  toolName: string,
  argumentsValue: Record<string, unknown>
): string {
  const text = stringArgument(argumentsValue, "text");
  if (text) return text;

  if (toolName !== "novels_chapter_save") return "";
  const cards = argumentsValue.cards;
  if (!Array.isArray(cards)) return "";
  return cards
    .map((card) =>
      card &&
      typeof card === "object" &&
      typeof (card as { text?: unknown }).text === "string"
        ? (card as { text: string }).text
        : ""
    )
    .filter(Boolean)
    .join("\n");
}
