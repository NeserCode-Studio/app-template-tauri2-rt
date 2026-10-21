/**
 * 中文小说段落整理。
 *
 * 外部 txt 的排版没有统一约定：有的每段一行，有的整章一行，有的在
 * 句中断行，还有的用空行、全角缩进或对白引号表达段落。这里优先相信
 * 作者留下的显式边界；只有长块或明显的硬换行才重新组织。
 */

const TARGET_PARAGRAPH = 140;
const SOFT_MIN_PARAGRAPH = 40;
const HARD_MAX_PARAGRAPH = 220;

const TERMINAL_PUNCTUATION = /[。！？!?…]+[”’」』】）)]*$/;
const LINE_END_PUNCTUATION = /[。！？!?…，,、；;：:]$/;
const DIALOGUE_START = /^(?:[“「『"]|——)/;
const SCENE_START =
  /^(?:第[〇零一二三四五六七八九十百千两0-9０-９]+天|次日|翌日|隔日|数日后|几日后|片刻后|半晌|不多时|与此同时|另一边|话说|却说|且说|话分两头|这时|此时|忽然|只见)/;

interface SegmenterLike {
  segment(input: string): Iterable<{ segment: string }>;
}

interface SegmenterConstructor {
  new (locale?: string, options?: { granularity: "sentence" }): SegmenterLike;
}

const Segmenter = (Intl as unknown as { Segmenter?: SegmenterConstructor })
  .Segmenter;
const sentenceSegmenter = Segmenter
  ? new Segmenter("zh-CN", { granularity: "sentence" })
  : null;

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\t\v\f]+/g, " ");
}

function joinText(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  if (/\s$/.test(left) || /^\s/.test(right)) return left + right;
  if (/[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right)) {
    return `${left} ${right}`;
  }
  return left + right;
}

function splitDialogueTurns(text: string): string[] {
  return text
    .replace(/([。！？!?…”’」』])\s*(?=[“「『"])/g, "$1\n")
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean);
}

function sentenceParts(text: string): string[] {
  return splitDialogueTurns(text).flatMap((turn) => {
    if (sentenceSegmenter) {
      return Array.from(sentenceSegmenter.segment(turn))
        .map((part) => part.segment.trim())
        .filter(Boolean);
    }
    return (
      turn.match(/[^。！？!?…]+(?:[。！？!?…]+[”’」』】）)]*|$)/g) ?? [turn]
    )
      .map((part) => part.trim())
      .filter(Boolean);
  });
}

function splitLongClause(sentence: string): string[] {
  if (sentence.length <= HARD_MAX_PARAGRAPH) return [sentence];
  const clauses =
    sentence.match(/[^，,；;]+[，,；;]?/g)?.map((part) => part.trim()) ?? [];
  if (clauses.length <= 1) return [sentence];

  const out: string[] = [];
  let current = "";
  for (const clause of clauses) {
    if (
      current &&
      current.length + clause.length > HARD_MAX_PARAGRAPH &&
      current.length >= SOFT_MIN_PARAGRAPH
    ) {
      out.push(current);
      current = clause;
    } else {
      current = joinText(current, clause);
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * 按句读组织段落。
 *
 * 对白单独成段；场景转换优先起新段；普通叙述在目标长度附近再断开。
 * 这比“每 320 字硬切一刀”更接近中文小说的阅读节奏。
 */
function paragraphsFromSentences(text: string): string[] {
  const sentences = sentenceParts(text).flatMap(splitLongClause);
  const paragraphs: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }

    const nextIsDialogue = DIALOGUE_START.test(sentence);
    const shouldBreak =
      nextIsDialogue ||
      SCENE_START.test(sentence) ||
      (current.length >= TARGET_PARAGRAPH && sentence.length >= 24) ||
      current.length + sentence.length > HARD_MAX_PARAGRAPH;

    if (shouldBreak) {
      paragraphs.push(current);
      current = sentence;
    } else {
      current = joinText(current, sentence);
    }
  }

  if (current) paragraphs.push(current);
  return paragraphs;
}

function looksLikeVerse(lines: string[]): boolean {
  if (lines.length < 2) return false;
  if (lines.some((line) => DIALOGUE_START.test(line))) return false;
  const lengths = lines.map((line) => line.length);
  const allShort = lengths.every((length) => length <= 28);
  const punctuated = lines.filter((line) =>
    LINE_END_PUNCTUATION.test(line)
  ).length;
  return (
    allShort &&
    (lines.length >= 4 ||
      (lines.length >= 2 && punctuated / lines.length >= 0.75))
  );
}

function paragraphsFromLines(lines: string[]): string[] {
  const entries = lines
    .map((raw) => ({ raw, text: raw.trim() }))
    .filter((entry) => Boolean(entry.text));
  if (!entries.length) return [];
  if (looksLikeVerse(entries.map((entry) => entry.text))) {
    return entries.map((entry) => entry.text);
  }

  const indented = entries.filter((entry) =>
    /^(?: {2,}|\u3000+)/.test(entry.raw)
  ).length;
  const terminalLines = entries.filter((entry) =>
    TERMINAL_PUNCTUATION.test(entry.text)
  ).length;
  const eachLineIsParagraph =
    indented > 0 ||
    (entries.length > 1 && terminalLines / entries.length >= 0.65);

  if (eachLineIsParagraph) {
    if (indented > 0) {
      const paragraphs: string[] = [];
      let current = "";
      for (const entry of entries) {
        const startsParagraph = /^(?: {2,}|\u3000+)/.test(entry.raw);
        if (startsParagraph && current) {
          paragraphs.push(current);
          current = entry.text;
        } else {
          current = joinText(current, entry.text);
        }
      }
      if (current) paragraphs.push(current);
      return paragraphs.flatMap(paragraphsFromSentences);
    }
    return entries.flatMap((entry) => paragraphsFromSentences(entry.text));
  }

  const merged: string[] = [];
  let current = "";
  for (const entry of entries) {
    const startsNewParagraph =
      Boolean(current) &&
      TERMINAL_PUNCTUATION.test(current) &&
      (DIALOGUE_START.test(entry.text) || SCENE_START.test(entry.text));
    if (startsNewParagraph) {
      merged.push(current);
      current = entry.text;
    } else {
      current = joinText(current, entry.text);
    }
  }
  if (current) merged.push(current);
  return merged.flatMap(paragraphsFromSentences);
}

/**
 * 把一段可能含硬换行、空行或整章长文本的内容整理为自然段。
 */
export function paragraphsFromText(text: string): string[] {
  const normalized = normalizeText(text).trim();
  if (!normalized) return [];

  return normalized
    .split(/\n[ \t\u3000]*\n+/)
    .flatMap((block) => {
      const trimmed = block.trim();
      if (!trimmed) return [];
      return trimmed.includes("\n")
        ? paragraphsFromLines(trimmed.split("\n"))
        : paragraphsFromSentences(trimmed);
    })
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}
