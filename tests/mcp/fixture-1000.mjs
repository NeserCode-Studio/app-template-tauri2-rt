#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function uuidFor(value) {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, value, "utf8");
}

const output = path.resolve(
  argument("--output", path.join(".agent", "mcp-fixture-1000"))
);
const clean = process.argv.includes("--clean");
const cleanOnly = process.argv.includes("--clean-only");
const marker = path.join(output, ".mcp-fixture.json");
if ((clean || cleanOnly) && (await exists(output))) {
  if (output === path.parse(output).root || output === path.resolve(".")) {
    throw new Error(`Refusing to remove unsafe fixture path: ${output}`);
  }
  let fixture = null;
  try {
    fixture = JSON.parse(await readFile(marker, "utf8"));
  } catch {
    throw new Error(
      `Refusing to remove ${output}: fixture marker is missing or unreadable.`
    );
  }
  if (fixture?.kind !== "novels-yes-performance-fixture") {
    throw new Error(`Refusing to remove ${output}: fixture marker is invalid.`);
  }
  await rm(output, { recursive: true, force: true });
}
if (cleanOnly) {
  console.log(JSON.stringify({ removed: output }, null, 2));
  process.exit(0);
}
if (await exists(output)) {
  const entries = await readdir(output);
  if (entries.length) {
    throw new Error(
      `Fixture output already exists and is not empty: ${output}. Choose a new --output path.`
    );
  }
}
await mkdir(output, { recursive: true });

const baseTime = Date.UTC(2026, 9, 22, 8, 0, 0);
const workId = uuidFor("work:performance-1000");
const workTitle = "千章性能夹具";
const volumeIds = Array.from({ length: 3 }, (_, index) =>
  uuidFor(`volume:${index}`)
);
const chapterIds = Array.from({ length: 1000 }, (_, index) =>
  uuidFor(`chapter:${index}`)
);
const chapterTexts = chapterIds.map((_, index) => {
  const targetLength = index % 10 === 0 ? 4200 : index % 3 === 0 ? 1800 : 600;
  const seed = `第 ${index + 1} 章测试正文。角色沿着长街向前，风从屋檐下穿过。`;
  return seed
    .repeat(Math.ceil(targetLength / seed.length))
    .slice(0, targetLength);
});

const chaptersPerVolume = [334, 333, 333];
const outlineNodes = [];
let chapterCursor = 0;
for (let volumeIndex = 0; volumeIndex < volumeIds.length; volumeIndex += 1) {
  const volumeId = volumeIds[volumeIndex];
  outlineNodes.push({
    id: volumeId,
    type: "volume",
    title: `第${volumeIndex + 1}卷`,
    parentId: null,
    order: volumeIndex,
    status: "draft",
    synopsis: "",
    plotSummary: "",
    preface: `第${volumeIndex + 1}卷卷首语。`,
    collapsed: false,
    createdAt: baseTime + volumeIndex,
    updatedAt: baseTime + volumeIndex,
  });
  for (let order = 0; order < chaptersPerVolume[volumeIndex]; order += 1) {
    const chapterIndex = chapterCursor;
    outlineNodes.push({
      id: chapterIds[chapterIndex],
      type: "chapter",
      title: `第 ${chapterIndex + 1} 章`,
      parentId: volumeId,
      order,
      status: chapterIndex % 7 === 0 ? "final" : "draft",
      synopsis: `第 ${chapterIndex + 1} 章摘要。`,
      plotSummary: "",
      preface: "",
      collapsed: false,
      createdAt: baseTime + 100 + chapterIndex,
      updatedAt: baseTime + 100 + chapterIndex,
    });
    chapterCursor += 1;
  }
}

