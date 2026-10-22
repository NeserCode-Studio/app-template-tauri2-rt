#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
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

async function time(operation) {
  const startedAt = performance.now();
  const value = await operation();
  return { ms: performance.now() - startedAt, value };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

const root = path.resolve(
  argument("--root", path.join(".agent", "mcp-fixture-1000"))
);

if (process.argv.includes("--probe")) {
  const workspace = await readJson(path.join(root, "novels-yes.json"));
  const workIds = [...(workspace.order ?? []), ...(workspace.archived ?? [])];
  let chapters = 0;
  let volumes = 0;

  for (const workId of workIds) {
    const workDir = path.join(root, "works", workId);
    const [outline, index] = await Promise.all([
      readJson(path.join(workDir, "outline.json")),
      readJson(path.join(workDir, "chapter-index.json")),
    ]);
    await Promise.all([
      readJson(path.join(workDir, "work.json")),
      readJson(path.join(workDir, "stats.json")),
    ]);
    const workChapters = outline.nodes.filter(
      (node) => node.type === "chapter"
    ).length;
    chapters += workChapters;
    volumes += outline.nodes.filter((node) => node.type === "volume").length;
    if (Object.keys(index.chapters ?? {}).length !== workChapters) {
      throw new Error(`Chapter index mismatch for work ${workId}.`);
    }
  }

  await Promise.all([
    readJson(path.join(root, "codex", "relations.json")),
    readJson(path.join(root, "codex", "mentions.json")),
  ]);
  process.stdout.write(
    JSON.stringify({
      works: workIds.length,
      volumes,
      chapters,
    })
  );
  process.exit(0);
}

const samples = Number(argument("--samples", "7"));
const reportPath = path.resolve(
  argument(
    "--report",
    path.join(".agent", "tests", "mcp-performance-report.json")
  )
);
if (!Number.isInteger(samples) || samples < 3) {
  throw new Error("--samples must be an integer >= 3.");
}

const workspace = await readJson(path.join(root, "novels-yes.json"));
const workId = workspace.order[0];
if (!workId) throw new Error("Fixture workspace has no active work.");
const workDir = path.join(root, "works", workId);
const chapterDir = path.join(workDir, "chapters");
const chapterFiles = (await readdir(chapterDir)).filter((file) =>
  file.endsWith(".json")
);
const outline = await readJson(path.join(workDir, "outline.json"));
const chapters = outline.nodes.filter((node) => node.type === "chapter");
const volumes = outline.nodes.filter((node) => node.type === "volume");
if (
  chapterFiles.length !== 1000 ||
  chapters.length !== 1000 ||
  volumes.length !== 3
) {
  throw new Error(
    `Fixture shape mismatch: files=${chapterFiles.length}, chapters=${chapters.length}, volumes=${volumes.length}`
  );
}

const indexPath = path.join(workDir, "chapter-index.json");
const outlinePath = path.join(workDir, "outline.json");
const statsPath = path.join(workDir, "stats.json");
const sampleChapters = [
  chapterFiles[0],
  chapterFiles[Math.floor(chapterFiles.length / 2)],
  chapterFiles.at(-1),
];

const timings = {
  coldWorkspaceOpen: [],
  chapterIndex: [],
  outline: [],
  chapterRead: [],
  fullChapterScan: [],
  fullTextSearch: [],
  statsRead: [],
  codexIndex: [],
};
let lastSearchHits = 0;

for (let sample = 0; sample < samples; sample += 1) {
  const coldOpen = await time(() =>
    execFileAsync(
      process.execPath,
      [fileURLToPath(import.meta.url), "--probe", "--root", root],
      {
        cwd: path.dirname(fileURLToPath(import.meta.url)),
        maxBuffer: 1024 * 1024,
      }
    )
  );
  timings.coldWorkspaceOpen.push(coldOpen.ms);
  const coldShape = JSON.parse(coldOpen.value.stdout);
  if (
    coldShape.works !==
    workspace.order.length + (workspace.archived ?? []).length
  ) {
    throw new Error("Cold workspace probe returned a mismatched work count.");
  }

  const indexRead = await time(() => readJson(indexPath));
  timings.chapterIndex.push(indexRead.ms);
  if (Object.keys(indexRead.value.chapters).length !== 1000) {
    throw new Error("chapter-index.json does not contain 1000 chapters.");
  }

  const outlineRead = await time(() => readJson(outlinePath));
  timings.outline.push(outlineRead.ms);

  const chapterRead = await time(() =>
    Promise.all(
      sampleChapters.map((file) => readJson(path.join(chapterDir, file)))
    )
  );
  timings.chapterRead.push(chapterRead.ms);

  const scan = await time(async () => {
    let cards = 0;
    for (const file of chapterFiles) {
      const chapter = await readJson(path.join(chapterDir, file));
      cards += chapter.cards.length;
    }
    return cards;
  });
  timings.fullChapterScan.push(scan.ms);

  const search = await time(async () => {
    let hits = 0;
    for (const file of chapterFiles) {
      const chapter = await readJson(path.join(chapterDir, file));
      if (chapter.cards.some((card) => card.text.includes("角色"))) hits += 1;
    }
    return hits;
  });
  timings.fullTextSearch.push(search.ms);
  lastSearchHits = search.value;

  const statsRead = await time(() => readJson(statsPath));
  timings.statsRead.push(statsRead.ms);

  const codex = await time(async () => {
    const [relations, mentions] = await Promise.all([
      readJson(path.join(root, "codex", "relations.json")),
      readJson(path.join(root, "codex", "mentions.json")),
    ]);
    return relations.relations.length + Object.keys(mentions).length;
  });
  timings.codexIndex.push(codex.ms);
}

const budgets = {
  coldWorkspaceOpen: 3000,
  chapterIndex: 250,
  outline: 250,
  chapterRead: 150,
  fullChapterScan: 6000,
  fullTextSearch: 8000,
  statsRead: 150,
  codexIndex: 300,
};
const report = {
  root,
  workId,
  samples,
  coldStartMethod:
    "spawned workspace probe: Node process startup plus metadata, outline, chapter index and Codex index reads",
  fixture: {
    chapters: chapters.length,
    volumes: volumes.length,
    chapterFiles: chapterFiles.length,
    searchHits: lastSearchHits,
    sizeBytes: (
      await Promise.all(
        chapterFiles.map(
          async (file) => (await stat(path.join(chapterDir, file))).size
        )
      )
    ).reduce((sum, value) => sum + value, 0),
  },
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
