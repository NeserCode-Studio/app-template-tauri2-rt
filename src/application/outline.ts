import { z } from "zod";

import { AppError } from "./errors";
import { requireRoot, requireWorkId } from "./helpers";
import { defineAppCommand } from "./types";
import {
  addNode,
  loadOutline,
  moveNode,
  reconcileChapterIds,
  removeNode,
  updateNode,
} from "@/services/outline";
import {
  createChapter as createChapterFile,
  deleteChapter,
  removeChapterIndexEntries,
} from "@/services/chapter";
import { chapterFile, chapterTextFile } from "@/services/paths";
import { moveToTrash } from "@/services/trash";
import { loadWork } from "@/services/workspace";
import type { OutlineNode } from "@/shared/schema";

const nodeStatus = z.enum(["draft", "revising", "final"]);

const outlineGet = defineAppCommand({
  id: "novels_outline_get",
  title: "Get outline",
  description:
    "Return the complete flat outline with stable parent and order fields.",
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
    const outline = await loadOutline(root, workId);
    return {
      work_id: workId,
      nodes: [...outline.nodes].sort(
        (a, b) =>
          (a.parentId ?? "").localeCompare(b.parentId ?? "") ||
          a.order - b.order
      ),
    };
  },
});

const volumeCreate = defineAppCommand({
  id: "novels_volume_create",
  title: "Create volume",
  description: "Create a top-level volume with an optional preface.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      title: z.string().trim().min(1).max(200),
      preface: z.string().max(100_000).default(""),
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
    const outline = await addNode(root, workId, {
      type: "volume",
      title: input.title,
      parentId: null,
      preface: input.preface,
    });
    return { outline };
  },
});

const chapterCreate = defineAppCommand({
  id: "novels_chapter_create",
  title: "Create chapter",
  description:
    "Create a chapter file and its outline node with the same ID. parent_id must reference a volume or be null.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      title: z.string().trim().min(1).max(200),
      parent_id: z.string().uuid().nullable().default(null),
      status: nodeStatus.default("draft"),
      synopsis: z.string().max(10_000).default(""),
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
    const outline = await loadOutline(root, workId);
    if (
      input.parent_id &&
      !outline.nodes.some(
        (node) => node.id === input.parent_id && node.type === "volume"
      )
    ) {
      throw new AppError(
        "invalid_argument",
        "parent_id must reference an existing volume in this work."
      );
    }
    const chapter = await createChapterFile(root, workId, input.title);
    try {
      const next = await addNode(root, workId, {
        id: chapter.id,
        type: "chapter",
        title: input.title,
        parentId: input.parent_id,
        status: input.status,
        synopsis: input.synopsis,
      });
      return { chapter, outline: next };
    } catch (err) {
      await deleteChapter(root, workId, chapter.id).catch(() => undefined);
      throw err;
    }
  },
});

const sceneCreate = defineAppCommand({
  id: "novels_scene_create",
  title: "Create scene",
  description:
    "Create a scene node under an existing chapter or scene. Scenes are structural notes, not chapter files.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      title: z.string().trim().min(1).max(200),
      parent_id: z.string().uuid(),
      synopsis: z.string().max(10_000).default(""),
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
    const outline = await loadOutline(root, workId);
    const parent = outline.nodes.find((node) => node.id === input.parent_id);
    if (!parent || parent.type === "volume") {
      throw new AppError(
        "invalid_argument",
        "parent_id must reference a chapter or scene."
      );
    }
    return {
      outline: await addNode(root, workId, {
        type: "scene",
        title: input.title,
        parentId: input.parent_id,
        synopsis: input.synopsis,
      }),
    };
  },
});

