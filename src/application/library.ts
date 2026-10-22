import { z } from "zod";

import { pageItems, requireRoot, requireWorkId } from "./helpers";
import { getApplicationHost } from "./host";
import { defineAppCommand } from "./types";
import {
  archiveWork,
  createWork,
  deleteWork,
  loadWork,
  loadWorkspace,
  saveWork,
  unarchiveWork,
} from "@/services/workspace";
import { loadOutline } from "@/services/outline";
import { loadStats } from "@/services/stats";
import { reparagraphWork } from "@/services/chapter";

const workList = defineAppCommand({
  id: "novels_work_list",
  title: "List works",
  description:
    "List active and archived works in deterministic manifest order with pagination.",
  input: z
    .object({
      status: z.enum(["all", "active", "archived"]).default("all"),
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
    const workspace = await loadWorkspace(root);
    const ids =
      input.status === "active"
        ? workspace.order
        : input.status === "archived"
          ? workspace.archived
          : [...workspace.order, ...workspace.archived];
    const works = [];
    for (const id of ids) {
      try {
        const work = await loadWork(root, id);
        works.push({
          ...work,
          archived: workspace.archived.includes(id),
        });
      } catch {
        // A broken work is reported through workspace_scan, not silently listed.
      }
    }
    return {
      workspace_alias: workspace.alias,
      current_work_id: context.workId,
      ...pageItems(works, input.limit, input.offset),
    };
  },
});

const workGet = defineAppCommand({
  id: "novels_work_get",
  title: "Get work",
  description:
    "Return one work's metadata, outline counts and recorded word counts.",
  input: z.object({ work_id: z.string().uuid().optional() }).strict(),
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
    const [work, outline, stats] = await Promise.all([
      loadWork(root, workId),
      loadOutline(root, workId),
      loadStats(root, workId),
    ]);
    return {
      work,
      counts: {
        volumes: outline.nodes.filter((node) => node.type === "volume").length,
        chapters: outline.nodes.filter((node) => node.type === "chapter")
          .length,
        scenes: outline.nodes.filter((node) => node.type === "scene").length,
        words: stats.workWords[workId] ?? 0,
      },
    };
  },
});

const workSelect = defineAppCommand({
  id: "novels_work_select",
  title: "Select work",
  description:
    "Set the active work in the application without changing the workspace or opening a chapter.",
  input: z.object({ work_id: z.string().uuid() }).strict(),
  permission: "write",
  risk: "R1",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(input, context) {
    const root = requireRoot(context);
    await loadWork(root, input.work_id);
    await getApplicationHost().selectWork(input.work_id);
    return { selected_work_id: input.work_id };
  },
});

const workCreate = defineAppCommand({
  id: "novels_work_create",
  title: "Create work",
  description:
    "Create a work with title, type, synopsis and paragraph preference, then select it.",
  input: z
    .object({
      title: z.string().trim().min(1).max(200),
      type: z.string().max(100).default(""),
      synopsis: z.string().max(50_000).default(""),
      auto_paragraph: z.boolean().default(true),
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
    const workspace = await loadWorkspace(root);
    const result = await createWork(
      root,
      workspace,
      input.title,
      input.type,
      input.synopsis,
      input.auto_paragraph
    );
    await getApplicationHost().selectWork(result.work.id);
    return { work: result.work, workspace: result.ws };
  },
});

const workUpdate = defineAppCommand({
  id: "novels_work_update",
  title: "Update work",
  description:
    "Update work title, type, synopsis or the default paragraph preference.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      title: z.string().trim().min(1).max(200).optional(),
      type: z.string().max(100).optional(),
      synopsis: z.string().max(50_000).optional(),
      auto_paragraph: z.boolean().optional(),
    })
    .strict()
    .refine(
      (value) =>
        value.title !== undefined ||
        value.type !== undefined ||
        value.synopsis !== undefined ||
        value.auto_paragraph !== undefined,
      "At least one update field is required."
    ),
  permission: "write",
  risk: "R1",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(input, context) {
    const root = requireRoot(context);
    const workId = requireWorkId(context, input.work_id);
    const current = await loadWork(root, workId);
    const saved = await saveWork(root, {
      ...current,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.synopsis !== undefined ? { synopsis: input.synopsis } : {}),
      ...(input.auto_paragraph !== undefined
        ? { autoParagraph: input.auto_paragraph }
        : {}),
    });
    return { work: saved };
  },
});

function workArchiveCommand(
  id: "novels_work_archive" | "novels_work_unarchive",
  title: string,
  description: string,
  archived: boolean
) {
  return defineAppCommand({
    id,
    title,
    description,
    input: z.object({ work_id: z.string().uuid().optional() }).strict(),
    permission: "write" as const,
    risk: "R1" as const,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(input, context) {
      const root = requireRoot(context);
      const workId = requireWorkId(context, input.work_id);
      const workspace = await loadWorkspace(root);
      const next = archived
        ? await archiveWork(root, workspace, workId)
        : await unarchiveWork(root, workspace, workId);
      return { work_id: workId, archived, workspace: next };
    },
  });
}

const workArchive = workArchiveCommand(
  "novels_work_archive",
  "Archive work",
  "Move a work to the archived section and persist its archived flag.",
  true
);

const workUnarchive = workArchiveCommand(
  "novels_work_unarchive",
  "Unarchive work",
  "Restore an archived work to the active section.",
  false
);

const workDelete = defineAppCommand({
  id: "novels_work_delete",
  title: "Delete work",
  description:
    "Move an entire work to the workspace trash and remove it from the manifest. It can be restored from trash.",
  input: z.object({ work_id: z.string().uuid().optional() }).strict(),
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
    const [workspace, work] = await Promise.all([
      loadWorkspace(root),
      loadWork(root, workId),
    ]);
    const next = await deleteWork(root, workspace, workId, work.title, {
      preview: work.synopsis,
      modifiedAt: work.updatedAt,
    });
    return { deleted_work_id: workId, workspace: next };
  },
});

const workReparagraph = defineAppCommand({
  id: "novels_work_reparagraph",
  title: "Reparagraph work",
  description:
    "Rebuild paragraphs for every readable chapter in a work while preserving chapter history.",
  input: z.object({ work_id: z.string().uuid().optional() }).strict(),
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
    return reparagraphWork(root, workId, (progress) => {
      context.progress.report({
        progress: progress.done,
        total: progress.total,
        message: progress.title || progress.chapterId,
      });
    });
  },
});

export const LIBRARY_COMMANDS = [
  workList,
  workGet,
  workSelect,
  workCreate,
  workUpdate,
  workArchive,
  workUnarchive,
  workDelete,
  workReparagraph,
] as const;
