/**
 * 导入既有文稿：把外部 txt / md 拆成卡片写进某一章。
 *
 * 编码探测放在 Rust 侧（`fs_read_text_auto`）：JS 侧无 BOM 解码
 * GBK 需要整张映射表，自实现既容易错也不可能比 Rust 侧快。
 *
 * txt 与 md 的段落语义不同：txt 优先按空行分段、无空行时退回逐行；
 * md 的标题单独成卡，其余按空行分段，并保留段内显式换行。
 */

import { invoke } from "@tauri-apps/api/core";

import {
  cardSchema,
  chapterSchema,
  outlineNodeSchema,
  type Card,
  type Chapter,
  type Outline,
  type OutlineNode,
} from "@/shared/schema";
import { loadChapterMetas, saveChapter } from "./chapter";
import { saveOutline } from "./outline";
import { createLogger } from "@/lib/logger";
import { paragraphsFromText } from "@/lib/chinese-paragraphs";

const log = createLogger("ImportService");

/**
 * 把解析出的卡片追加进指定章并落盘。
 *
 * 追加而非覆盖：导入是"把外部稿子并进来"，用户已有的卡片不该被冲掉。
 * 想要替换全文时，用户可以先删空再导入。
 */
export async function appendCardsToChapter(
  root: string,
  workId: string,
  chapter: Chapter,
  cards: Card[]
): Promise<Chapter> {
  const next: Chapter = { ...chapter, cards: [...chapter.cards, ...cards] };
  await saveChapter(root, workId, next);
  log.info("imported cards", { chapterId: chapter.id, added: cards.length });
  return next;
}

export interface AutoReadResult {
  content: string;
  /** `utf-8` / `utf-8-bom` / `gb18030`。 */
  encoding: string;
  hadBom: boolean;
}

/** 读取文本并探测编码。 */
export async function readTextAuto(path: string): Promise<AutoReadResult> {
  return invoke<AutoReadResult>("fs_read_text_auto", { path });
}

/**
 * 可导入格式。doc / docx / rtf 不做伪支持：拿不到结构化正文时明确拒绝，
 * 比把乱码写进作品目录更安全。
 */
export type ImportFormat = "txt" | "md";

export interface ImportParseOptions {
  /** 去掉标题开头的“第 X 卷 / 章 / 回”等编号。 */
  stripSectionNumbers?: boolean;
  /** 把没有空行的长块按换行或中文句读再拆成段落。 */
  autoParagraph?: boolean;
}

/** 解析出的卷级信息；preface 即卷首语。 */
export interface ImportVolume {
  title: string;
  preface: string;
}

export interface ImportSaveProgress {
  phase: "chapters" | "index";
  done: number;
  total: number;
  title?: string;
}

export class ImportFileError extends Error {
  constructor(
    public readonly code: "unsupported" | "empty",
    public readonly detail?: string
  ) {
    super(code);
    this.name = "ImportFileError";
  }
}

/** 文件路径最后一段，兼容 Windows 与 Unix 路径。 */
export function importFileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** 从文件名生成新作品标题，去掉扩展名并清理首尾空白。 */
export function importTitleFromPath(path: string): string {
  const fileName = importFileName(path);
  const dot = fileName.lastIndexOf(".");
  return (dot > 0 ? fileName.slice(0, dot) : fileName).trim();
}

function importFormat(path: string): ImportFormat {
  const fileName = importFileName(path);
  const dot = fileName.lastIndexOf(".");
  const extension = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
  if (extension === "txt" || extension === "md") return extension;
  throw new ImportFileError("unsupported", extension || fileName);
}

function cardsFromBlocks(blocks: string[]): Card[] {
  const now = Date.now();
  return blocks
    .map((block) => block.trim())
    .filter(Boolean)
    .map((p, i) =>
      cardSchema.parse({
        id: crypto.randomUUID(),
        text: p,
        createdAt: now + i,
        updatedAt: now + i,
      })
    );
}

function normalizeLines(text: string): string[] {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
}