const nodeUpdate = defineAppCommand({
  id: "novels_node_update",
  title: "Update outline node",
  description:
    "Update a node title, status, synopsis, plot summary, preface or collapsed state. expected_updated_at rejects stale writes.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      node_id: z.string().uuid(),
      expected_updated_at: z.number().int().nonnegative().optional(),
      title: z.string().trim().min(1).max(200).optional(),
      status: nodeStatus.optional(),
      synopsis: z.string().max(10_000).optional(),
      plot_summary: z.string().max(100_000).optional(),
      preface: z.string().max(100_000).optional(),
      collapsed: z.boolean().optional(),
    })
    .strict()
    .refine(
      (value) =>
        value.title !== undefined ||
        value.status !== undefined ||
        value.synopsis !== undefined ||
        value.plot_summary !== undefined ||
        value.preface !== undefined ||
        value.collapsed !== undefined,
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
    const outline = await loadOutline(root, workId);
    const node = outline.nodes.find((item) => item.id === input.node_id);
    if (!node) {
      throw new AppError("not_found", "The outline node was not found.");
    }
    if (
      input.expected_updated_at !== undefined &&
      node.updatedAt !== input.expected_updated_at
    ) {
      throw new AppError(
        "revision_conflict",
        "The outline node changed. Reload it before writing.",
        { current_updated_at: node.updatedAt }
      );
    }
    return {
      outline: await updateNode(root, workId, input.node_id, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.synopsis !== undefined ? { synopsis: input.synopsis } : {}),
        ...(input.plot_summary !== undefined
          ? { plotSummary: input.plot_summary }
          : {}),
        ...(input.preface !== undefined ? { preface: input.preface } : {}),
        ...(input.collapsed !== undefined
          ? { collapsed: input.collapsed }
          : {}),
      }),
    };
  },
});

const nodeMove = defineAppCommand({
  id: "novels_node_move",
  title: "Move outline node",
  description:
    "Move a node to a parent and zero-based index, renumbering affected siblings.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      node_id: z.string().uuid(),
      target_parent_id: z.string().uuid().nullable(),
      target_index: z.number().int().nonnegative(),
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
    return {
      outline: await moveNode(
        root,
        workId,
        input.node_id,
        input.target_parent_id,
        input.target_index
      ),
    };
  },
});

function trashNodeShape(node: OutlineNode) {
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    parentId: node.parentId,
    order: node.order,
    status: node.status,
    synopsis: node.synopsis,
    preface: node.preface,
    plotSummary: node.plotSummary,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

const nodeDelete = defineAppCommand({
  id: "novels_node_delete",
  title: "Delete outline node",
  description:
    "Move a chapter or volume subtree to trash and remove its outline nodes. Scene deletion is not supported.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      node_id: z.string().uuid(),
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
    const outline = await loadOutline(root, workId);
    const node = outline.nodes.find((item) => item.id === input.node_id);
    if (!node)
      throw new AppError("not_found", "The outline node was not found.");
    if (node.type === "scene") {
      throw new AppError(
        "invalid_argument",
        "Scene deletion is not supported because scenes have no trash lifecycle."
      );
    }

    const removedIds = new Set([node.id]);
    if (node.type === "volume") {
      let changed = true;
      while (changed) {
        changed = false;
        for (const item of outline.nodes) {
          if (
            item.parentId &&
            removedIds.has(item.parentId) &&
            !removedIds.has(item.id)
          ) {
            removedIds.add(item.id);
            changed = true;
          }
        }
      }
    }
    const subtree = outline.nodes.filter((item) => removedIds.has(item.id));
    const chapterIds = subtree
      .filter((item) => item.type === "chapter")
      .map((item) => item.id);
    const work = await loadWork(root, workId);
    const parent =
      node.type === "chapter"
        ? outline.nodes.find((item) => item.id === node.parentId)
        : null;
    await moveToTrash(root, {
      kind: node.type,
      originId: node.id,
      workId,
      paths: chapterIds.flatMap((id) => [
        chapterFile(workId, id),
        chapterTextFile(workId, id),
      ]),
      title: node.title,
      sourceTitle: [work.title, parent?.type === "volume" ? parent.title : ""]
        .filter(Boolean)
        .join(" / "),
      preview: node.preface || node.synopsis || node.plotSummary || "",
      modifiedAt: Math.max(
        node.updatedAt,
        ...subtree.map((item) => item.updatedAt)
      ),
      parentId: node.parentId,
      order: node.order,
      node: trashNodeShape(node),
      subtree: subtree.map(trashNodeShape),
    });
    await removeChapterIndexEntries(root, workId, chapterIds);
    return { outline: await removeNode(root, workId, node.id) };
  },
});

const outlineReconcile = defineAppCommand({
  id: "novels_outline_reconcile",
  title: "Reconcile outline",
  description:
    "Repair historical chapter ID mismatches between the outline and chapter files.",
  input: z.object({ work_id: z.string().uuid().optional() }).strict(),
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
    const outline = await loadOutline(root, workId);
    return {
      outline: await reconcileChapterIds(root, workId, outline),
    };
  },
});

export const OUTLINE_COMMANDS = [
  outlineGet,
  volumeCreate,
  chapterCreate,
  sceneCreate,
  nodeUpdate,
  nodeMove,
  nodeDelete,
  outlineReconcile,
] as const;
