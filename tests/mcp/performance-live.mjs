#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const endpoint =
  process.env.NOVELS_YES_MCP_ENDPOINT ?? "http://127.0.0.1:38471/mcp";
const token = process.env.NOVELS_YES_MCP_TOKEN;
const protocolVersion = "2026-07-28";
const fixtureTitle = process.env.NOVELS_YES_MCP_FIXTURE_TITLE ?? "千章性能夹具";
const samples = Number(process.env.NOVELS_YES_MCP_PERF_SAMPLES ?? "3");
const reportPath = path.resolve(
  process.env.NOVELS_YES_MCP_PERF_REPORT ??
    path.join(".agent", "tests", "mcp-live-performance-report.json")
);

if (!token) {
  throw new Error("Set NOVELS_YES_MCP_TOKEN before running this suite.");
}
if (!Number.isInteger(samples) || samples < 3) {
  throw new Error("NOVELS_YES_MCP_PERF_SAMPLES must be an integer >= 3.");
}

let nextId = 1;

function decodeMcpBody(content, contentType, expectedId) {
  const trimmed = content.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  if (
    contentType.includes("text/event-stream") ||
    trimmed.startsWith("data:")
  ) {
    const messages = [];
    for (const line of trimmed.split(/\r?\n/)) {
      const match = line.match(/^data:\s*(.+)$/);
      if (!match) continue;
      try {
        messages.push(JSON.parse(match[1]));
      } catch {
        // Ignore SSE keepalive and non-JSON data.
      }
    }
    return (
      messages.find((message) => message.id === expectedId) ??
      messages.at(-1) ??
      null
    );
  }
  throw new Error(`Unsupported MCP response: ${contentType}`);
}

