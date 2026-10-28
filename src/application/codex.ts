import { z } from "zod";

import { AppError } from "./errors";
import { pageItems, requireRoot } from "./helpers";
import { defineAppCommand } from "./types";
import {
  addRelation,
  createEntry,
  loadEntries,
  loadEntry,
  loadMentions,
  loadRelations,
  loadTypes,
  removeEntry,
  removeRelation,
  saveEntry,
  saveTypes,
  scanWorkspaceMentions,
} from "@/services/codex";
import {
  entrySchema,
  fieldValueSchema,
  scopeSchema,
  typeConfigSchema,
  type TypeConfig,
} from "@/services/codex/types";

const typeCreate = defineAppCommand({
  id: "novels_codex_type_create",
  title: "Create Codex type",
  description:
    "Create a custom Codex type with label, colors, field templates and relation vocabulary.",
  input: z
    .object({
      label: z.string().trim().min(1).max(100),
      icon: z.string().max(100).optional(),
      color: z
        .object({
          light: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          dark: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        })
        .optional(),
      fields: typeConfigSchema.shape.fields.default([]),
      relation_vocab: typeConfigSchema.shape.relationVocab.default([]),
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
    const types = await loadTypes(root);
    const type: TypeConfig = typeConfigSchema.parse({
      id: `custom-${crypto.randomUUID().slice(0, 8)}`,
      label: input.label,
      icon: input.icon ?? "shapes",
      color: input.color ?? { light: "#64748b", dark: "#cbd5e1" },
      fields: input.fields,
      relationVocab: input.relation_vocab,
      builtin: false,
      order: types.reduce((max, item) => Math.max(max, item.order), -1) + 1,
    });
    await saveTypes(root, [...types, type]);
    return { type };
  },
});

const typeList = defineAppCommand({
  id: "novels_codex_type_list",
  title: "List Codex types",
  description:
    "List all built-in and custom Codex type configurations and field templates.",
  input: z.object({}).strict(),
  permission: "read",
  risk: "R0",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(_input, context) {
    const root = requireRoot(context);
    return { items: await loadTypes(root) };
  },
});

const typeUpdate = defineAppCommand({
  id: "novels_codex_type_update",
  title: "Update Codex type",
  description:
    "Replace one Codex type configuration after validating the full type schema.",
  input: z.object({ type: typeConfigSchema }).strict(),
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
    const types = await loadTypes(root);
    if (!types.some((type) => type.id === input.type.id)) {
      throw new AppError("not_found", "The Codex type was not found.");
    }
    const next = types
      .map((type) => (type.id === input.type.id ? input.type : type))
      .sort((a, b) => a.order - b.order);
    await saveTypes(root, next);
    return { type: input.type };
  },
});

const typeDelete = defineAppCommand({
  id: "novels_codex_type_delete",
  title: "Delete Codex type",
  description:
    "Delete a non-built-in Codex type only when no entries use it.",
  input: z.object({ type_id: z.string().min(1) }).strict(),
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
    const [types, entries] = await Promise.all([
      loadTypes(root),
      loadEntries(root),
    ]);
    const type = types.find((item) => item.id === input.type_id);
    if (!type) throw new AppError("not_found", "The Codex type was not found.");
    if (type.builtin) {
      throw new AppError(
        "invalid_argument",
        "Built-in Codex types cannot be deleted."
      );
    }
    const usage = entries.filter((entry) => entry.typeId === input.type_id);
    if (usage.length) {
      throw new AppError(
        "invalid_argument",
        "The Codex type is still used by entries. Move or delete those entries first.",
        { entry_count: usage.length }
      );
    }
    await saveTypes(
      root,
      types.filter((item) => item.id !== input.type_id)
    );
    return { deleted_type_id: input.type_id };
  },
});

