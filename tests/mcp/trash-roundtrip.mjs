#!/usr/bin/env node

import assert from "node:assert/strict";

const endpoint =
  process.env.NOVELS_YES_MCP_ENDPOINT ?? "http://127.0.0.1:38471/mcp";
const token = process.env.NOVELS_YES_MCP_TOKEN;
const protocolVersion = "2026-07-28";
const suffix = Date.now().toString(36);
const workTitle = `MCP 回收站回归 ${suffix}`;
const volumeATitle = `第一卷 ${suffix}`;
const volumeBTitle = `第二卷 ${suffix}`;
const chapterTitles = Array.from(
  { length: 5 },
  (_, index) => `回归章 ${index + 1} ${suffix}`
);

if (!token) {
  throw new Error("Set NOVELS_YES_MCP_TOKEN before running this suite.");
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
        name: "novels-yes-trash-regression",
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

function nodesFor(outline, type) {
  return outline.nodes.filter((node) => node.type === type);
}

function assertSiblingOrders(nodes, parentId) {
  const siblings = nodes
    .filter((node) => node.parentId === parentId)
    .sort((left, right) => left.order - right.order);
  assert.deepEqual(
    siblings.map((node) => node.order),
    siblings.map((_, index) => index),
    `siblings under ${parentId ?? "root"} must be contiguous`
  );
  assert.equal(
    new Set(siblings.map((node) => node.id)).size,
    siblings.length,
    `siblings under ${parentId ?? "root"} must be unique`
  );
}

let initialWorkId = null;
let workId = null;
let volumeAId = null;
let volumeBId = null;
let chapterIds = [];
let trashItemId = null;
let primaryError = null;

try {
  const health = await fetch(endpoint.replace(/\/mcp\/?$/, "/healthz"));
  assert.equal(health.status, 200);
  const discovery = await request("server/discover");
  assert.ok(discovery.supportedVersions.includes(protocolVersion));

  const workspace = await callTool("novels_workspace_get");
  initialWorkId = workspace.current_work_id;

  const createdWork = await callTool("novels_work_create", {
    title: workTitle,
    type: "回归测试",
    synopsis: "验证卷删除折叠、整卷恢复和同级 order 重排。",
    auto_paragraph: true,
  });
  workId = createdWork.work.id;

  const volumeA = await callTool("novels_volume_create", {
    work_id: workId,
    title: volumeATitle,
  });
  volumeAId = nodesFor(volumeA.outline, "volume").find(
    (node) => node.title === volumeATitle
  )?.id;
  assert.ok(volumeAId);

  const volumeB = await callTool("novels_volume_create", {
    work_id: workId,
    title: volumeBTitle,
  });
  volumeBId = nodesFor(volumeB.outline, "volume").find(
    (node) => node.title === volumeBTitle
  )?.id;
  assert.ok(volumeBId);

  for (const title of chapterTitles) {
    const chapter = await callTool("novels_chapter_create", {
      work_id: workId,
      title,
      parent_id: volumeAId,
      status: "draft",
      synopsis: "回收站回归章节",
    });
    chapterIds.push(chapter.chapter.id);
  }

  const beforeDelete = await callTool("novels_outline_get", {
    work_id: workId,
  });
  assert.deepEqual(
    nodesFor(beforeDelete, "volume")
      .sort((left, right) => left.order - right.order)
      .map((node) => node.title),
    [volumeATitle, volumeBTitle]
  );
  assertSiblingOrders(beforeDelete.nodes, null);
  assertSiblingOrders(beforeDelete.nodes, volumeAId);

  const deleted = await callTool("novels_node_delete", {
    work_id: workId,
    node_id: volumeAId,
  });
  assert.ok(!deleted.outline.nodes.some((node) => node.id === volumeAId));
  assert.ok(
    chapterIds.every(
      (chapterId) =>
        !deleted.outline.nodes.some((node) => node.id === chapterId)
    )
  );

  const trash = await callTool("novels_trash_list", {
    limit: 100,
    offset: 0,
  });
  const testItems = trash.items.filter(
    (item) => item.workId === workId || item.originId === workId
  );
  const visibleVolume = testItems.filter(
    (item) => item.kind === "volume" && item.originId === volumeAId
  );
  assert.equal(
    visibleVolume.length,
    1,
    "the deleted volume must be listed once"
  );
  trashItemId = visibleVolume[0].itemId;
  assert.equal(
    visibleVolume[0].subtree.filter((node) => node.type === "chapter").length,
    chapterTitles.length
  );
  assert.ok(
    !testItems.some(
      (item) => item.kind === "chapter" && chapterIds.includes(item.originId)
    ),
    "rolled-up chapters must not appear as separate trash rows"
  );

  const restored = await callTool("novels_trash_restore", {
    item_id: trashItemId,
  });
  assert.equal(restored.restored, true);
  trashItemId = null;

  const afterRestore = await callTool("novels_outline_get", {
    work_id: workId,
  });
  const restoredVolumes = nodesFor(afterRestore, "volume").sort(
    (left, right) => left.order - right.order
  );
  assert.deepEqual(
    restoredVolumes.map((node) => node.title),
    [volumeATitle, volumeBTitle],
    "the restored volume must return to its original position"
  );
  assert.deepEqual(
    nodesFor(afterRestore, "chapter")
      .filter((node) => chapterIds.includes(node.id))
      .sort((left, right) => left.order - right.order)
      .map((node) => node.title),
    chapterTitles
  );
  assert.ok(
    chapterIds.every((chapterId) => {
      const node = afterRestore.nodes.find((item) => item.id === chapterId);
      return node?.parentId === volumeAId;
    })
  );
  assertSiblingOrders(afterRestore.nodes, null);
  assertSiblingOrders(afterRestore.nodes, volumeAId);

  const chapters = await callTool("novels_chapter_list", {
    work_id: workId,
    limit: 20,
    offset: 0,
  });
  assert.equal(chapters.total_count, chapterTitles.length);

  console.log(
    JSON.stringify(
      {
        passed: true,
        workId,
        volumeId: volumeAId,
        chapters: chapterIds.length,
        visibleTrashRowsForVolume: visibleVolume.length,
        restoredOrder: restoredVolumes.map((node) => ({
          title: node.title,
          order: node.order,
        })),
      },
      null,
      2
    )
  );
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  const cleanupErrors = [];
  /*
   * 删除作品目录前先离开临时作品。Windows 下当前作品仍可能持有章节或
   * 结构树文件句柄，直接重命名整部作品会以 os error 5 失败，随后清理
   * 被 finally 吞掉，测试虽然通过却会在夹具里留下半套数据。
   */
  if (initialWorkId && initialWorkId !== workId) {
    try {
      await callTool("novels_work_select", { work_id: initialWorkId });
      /*
       * select_work 返回时只代表宿主已收到切换事件，React 结构树仍可能
       * 在异步重载。给旧作品的文件句柄留出释放时间，再做目录重命名。
       */
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (workId) {
    try {
      await callTool("novels_work_delete", { work_id: workId });
    } catch (error) {
      cleanupErrors.push(error);
    }

    try {
      const trash = await callTool("novels_trash_list", {
        limit: 100,
        offset: 0,
      });
      for (const item of trash.items) {
        if (item.workId !== workId && item.originId !== workId) continue;
        await callTool("novels_trash_purge", { item_id: item.itemId });
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (!primaryError && cleanupErrors.length) {
    throw new AggregateError(
      cleanupErrors,
      "Trash regression passed but temporary work cleanup failed."
    );
  }
}