async function request(method, params = {}) {
  const id = nextId++;
  const requestParams = {
    ...params,
    _meta: {
      "io.modelcontextprotocol/protocolVersion": protocolVersion,
      "io.modelcontextprotocol/clientInfo": {
        name: "novels-yes-live-performance",
        version: "1.0.0",
      },
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  };
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json; charset=utf-8",
    "MCP-Protocol-Version": protocolVersion,
    "Mcp-Method": method,
  };
  const name = requestParams.name ?? requestParams.uri;
  if (typeof name === "string") headers["Mcp-Name"] = name;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: requestParams,
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${method} returned HTTP ${response.status}: ${body}`);
  }
  const message = decodeMcpBody(
    body,
    response.headers.get("content-type") ?? "",
    id
  );
  if (!message) throw new Error(`${method} returned an empty response.`);
  if (message.error) {
    throw new Error(
      `${method} failed: ${message.error.message ?? JSON.stringify(message.error)}`
    );
  }
  return message.result;
}

async function callTool(name, argumentsValue = {}) {
  const result = await request("tools/call", {
    name,
    arguments: argumentsValue,
  });
  if (result.isError) {
    const message =
      result.structuredContent?.error?.message ??
      result.content?.[0]?.text ??
      `${name} failed`;
    throw new Error(message);
  }
  return result.structuredContent;
}

async function time(operation) {
  const startedAt = performance.now();
  const value = await operation();
  return { ms: performance.now() - startedAt, value };
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * ratio) - 1)
    )
  ];
}

function summary(values) {
  return {
    samples: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  };
}

const discovery = await request("server/discover");
assert.ok(discovery.supportedVersions.includes(protocolVersion));

const workspace = await callTool("novels_workspace_get");
assert.equal(workspace.ready, true);

const works = await callTool("novels_work_list", {
  status: "active",
  limit: 100,
  offset: 0,
});
const work = works.items.find((item) => item.title === fixtureTitle);
assert.ok(work, `Fixture work "${fixtureTitle}" is not open.`);

const workDetail = await callTool("novels_work_get", { work_id: work.id });
assert.equal(workDetail.counts.chapters, 1000);
assert.equal(workDetail.counts.volumes, 3);

const firstPage = await callTool("novels_chapter_list", {
  work_id: work.id,
  limit: 100,
  offset: 0,
});
const middlePage = await callTool("novels_chapter_list", {
  work_id: work.id,
  limit: 100,
  offset: 500,
});
const lastPage = await callTool("novels_chapter_list", {
  work_id: work.id,
  limit: 100,
  offset: 900,
});
assert.equal(firstPage.total_count, 1000);
assert.equal(lastPage.count, 100);
const sampleChapters = [
  firstPage.items[0],
  middlePage.items[0],
  lastPage.items.at(-1),
].filter(Boolean);
assert.equal(sampleChapters.length, 3);

const codexEntries = await callTool("novels_codex_entry_list", {
  scope: "all",
  query: "",
  limit: 100,
  offset: 0,
});
assert.equal(codexEntries.items.length, 100);
const mentionEntryId = codexEntries.items[0].id;

const timings = {
  workspace: [],
  workList: [],
  workGet: [],
  chapterList: [],
  chapterRead: [],
  fullTextSearch: [],
  codexList: [],
  mentionsGet: [],
  statsGet: [],
  markdownExport: [],
};
let searchHits = 0;

for (let sample = 0; sample < samples; sample += 1) {
  const workspaceRead = await time(() => callTool("novels_workspace_get"));
  timings.workspace.push(workspaceRead.ms);

  const workList = await time(() =>
    callTool("novels_work_list", {
      status: "active",
      limit: 100,
      offset: 0,
    })
  );
  timings.workList.push(workList.ms);

  const workGet = await time(() =>
    callTool("novels_work_get", { work_id: work.id })
  );
  timings.workGet.push(workGet.ms);

  const chapterList = await time(() =>
    callTool("novels_chapter_list", {
      work_id: work.id,
      limit: 100,
      offset: sample * 100,
    })
  );
  timings.chapterList.push(chapterList.ms);

  const chapterRead = await time(() =>
    Promise.all(
      sampleChapters.map((chapter) =>
        callTool("novels_chapter_get", {
          work_id: work.id,
          chapter_id: chapter.id,
        })
      )
    )
  );
  timings.chapterRead.push(chapterRead.ms);

  const search = await time(() =>
    callTool("novels_search", {
      query: "角色",
      kind: "chapter",
      work_id: work.id,
      max_hits: 50,
    })
  );
  timings.fullTextSearch.push(search.ms);
  searchHits = search.value.count;

  const codex = await time(() =>
    callTool("novels_codex_entry_list", {
      scope: "all",
      query: "",
      limit: 100,
      offset: 0,
    })
  );
  timings.codexList.push(codex.ms);

  const mentions = await time(() =>
    callTool("novels_codex_mentions_get", { entry_id: mentionEntryId })
  );
  timings.mentionsGet.push(mentions.ms);

  const stats = await time(() =>
    callTool("novels_stats_get", { work_id: work.id })
  );
  timings.statsGet.push(stats.ms);

  const exported = await time(() =>
    callTool("novels_export_text", {
      work_id: work.id,
      options: {
        format: "md",
        include_chapter_title: true,
        include_volume_title: true,
        indent_paragraph: false,
        newline: "lf",
        title_format: "plain",
      },
    })
  );
  timings.markdownExport.push(exported.ms);
}

const budgets = {
  workspace: 4_000,
  workList: 4_000,
  workGet: 4_000,
  chapterList: 4_000,
  chapterRead: 6_000,
  fullTextSearch: 8_000,
  codexList: 4_000,
  mentionsGet: 4_000,
  statsGet: 4_000,
  markdownExport: 15_000,
};
const report = {
  mode: "live-workspace-hot",
  endpoint,
  work: {
    id: work.id,
    title: work.title,
    chapters: workDetail.counts.chapters,
    volumes: workDetail.counts.volumes,
    words: workDetail.counts.words,
  },
  samples,
  searchHits,
  timings: Object.fromEntries(
    Object.entries(timings).map(([key, values]) => [key, summary(values)])
  ),
  budgets,
  passed: Object.entries(budgets).every(
    ([key, budget]) => percentile(timings[key], 0.95) <= budget
  ),
};

await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...report, reportPath }, null, 2));
if (!report.passed) process.exitCode = 1;
