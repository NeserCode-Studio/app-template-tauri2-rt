/**
 * 导出服务：把章 / 全书拼成纯文本写到工作区之外。
 *
 * 格式选项按计划书 §M8：是否含章节标题行、是否插入分卷标题、
 * 段首缩进、换行用 LF 还是 CRLF、章标题格式。
 *
 * 换行风格在此处显式拼接而非交给平台：Windows 记事本对裸 LF 的
 * 显示 historically 不友好，而用户导出到别的系统时又可能相反。
 * 做成显式选项，比依赖操作系统默认可靠。
 */

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

import { createFs, joinRel } from "./fs";
import { cardsToText } from "./chapter";
import { loadOutline } from "./outline";
import { loadWork } from "./workspace";
import { chapterSchema, type OutlineNode } from "@/shared/schema";
import { createLogger } from "@/lib/logger";

const log = createLogger("ExportService");

export interface ExportOptions {
  /** 导出文件格式。 */
  format: "txt" | "md";
  /** 是否输出章节标题行。 */
  includeChapterTitle: boolean;
  /** 是否输出卷标题行。 */
  includeVolumeTitle: boolean;
  /** 段首是否插入全角空格缩进（两个）。 */
  indentParagraph: boolean;
  /** 换行风格。 */
  newline: "lf" | "crlf";
  /** 章标题的排版格式。 */
  titleFormat: "plain" | "bracket" | "hash";
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: "txt",
  includeChapterTitle: true,
  includeVolumeTitle: true,
  indentParagraph: true,
  newline: "crlf",
  titleFormat: "plain",
};

/** 章标题按所选格式渲染。 */
function formatTitle(
  title: string,
  format: ExportOptions["titleFormat"],
  markdownLevel?: number
): string {
  const name = title.trim();
  if (markdownLevel) return `${"#".repeat(markdownLevel)} ${name}`;
  switch (format) {
    case "bracket":
      return `\u300a${name}\u300b`;
    case "hash":
      return `## ${name}`;
    default:
      return name;
  }
}

/** 章正文：每张卡片一行，按需加段首缩进。 */
function formatBody(text: string, opts: ExportOptions): string {
  const lines = text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  if (opts.format === "md") return lines.join("\n\n");
  return lines
    .map((l) => (opts.indentParagraph ? `\u3000\u3000${l}` : l))
    .join("\n");
}

/**
 * 组装导出文本。
 *
 * 章按 outline 的 `order` 升序，而不是文件名——文件名是 uuid，
 * 顺序信息只在结构树里。
 */
export async function buildExportText(
  root: string,
  workId: string,
  opts: ExportOptions,
  /** 限定导出单章时传入章 id。 */
  onlyChapterId?: string
): Promise<string> {
  const [outline, work] = await Promise.all([
    loadOutline(root, workId),
    loadWork(root, workId),
  ]);
  const nl = opts.newline === "crlf" ? "\r\n" : "\n";
  const fs2 = createFs(root);

  let chapters = outline.nodes
    .filter((n) => n.type === "chapter")
    .sort((a, b) => a.order - b.order);
  if (onlyChapterId) chapters = chapters.filter((n) => n.id === onlyChapterId);

  /* 卷标题：只在该卷第一章之前输出一次。 */
  const volumeTitleFor = (node: OutlineNode): OutlineNode | null => {
    if (!opts.includeVolumeTitle || !node.parentId) return null;
    const vol = outline.nodes.find(
      (n) => n.id === node.parentId && n.type === "volume"
    );
    return vol ?? null;
  };
  let lastVolume: string | null = null;

  const blocks: string[] = [];
  if (opts.format === "md") {
    blocks.push(formatTitle(work.title, opts.titleFormat, 1));
  }
  for (const node of chapters) {
    const raw = await fs2
      .readText(joinRel("works", workId, "chapters", node.id + ".json"))
      .catch(() => null);
    if (raw === null) {
      log.warn("export: chapter unreadable, skipped", node.id);
      continue;
    }
    const parsed = chapterSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      log.warn("export: chapter bad data, skipped", node.id);
      continue;
    }

    const vol = volumeTitleFor(node);
    if (vol && vol.title.trim() !== lastVolume) {
      blocks.push(
        opts.format === "md"
          ? formatTitle(vol.title, opts.titleFormat, 2)
          : vol.title.trim()
      );
      const preface = vol.preface.trim();
      if (preface) blocks.push(formatBody(preface, opts));
      lastVolume = vol.title.trim();
    }
    if (opts.includeChapterTitle || opts.format === "md") {
      blocks.push(
        opts.format === "md"
          ? formatTitle(node.title, opts.titleFormat, 3)
          : formatTitle(node.title, opts.titleFormat)
      );
    }
    const body = formatBody(cardsToText(parsed.data.cards), opts);
    if (body) blocks.push(body);
  }

  /* 块间空一行：段间留白符合中文长篇阅读习惯。 */
  return blocks.join(nl.repeat(2)) + (blocks.length ? nl : "");
}

/**
 * 弹出保存对话框并写入。
 * @returns 写入的路径；用户取消时返回 null。
 */
export async function exportToFile(
  root: string,
  workId: string,
  defaultName: string,
  opts: ExportOptions,
  onlyChapterId?: string
): Promise<string | null> {
  const text = await buildExportText(root, workId, opts, onlyChapterId);
  const extension = opts.format === "md" ? "md" : "txt";
  const target = await save({
    title: defaultName,
    defaultPath: `${defaultName}.${extension}`,
    filters: [
      {
        name: opts.format === "md" ? "Markdown" : "Text",
        extensions: [extension],
      },
    ],
  });
  if (!target) return null;
  await invoke("fs_write_export", { path: target, content: text });
  log.info("export written", { path: target, chars: text.length });
  return target;
}
