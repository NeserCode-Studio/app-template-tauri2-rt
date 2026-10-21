import { z } from "zod";

import { AppError } from "./errors";
import { requireRoot, requireWorkId } from "./helpers";
import { saveChapterCommand } from "./chapter";
import { defineAppCommand } from "./types";
import {
  importFileName,
  importTitleFromPath,
  parseImportText,
  readTextAuto,
  saveImportSections,
  type ParsedImport,
} from "@/services/import";
import {
  buildExportText,
  DEFAULT_EXPORT_OPTIONS,
  exportToFile,
  type ExportOptions,
} from "@/services/export";
import { createWork, loadWorkspace, saveWork } from "@/services/workspace";
import { loadChapter } from "@/services/chapter";

const PREVIEW_TTL_MS = 10 * 60 * 1000;

interface StoredImportPreview {
  expiresAt: number;
  path: string;
  fileName: string;
  title: string;
  parsed: ParsedImport;
}

const previews = new Map<string, StoredImportPreview>();

function prunePreviews(): void {
  const now = Date.now();
  for (const [id, preview] of previews) {
    if (preview.expiresAt <= now) previews.delete(id);
  }
}

const exportOptionsSchema = z
  .object({
    include_chapter_title: z.boolean().default(true),
    include_volume_title: z.boolean().default(true),
    indent_paragraph: z.boolean().default(true),
    newline: z.enum(["lf", "crlf"]).default("crlf"),
    title_format: z.enum(["plain", "bracket", "hash"]).default("plain"),
  })
  .strict();

function exportOptions(input: z.infer<typeof exportOptionsSchema>): ExportOptions {
  return {
    includeChapterTitle: input.include_chapter_title,
    includeVolumeTitle: input.include_volume_title,
    indentParagraph: input.indent_paragraph,
    newline: input.newline,
    titleFormat: input.title_format,
  };
}

const importPreview = defineAppCommand({
  id: "novels_import_preview",
  title: "Preview novel import",
  description:
    "Read a user-approved txt or md file and parse volume, chapter and preface structure without writing workspace data.",
  input: z
    .object({
      path: z.string().min(1).max(4096),
      strip_section_numbers: z.boolean().default(false),
      auto_paragraph: z.boolean().default(true),
    })
    .strict(),
  permission: "write",
  risk: "R1",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async execute(input) {
    prunePreviews();
    const decoded = await readTextAuto(input.path);
    const parsed = parseImportText(input.path, decoded.content, {
      stripSectionNumbers: input.strip_section_numbers,
      autoParagraph: input.auto_paragraph,
    });
    const id = crypto.randomUUID();
    const title = importTitleFromPath(input.path);
    previews.set(id, {
      expiresAt: Date.now() + PREVIEW_TTL_MS,
      path: input.path,
      fileName: importFileName(input.path),
      title,
      parsed,
    });
    return {
      preview_id: id,
      expires_at: Date.now() + PREVIEW_TTL_MS,
      title,
      format: parsed.format,
      encoding: decoded.encoding,
      had_bom: decoded.hadBom,
      synopsis: parsed.synopsis,
      card_count: parsed.cards.length,
      section_count: parsed.sections.length,
      volumes: parsed.volumes,
      sections: parsed.sections.map((section) => ({
        title: section.title,
        volume_title: section.volumeTitle,
        card_count: section.cards.length,
        preview: section.cards
          .slice(0, 2)
          .map((card) => card.text.slice(0, 240))
          .join("\n"),
      })),
    };
  },
});

const importCommit = defineAppCommand({
  id: "novels_import_commit",
  title: "Commit novel import",
  description:
    "Commit a one-time import preview into a new work or append it to an existing chapter.",
  input: z
    .object({
      preview_id: z.string().uuid(),
      target: z.enum(["work", "chapter"]),
      work_id: z.string().uuid().optional(),
      chapter_id: z.string().uuid().optional(),
      expected_revision: z.number().int().nonnegative().optional(),
      title: z.string().trim().min(1).max(200).optional(),
      synopsis: z.string().max(50_000).optional(),
      auto_paragraph: z.boolean().default(true),
    })
    .strict(),
  permission: "write",
  risk: "R2",
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  async execute(input, context) {
    const root = requireRoot(context);
    prunePreviews();
    const preview = previews.get(input.preview_id);
    if (!preview) {
      throw new AppError(
        "not_found",
        "The import preview expired or was already committed."
      );
    }

    if (input.target === "chapter") {
      const workId = requireWorkId(context, input.work_id);
      if (!input.chapter_id || input.expected_revision === undefined) {
        throw new AppError(
          "invalid_argument",
          "chapter target requires chapter_id and expected_revision."
        );
      }
      const chapter = await loadChapter(root, workId, input.chapter_id);
      if (!chapter) {
        throw new AppError("not_found", "The target chapter was not found.");
      }
      previews.delete(input.preview_id);
      return saveChapterCommand({
        root,
        workId,
        chapter,
        cards: [...chapter.cards, ...preview.parsed.cards],
        expectedRevision: input.expected_revision,
        source: "mcp",
      });
    }

    const workspace = await loadWorkspace(root);
    const title = input.title ?? preview.title;
    const created = await createWork(
      root,
      workspace,
      title,
      "",
      input.synopsis ?? preview.parsed.synopsis,
      input.auto_paragraph
    );
    await saveWork(root, {
      ...created.work,
      synopsis: input.synopsis ?? preview.parsed.synopsis,
      autoParagraph: input.auto_paragraph,
    });
    const outline = await saveImportSections(
      root,
      created.work.id,
      preview.parsed.sections,
      { front: "Front matter", untitled: "Untitled" },
      {
        volumes: preview.parsed.volumes,
        onProgress: (progress) => {
          context.progress.report({
            progress: progress.done,
            total: progress.total,
            message: progress.title,
          });
        },
      }
    );
    previews.delete(input.preview_id);
    return {
      work_id: created.work.id,
      title,
      sections: preview.parsed.sections.length,
      cards: preview.parsed.cards.length,
      outline,
    };
  },
});

const exportText = defineAppCommand({
  id: "novels_export_text",
  title: "Export work as text",
  description:
    "Build export text using validated formatting options. Large results are truncated by the MCP result layer.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      chapter_id: z.string().uuid().optional(),
      options: exportOptionsSchema.default(DEFAULT_EXPORT_OPTIONS),
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
    const text = await buildExportText(
      root,
      workId,
      exportOptions(input.options),
      input.chapter_id
    );
    return {
      text,
      chars: text.length,
      work_id: workId,
      chapter_id: input.chapter_id ?? null,
    };
  },
});

const exportFile = defineAppCommand({
  id: "novels_export_file",
  title: "Export work to file",
  description:
    "Open the application save dialog and write the selected work or chapter to a text file.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      chapter_id: z.string().uuid().optional(),
      default_name: z.string().trim().min(1).max(200).default("novel"),
      options: exportOptionsSchema.default(DEFAULT_EXPORT_OPTIONS),
    })
    .strict(),
  permission: "write",
  risk: "R2",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  async execute(input, context) {
    const root = requireRoot(context);
    const workId = requireWorkId(context, input.work_id);
    const path = await exportToFile(
      root,
      workId,
      input.default_name,
      exportOptions(input.options),
      input.chapter_id
    );
    return path
      ? { exported: true, file_name: path.split(/[\\/]/).pop() ?? "export.txt" }
      : { exported: false, cancelled: true };
  },
});

export const IMPORT_EXPORT_COMMANDS = [
  importPreview,
  importCommit,
  exportText,
  exportFile,
] as const;
