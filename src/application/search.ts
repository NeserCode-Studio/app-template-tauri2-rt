import { z } from "zod";

import { requireRoot } from "./helpers";
import { defineAppCommand } from "./types";
import { loadEntries } from "@/services/codex";
import { loadWorkspace, loadWork } from "@/services/workspace";
import { MAX_HITS, searchWork, type SearchHit } from "@/services/search";

function snippet(text: string, query: string): string {
  const lower = text.toLowerCase();
  const at = lower.indexOf(query);
  if (at < 0) return text.slice(0, 96);
  const start = Math.max(0, at - 32);
  const end = Math.min(text.length, at + query.length + 32);
  return `${start > 0 ? "..." : ""}${text
    .slice(start, end)
    .replace(/\n/g, " ")}${end < text.length ? "..." : ""}`;
}

const search = defineAppCommand({
  id: "novels_search",
  title: "Search workspace",
  description:
    "Search chapter titles, chapter bodies and Codex entries. Results are capped at 200.",
  input: z
    .object({
      query: z.string().trim().min(1).max(500),
      kind: z.enum(["all", "chapter", "codex"]).default("all"),
      work_id: z.string().uuid().optional(),
      max_hits: z.number().int().min(1).max(MAX_HITS).default(50),
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
    const workspace = await loadWorkspace(root);
    const workIds = input.work_id
      ? [input.work_id]
      : [...workspace.order, ...workspace.archived];
    const hits: SearchHit[] = [];

    if (input.kind !== "codex") {
      for (const workId of workIds) {
        if (hits.length >= input.max_hits) break;
        const work = await loadWork(root, workId).catch(() => null);
        if (!work) continue;
        const found = await searchWork(
          root,
          workId,
          work.title,
          query,
          input.max_hits - hits.length
        );
        hits.push(...found);
      }
    }

    if (input.kind !== "chapter" && hits.length < input.max_hits) {
      const entries = await loadEntries(root);
      for (const entry of entries) {
        if (hits.length >= input.max_hits) break;
        const hay = [
          entry.name,
          entry.summary,
          entry.body,
          ...entry.aliases,
          ...entry.tags,
        ].join("\n");
        const lower = hay.toLowerCase();
        if (!lower.includes(query)) continue;
        hits.push({
          kind: "codex",
          id: entry.id,
          title: entry.name,
          workId: "",
          workTitle: "",
          snippet: snippet(hay, query),
          count: lower.split(query).length - 1,
          type: entry.typeId,
        });
      }
    }

    return {
      query: input.query,
      items: hits.slice(0, input.max_hits),
      count: Math.min(hits.length, input.max_hits),
      capped: hits.length >= MAX_HITS,
    };
  },
});

export const SEARCH_COMMANDS = [search] as const;