/** 中文数字 / 阿拉伯数字 / 全角数字都允许出现在节序号里。 */
const CN_NUMBER = String.raw`[0-9０-９〇零一二三四五六七八九十百千两]+`;
const VOLUME_HEADING = new RegExp(
  `^(?:第\\s*(${CN_NUMBER})\\s*[卷部]|卷\\s*(${CN_NUMBER})|Volume\\s+\\d+|Part\\s+\\d+)`,
  "i"
);
const CHAPTER_HEADING = new RegExp(
  `^(?:第\\s*(${CN_NUMBER})\\s*[回章节篇集]|Chapter\\s+\\d+)`,
  "i"
);
const SPECIAL_HEADING =
  /^(?:序章|序言|前言|序|楔子|引子|尾声|后记|终章|番外|外传)(?:[\s:：·・-]+.+)?$/;

const NUMBERED_PREFIX = new RegExp(
  `^(?:第\\s*(${CN_NUMBER})\\s*[卷部回章节篇集]|卷\\s*(${CN_NUMBER})|Volume\\s+\\d+|Part\\s+\\d+)\\s*[:：.、·-]?\\s*`,
  "i"
);

type ImportHeading =
  { kind: "volume"; title: string } | { kind: "chapter"; title: string };

/**
 * 识别整行标题，而不是在段落里找“第 X 章”。
 *
 * 小说 txt 常见的标题是一行“第001回 ……”，正文段落也可能以“第 X 章”
 * 开头；这里要求标题独占一行且不会过长，避免把叙事句误认成结构节点。
 */
function matchHeading(
  line: string,
  stripSectionNumbers = false
): ImportHeading | null {
  const text = line.replace(/^[\s\u3000]+/, "").replace(/[\s\u3000]+$/, "");
  const markdown = text.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
  const candidate = (markdown ? markdown[2] : text)?.trim() ?? "";
  if (!candidate || candidate.length > 120) return null;

  const cleanTitle = (title: string) =>
    stripSectionNumbers
      ? title.replace(NUMBERED_PREFIX, "").trim() || title
      : title;
  if (VOLUME_HEADING.test(candidate)) {
    return { kind: "volume", title: cleanTitle(candidate) };
  }
  if (CHAPTER_HEADING.test(candidate)) {
    return { kind: "chapter", title: cleanTitle(candidate) };
  }
  if (SPECIAL_HEADING.test(candidate))
    return { kind: "chapter", title: candidate };
  /* Markdown 的标题本身就是作者给出的结构信号，全部按章节处理。 */
  if (markdown) return { kind: "chapter", title: candidate };
  return null;
}

function splitParagraphBlock(block: string): string[] {
  return paragraphsFromText(block);
}

function autoParagraphBlocks(blocks: string[], enabled = false): string[] {
  if (!enabled) return blocks;
  return blocks.flatMap((block) =>
    matchHeading(block) ? [block] : splitParagraphBlock(block)
  );
}

function txtBlocks(text: string, options: ImportParseOptions = {}): string[] {
  const lines = normalizeLines(text);
  const paragraphs: string[] = [];
  let current: string[] = [];
  let sawHeading = false;

  const flush = () => {
    const block = current.join("\n").trim();
    if (block) paragraphs.push(block);
    current = [];
  };

  /*
   * 标题行先于空行规则拆出来：很多 txt 的标题和正文之间没有空行，
   * 先按空行切段会让“标题 + 首段”粘在同一块里，结构识别就失效了。
   */
  for (const line of lines) {
    const heading = matchHeading(line, options.stripSectionNumbers);
    if (heading) {
      sawHeading = true;
      flush();
      /*
       * 保留原始标题行。去编号发生在分组阶段，否则去掉“第 X 回”之后
       * sectionsFromBlocks 就再也认不出这是一个结构标题了。
       */
      paragraphs.push(line.trim());
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    current.push(line.trimStart());
  }
  flush();

  if (sawHeading) return autoParagraphBlocks(paragraphs, options.autoParagraph);

  const normalized = lines.join("\n");
  const flatParagraphs = normalized.split(/\n[ \t]*\n+/);
  /*
   * 没有任何空行时按单行切。中文 txt 常见的两种排版分别是
   * “一段一行”和“段落之间空行”，这个兜底比把整本书塞进一张卡可靠。
   */
  const blocks =
    flatParagraphs.length === 1 ? normalized.split("\n") : flatParagraphs;
  return autoParagraphBlocks(blocks, options.autoParagraph);
}

/**
 * Markdown 只实现文稿导入需要的结构：
 * - ATX 标题独立成卡；
 * - 空行分段；
 * - 段内换行保留，避免硬换行或中文排版被静默吞掉。
 */
function markdownBlocks(
  text: string,
  options: ImportParseOptions = {}
): string[] {
  const blocks: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const block = current.join("\n").trim();
    if (block) blocks.push(block);
    current = [];
  };

  for (const rawLine of normalizeLines(text)) {
    const line = rawLine.trimEnd();
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flush();
      if (heading[1]?.trim()) blocks.push(line.trim());
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flush();
      continue;
    }
    current.push(line.trimStart());
  }
  return autoParagraphBlocks(blocks, options.autoParagraph);
}