const entryList = defineAppCommand({
  id: "novels_codex_entry_list",
  title: "List Codex entries",
  description:
    "Filter Codex entries by type, scope and text query, with deterministic pagination.",
  input: z
    .object({
      type_id: z.string().optional(),
      scope: z.enum(["all", "workspace", "works"]).default("all"),
      query: z.string().max(500).default(""),
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
    const query = input.query.trim().toLowerCase();
    const entries = (await loadEntries(root)).filter((entry) => {
      if (input.type_id && entry.typeId !== input.type_id) return false;
      if (input.scope !== "all" && entry.scope.kind !== input.scope) return false;
      if (!query) return true;
      return [
        entry.name,
        entry.summary,
        entry.body,
        ...entry.aliases,
        ...entry.tags,
      ]
        .join("\n")
        .toLowerCase()
        .includes(query);
    });
    return pageItems(entries, input.limit, input.offset);
  },
});

const entryGet = defineAppCommand({
  id: "novels_codex_entry_get",
  title: "Get Codex entry",
  description:
    "Return a Codex entry with its relations and mention records.",
  input: z.object({ entry_id: z.string().uuid() }).strict(),
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
    const [entry, relations, mentions] = await Promise.all([
      loadEntry(root, input.entry_id),
      loadRelations(root),
      loadMentions(root),
    ]);
    if (!entry) {
      throw new AppError("not_found", "The Codex entry was not found.");
    }
    return {
      entry,
      relations: relations.filter(
        (relation) =>
          relation.fromId === input.entry_id ||
          relation.toId === input.entry_id
      ),
      mentions: mentions[input.entry_id] ?? [],
    };
  },
});

const entryCreate = defineAppCommand({
  id: "novels_codex_entry_create",
  title: "Create Codex entry",
  description:
    "Create a Codex entry with aliases, tags, summary, body, typed fields and scope.",
  input: z
    .object({
      type_id: z.string().min(1),
      name: z.string().trim().min(1).max(200),
      aliases: z.array(z.string().trim().min(1).max(200)).default([]),
      tags: z.array(z.string().trim().min(1).max(100)).default([]),
      summary: z.string().max(10_000).default(""),
      body: z.string().max(200_000).default(""),
      fields: z.record(z.string(), fieldValueSchema).default({}),
      scope: scopeSchema.default({ kind: "workspace" }),
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
    const types = await loadTypes(root);
    if (!types.some((type) => type.id === input.type_id)) {
      throw new AppError("invalid_argument", "type_id is not a known Codex type.");
    }
    const created = await createEntry(root, input.type_id, input.name);
    const saved = await saveEntry(root, {
      ...created,
      aliases: input.aliases,
      tags: input.tags,
      summary: input.summary,
      body: input.body,
      fields: input.fields,
      scope: input.scope,
    });
    return { entry: saved };
  },
});

const entryUpdate = defineAppCommand({
  id: "novels_codex_entry_update",
  title: "Update Codex entry",
  description:
    "Update selected fields on a Codex entry, including type, aliases, tags, body, typed fields and scope.",
  input: z
    .object({
      entry_id: z.string().uuid(),
      expected_updated_at: z.number().int().nonnegative().optional(),
      type_id: z.string().min(1).optional(),
      name: z.string().trim().min(1).max(200).optional(),
      aliases: z.array(z.string().trim().min(1).max(200)).optional(),
      tags: z.array(z.string().trim().min(1).max(100)).optional(),
      summary: z.string().max(10_000).optional(),
      body: z.string().max(200_000).optional(),
      fields: z.record(z.string(), fieldValueSchema).optional(),
      scope: scopeSchema.optional(),
    })
    .strict(),
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
    const entry = await loadEntry(root, input.entry_id);
    if (!entry) {
      throw new AppError("not_found", "The Codex entry was not found.");
    }
    if (
      input.expected_updated_at !== undefined &&
      entry.updatedAt !== input.expected_updated_at
    ) {
      throw new AppError(
        "revision_conflict",
        "The Codex entry changed. Reload it before writing.",
        { current_updated_at: entry.updatedAt }
      );
    }
    const saved = await saveEntry(
      root,
      entrySchema.parse({
        ...entry,
        ...(input.type_id !== undefined ? { typeId: input.type_id } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.aliases !== undefined ? { aliases: input.aliases } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.fields !== undefined ? { fields: input.fields } : {}),
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
      })
    );
    return { entry: saved };
  },
});