const chapterIndex = { version: 1, chapters: {} };
let totalWords = 0;
for (let index = 0; index < chapterIds.length; index += 1) {
  const text = chapterTexts[index];
  const chapterId = chapterIds[index];
  const words = text.replace(/\s/g, "").length;
  totalWords += words;
  const timestamp = baseTime + 1000 + index;
  const splitAt = Math.max(1, Math.floor(text.length * 0.45));
  const chapter = {
    id: chapterId,
    title: `第 ${index + 1} 章`,
    status: index % 7 === 0 ? "final" : "draft",
    cards: [
      {
        id: uuidFor(`card:${index}:a`),
        text: text.slice(0, splitAt),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: uuidFor(`card:${index}:b`),
        text: text.slice(splitAt),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    revision: 1,
    history: [],
    cursor: { cardIndex: 1, offset: 0 },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  chapterIndex.chapters[chapterId] = {
    title: chapter.title,
    updatedAt: timestamp,
    words,
  };
  await writeJson(
    path.join(output, "works", workId, "chapters", `${chapterId}.json`),
    chapter
  );
  await writeText(
    path.join(output, "works", workId, "texts", `${chapterId}.txt`),
    text
  );
}

const entryIds = Array.from({ length: 100 }, (_, index) =>
  uuidFor(`codex-entry:${index}`)
);
const relations = entryIds.slice(1).map((entryId, index) => ({
  id: uuidFor(`relation:${index}`),
  fromId: entryIds[index],
  toId: entryId,
  kind: "关联",
  inverseKind: "关联",
  order: index,
}));
const mentions = Object.fromEntries(
  entryIds.map((entryId, index) => [
    entryId,
    Array.from({ length: 10 }, (_, offset) => {
      const chapterIndexValue = (index * 10 + offset) % chapterIds.length;
      return {
        workId,
        chapterId: chapterIds[chapterIndexValue],
        count: 1,
        firstSeenAt: baseTime + 5000 + chapterIndexValue,
      };
    }),
  ])
);

await writeJson(path.join(output, "novels-yes.json"), {
  version: 1,
  alias: "MCP 千章性能夹具",
  order: [workId],
  archived: [],
});
await writeJson(path.join(output, "works", workId, "work.json"), {
  id: workId,
  title: workTitle,
  type: "性能测试",
  synopsis: "用于 MCP 列表、读取、搜索、扫描和统计基准的确定性夹具。",
  autoParagraph: true,
  cover: "",
  archived: false,
  createdAt: baseTime,
  updatedAt: baseTime + 2000,
});
await writeJson(path.join(output, "works", workId, "outline.json"), {
  nodes: outlineNodes,
});
await writeJson(
  path.join(output, "works", workId, "chapter-index.json"),
  chapterIndex
);
await writeJson(path.join(output, "works", workId, "stats.json"), {
  totalWords,
  streak: 1,
  todayWords: 0,
  lastWriteDate: "2026-10-22",
  daily: {},
  dailyGoal: 0,
  curveMode: "net",
  workWords: { [workId]: totalWords },
  mentions: {},
});

for (let index = 0; index < entryIds.length; index += 1) {
  const entryId = entryIds[index];
  await writeJson(path.join(output, "codex", "entries", `${entryId}.json`), {
    id: entryId,
    typeId: "character",
    name: `测试角色 ${index + 1}`,
    aliases: [],
    tags: ["性能夹具"],
    summary: `第 ${index + 1} 个测试角色。`,
    body: "用于验证千章工作区素材加载与关系索引。",
    fields: {},
    scope: { kind: "workspace" },
    createdAt: baseTime + 3000 + index,
    updatedAt: baseTime + 3000 + index,
  });
}
await writeJson(path.join(output, "codex", "relations.json"), { relations });
await writeJson(path.join(output, "codex", "mentions.json"), mentions);
await writeJson(path.join(output, ".trash", "index.json"), { items: [] });
await writeJson(marker, {
  kind: "novels-yes-performance-fixture",
  version: 1,
  createdAt: Date.now(),
  workId,
});

console.log(
  JSON.stringify(
    {
      output,
      workId,
      workTitle,
      volumes: volumeIds.length,
      chapters: chapterIds.length,
      codexEntries: entryIds.length,
      relations: relations.length,
      totalWords,
    },
    null,
    2
  )
);