export interface ParsedImport {
  format: ImportFormat;
  cards: Card[];
  sections: ImportSection[];
  /** 标题之前的前置信息；导入到作品简介，不再生成“作品信息”章。 */
  synopsis: string;
  /** 卷标题与识别出的卷首语。 */
  volumes: ImportVolume[];
}

/** 解析出的一个章节。 */
export interface ImportSection {
  title: string;
  volumeTitle: string | null;
  cards: Card[];
}

interface SectionDraft {
  title: string;
  volumeTitle: string | null;
  blocks: string[];
}

interface SectionGroup {
  sections: ImportSection[];
  frontMatter: string[];
  volumePrefaces: Map<string, string[]>;
}

/** 把扁平文本块归组为卷 / 章结构。 */
function sectionsFromBlocks(
  blocks: string[],
  options: ImportParseOptions = {}
): SectionGroup {
  const drafts: SectionDraft[] = [];
  const frontMatter: string[] = [];
  const volumePrefaces = new Map<string, string[]>();
  let current: SectionDraft = { title: "", volumeTitle: null, blocks: [] };
  let currentVolume: string | null = null;
  let sawHeading = false;

  const flush = () => {
    const hasContent = current.blocks.some((block) => block.trim());
    if (current.title) {
      drafts.push({
        title: current.title,
        volumeTitle: current.volumeTitle,
        blocks: current.blocks,
      });
    } else if (current.volumeTitle) {
      if (hasContent) {
        volumePrefaces.set(current.volumeTitle, [
          ...(volumePrefaces.get(current.volumeTitle) ?? []),
          ...current.blocks.filter((block) => block.trim()),
        ]);
      }
    } else if (sawHeading && hasContent) {
      frontMatter.push(...current.blocks.filter((block) => block.trim()));
    }
    current = { title: "", volumeTitle: currentVolume, blocks: [] };
  };

  for (const block of blocks) {
    const heading = matchHeading(block, options.stripSectionNumbers);
    if (!heading) {
      current.blocks.push(block);
      continue;
    }

    /* 先标记存在标题，随后 flush 才会把标题前的内容归入 frontMatter。 */
    sawHeading = true;
    flush();
    if (heading.kind === "volume") {
      currentVolume = heading.title;
      current = { title: "", volumeTitle: currentVolume, blocks: [] };
      continue;
    }
    current = { title: heading.title, volumeTitle: currentVolume, blocks: [] };
  }
  flush();

  return {
    sections: drafts.map((draft) => ({
      title: draft.title,
      volumeTitle: draft.volumeTitle,
      cards: cardsFromBlocks(draft.blocks),
    })),
    frontMatter,
    volumePrefaces,
  };
}

/** 没识别到结构时，仍按旧语义返回一个扁平段。 */
function flatSections(cards: Card[]): ImportSection[] {
  return [{ title: "", volumeTitle: null, cards }];
}

/**
 * 把结构化导入结果落为完整作品结构。
 *
 * 逐个调用 addNode 会反复读写 outline.json；整本书导入经常是上百章，
 * 这里在内存里组装整棵树，最后一次性写盘。章节文件仍逐个保存，
 * 便于失败时知道是哪一个文件出了问题。
 */