const entryDelete = defineAppCommand({
  id: "novels_codex_entry_delete",
  title: "Delete Codex entry",
  description:
    "Delete a Codex entry and remove its relations and mention index.",
  input: z.object({ entry_id: z.string().uuid() }).strict(),
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
    const entry = await loadEntry(root, input.entry_id);
    if (!entry) {
      throw new AppError("not_found", "The Codex entry was not found.");
    }
    await removeEntry(root, input.entry_id);
    return { deleted_entry_id: input.entry_id, name: entry.name };
  },
});

const relationList = defineAppCommand({
  id: "novels_codex_relation_list",
  title: "List Codex relations",
  description:
    "List all relations or only those touching one Codex entry.",
  input: z
    .object({ entry_id: z.string().uuid().optional() })
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
    const relations = await loadRelations(root);
    return {
      items: input.entry_id
        ? relations.filter(
            (relation) =>
              relation.fromId === input.entry_id ||
              relation.toId === input.entry_id
          )
        : relations,
    };
  },
});

const relationAdd = defineAppCommand({
  id: "novels_codex_relation_add",
  title: "Add Codex relation",
  description:
    "Create or replace the directed relation between two Codex entries.",
  input: z
    .object({
      from_id: z.string().uuid(),
      to_id: z.string().uuid(),
      kind: z.string().trim().min(1).max(100),
      inverse_kind: z.string().trim().min(1).max(100),
      note: z.string().max(10_000).optional(),
    })
    .strict(),
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
    if (input.from_id === input.to_id) {
      throw new AppError(
        "invalid_argument",
        "A Codex relation cannot point from an entry to itself."
      );
    }
    const [from, to] = await Promise.all([
      loadEntry(root, input.from_id),
      loadEntry(root, input.to_id),
    ]);
    if (!from || !to) {
      throw new AppError("not_found", "Both relation endpoints must exist.");
    }
    return {
      relation: await addRelation(
        root,
        input.from_id,
        input.to_id,
        input.kind,
        input.inverse_kind,
        input.note
      ),
    };
  },
});

const relationDelete = defineAppCommand({
  id: "novels_codex_relation_delete",
  title: "Delete Codex relation",
  description: "Delete one Codex relation by ID.",
  input: z.object({ relation_id: z.string().uuid() }).strict(),
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
    const relations = await loadRelations(root);
    if (!relations.some((relation) => relation.id === input.relation_id)) {
      throw new AppError("not_found", "The Codex relation was not found.");
    }
    await removeRelation(root, input.relation_id);
    return { deleted_relation_id: input.relation_id };
  },
});

const mentionsGet = defineAppCommand({
  id: "novels_codex_mentions_get",
  title: "Get Codex mentions",
  description:
    "Return all chapter mention records for one Codex entry.",
  input: z.object({ entry_id: z.string().uuid() }).strict(),
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
    const mentions = await loadMentions(root);
    return { entry_id: input.entry_id, items: mentions[input.entry_id] ?? [] };
  },
});

const mentionsScan = defineAppCommand({
  id: "novels_codex_mentions_scan",
  title: "Scan Codex mentions",
  description:
    "Rebuild the workspace mention index from every chapter body with progress.",
  input: z.object({}).strict(),
  permission: "write",
  risk: "R1",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(_input, context) {
    const root = requireRoot(context);
    const entries = await loadEntries(root);
    const result = await scanWorkspaceMentions(
      root,
      entries,
      (progress) => {
        context.progress.report({
          progress: progress.done,
          total: progress.total,
          message: `${progress.workId}/${progress.chapterId}`,
        });
      }
    );
    return result.report;
  },
});

export const CODEX_COMMANDS = [
  typeList,
  typeCreate,
  typeUpdate,
  typeDelete,
  entryList,
  entryGet,
  entryCreate,
  entryUpdate,
  entryDelete,
  relationList,
  relationAdd,
  relationDelete,
  mentionsGet,
  mentionsScan,
] as const;