export async function saveImportSections(
  root: string,
  workId: string,
  sections: ImportSection[],
  fallbackTitles: { front: string; untitled: string },
  options: {
    volumes?: ImportVolume[];
    onProgress?: (progress: ImportSaveProgress) => void;
  } = {}
): Promise<Outline> {
  const nodes: OutlineNode[] = [];
  const volumeIds = new Map<string, string>();
  const orders = new Map<string | null, number>();
  const nextOrder = (parentId: string | null) => orders.get(parentId) ?? 0;
  options.onProgress?.({
    phase: "chapters",
    done: 0,
    total: sections.length,
  });

  for (const volume of options.volumes ?? []) {
    if (!volume.title.trim()) continue;
    const volumeId = crypto.randomUUID();
    volumeIds.set(volume.title, volumeId);
    nodes.push(
      outlineNodeSchema.parse({
        id: volumeId,
        type: "volume",
        title: volume.title,
        parentId: null,
        order: nextOrder(null),
        preface: volume.preface,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );
    orders.set(null, nextOrder(null) + 1);
  }

  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    let parentId: string | null = null;
    if (section.volumeTitle) {
      let volumeId = volumeIds.get(section.volumeTitle);
      if (!volumeId) {
        volumeId = crypto.randomUUID();
        volumeIds.set(section.volumeTitle, volumeId);
        nodes.push(
          outlineNodeSchema.parse({
            id: volumeId,
            type: "volume",
            title: section.volumeTitle,
            parentId: null,
            order: nextOrder(null),
            preface:
              (options.volumes ?? []).find(
                (volume) => volume.title === section.volumeTitle
              )?.preface ?? "",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
        );
        orders.set(null, nextOrder(null) + 1);
      }
      parentId = volumeId;
    }

    const title =
      section.title.trim() ||
      (section.volumeTitle ? fallbackTitles.untitled : fallbackTitles.front);
    const now = Date.now();
    const chapter = chapterSchema.parse({
      id: crypto.randomUUID(),
      title,
      cards: section.cards,
      createdAt: now,
      updatedAt: now,
    });
    await saveChapter(root, workId, chapter, false, false);
    nodes.push(
      outlineNodeSchema.parse({
        id: chapter.id,
        type: "chapter",
        title,
        parentId,
        order: nextOrder(parentId),
        createdAt: now,
        updatedAt: now,
      })
    );
    orders.set(parentId, nextOrder(parentId) + 1);
    options.onProgress?.({
      phase: "chapters",
      done: index + 1,
      total: sections.length,
      title,
    });
  }

  const outline: Outline = { nodes };
  await saveOutline(root, workId, outline);
  await loadChapterMetas(
    root,
    workId,
    (progress) => {
      options.onProgress?.({
        phase: "index",
        done: progress.done,
        total: progress.total,
        title: progress.title,
      });
    },
    true
  );
  log.info("structured import saved", { workId, sections: sections.length });
  return outline;
}

/** 按扩展名选择切分规则；不支持的类型会抛出可本地化的错误码。 */
export function parseImportText(
  path: string,
  text: string,
  options: ImportParseOptions = {}
): ParsedImport {
  const format = importFormat(path);
  const blocks =
    format === "md" ? markdownBlocks(text, options) : txtBlocks(text, options);
  const cards = cardsFromBlocks(blocks);
  if (!cards.length) throw new ImportFileError("empty");
  const grouped = sectionsFromBlocks(blocks, options);
  const structured =
    grouped.sections.length > 1 ||
    grouped.sections.some((section) => section.title || section.volumeTitle) ||
    grouped.volumePrefaces.size > 0;
  const sections = structured ? grouped.sections : flatSections(cards);
  const synopsis = structured ? grouped.frontMatter.join("\n\n") : "";
  const volumes = structured
    ? Array.from(grouped.volumePrefaces.entries()).map(([title, preface]) => ({
        title,
        preface: preface.join("\n\n"),
      }))
    : [];
  return {
    format,
    cards,
    sections,
    synopsis,
    volumes,
  };
}

/**
 * 兼容旧调用：按 txt 规则把纯文本切成卡片。
 *
 * 新导入流程应使用 `parseImportText`，避免 Markdown 被套用 txt 规则。
 */
export function textToCards(text: string): Card[] {
  return cardsFromBlocks(txtBlocks(text));
}
