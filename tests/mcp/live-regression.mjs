#!/usr/bin/env node

import assert from "node:assert/strict";

const endpoint =
  process.env.NOVELS_YES_MCP_ENDPOINT ?? "http://127.0.0.1:38471/mcp";
const token = process.env.NOVELS_YES_MCP_TOKEN;
const protocolVersions = (
  process.env.NOVELS_YES_MCP_PROTOCOLS ?? "2026-07-28,2025-11-25"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!token) {
  throw new Error("Set NOVELS_YES_MCP_TOKEN before running this suite.");
}

const results = [];

async function test(name, operation) {
  const startedAt = performance.now();
  try {
    const detail = await operation();
    results.push({
      name,
      passed: true,
      detail: detail ?? "",
      ms: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    results.push({
      name,
      passed: false,
      detail: error instanceof Error ? error.message : String(error),
      ms: Math.round(performance.now() - startedAt),
    });
    throw error;
  }
}

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
        // Ignore non-JSON SSE keepalive lines.
      }
    }
    return (
      messages.find((message) => message.id === expectedId) ??
      messages.at(-1) ??
      null
    );
  }
  throw new Error(
    `Unsupported MCP response (${contentType}): ${trimmed.slice(0, 120)}`
  );
}

class McpClient {
  constructor(protocolVersion) {
    this.protocolVersion = protocolVersion;
    this.modern = protocolVersion >= "2026-07-28";
    this.nextId = 1;
    this.headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json; charset=utf-8",
      "MCP-Protocol-Version": protocolVersion,
    };
  }

  requestHeaders(method, params) {
    if (!this.modern) return this.headers;
    const headers = {
      ...this.headers,
      "Mcp-Method": method,
    };
    const name = params.name ?? params.uri;
    if (typeof name === "string") {
      headers["Mcp-Name"] = encodeMcpHeaderValue(name);
    }
    return headers;
  }

  requestParams(params) {
    if (!this.modern) return params;
    return {
      ...params,
      _meta: {
        ...(params._meta ?? {}),
        "io.modelcontextprotocol/protocolVersion": this.protocolVersion,
        "io.modelcontextprotocol/clientInfo": {
          name: "novels-yes-regression",
          version: "1.0.0",
        },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    };
  }

  async request(method, params = {}) {
    const id = this.nextId++;
    const requestParams = this.requestParams(params);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: this.requestHeaders(method, requestParams),
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

  async notify(method, params = {}) {
    if (this.modern) {
      throw new Error(`Modern MCP clients do not send ${method}.`);
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ jsonrpc: "2.0", method, params }),
    });
    if (!response.ok) {
      throw new Error(`${method} returned HTTP ${response.status}`);
    }
  }

  async initialize() {
    const result = await this.request("initialize", {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: {
        name: "novels-yes-regression",
        version: "1.0.0",
      },
    });
    this.protocolVersion = result.protocolVersion;
    this.headers["MCP-Protocol-Version"] = result.protocolVersion;
    await this.notify("notifications/initialized");
    return result;
  }

  async discover() {
    if (!this.modern) {
      throw new Error("server/discover is only used by modern MCP clients.");
    }
    return this.request("server/discover");
  }

  async callTool(name, argumentsValue = {}) {
    return this.request("tools/call", {
      name,
      arguments: argumentsValue,
    });
  }
}

function encodeMcpHeaderValue(value) {
  const text = String(value);
  const safe =
    /^[\x20-\x7e]+$/.test(text) &&
    text === text.trim() &&
    !(text.startsWith("=?base64?") && text.endsWith("?="));
  return safe
    ? text
    : `=?base64?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

async function readTool(client, name, argumentsValue = {}) {
  const result = await client.callTool(name, argumentsValue);
  if (result.isError) {
    const message =
      result.structuredContent?.error?.message ??
      result.content?.[0]?.text ??
      `${name} failed`;
    throw new Error(message);
  }
  return result.structuredContent;
}

const healthBase = endpoint.replace(/\/mcp\/?$/, "");
const health = await fetch(`${healthBase}/healthz`);
const healthBody = await health.json();

await test("healthz", async () => {
  assert.equal(health.status, 200);
  assert.equal(healthBody.status, "ok");
  for (const version of protocolVersions) {
    assert.ok(healthBody.protocol_versions.includes(version));
  }
  return healthBody.protocol_versions.join(", ");
});

await test("authentication required", async () => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });
  assert.equal(response.status, 401);
  return "missing Bearer token returned 401";
});

for (const requestedVersion of protocolVersions) {
  const client = new McpClient(requestedVersion);
  const prefix = requestedVersion;

  if (client.modern) {
    const discovered = await client.discover();
    await test(`${prefix} server/discover`, async () => {
      assert.equal(discovered.resultType, "complete");
      assert.ok(discovered.supportedVersions.includes(requestedVersion));
      assert.ok(discovered.capabilities.tools);
      assert.ok(discovered.capabilities.resources);
      assert.ok(discovered.capabilities.prompts);
      assert.equal(
        discovered._meta?.["io.modelcontextprotocol/serverInfo"]?.name,
        "novels-yes"
      );
      return `supported ${discovered.supportedVersions.join(", ")}`;
    });
  } else {
    const initialized = await client.initialize();
    await test(`${prefix} initialize`, async () => {
      assert.equal(initialized.protocolVersion, requestedVersion);
      assert.equal(initialized.serverInfo.name, "novels-yes");
      assert.ok(initialized.capabilities.tools);
      assert.ok(initialized.capabilities.resources);
      assert.ok(initialized.capabilities.prompts);
      return `negotiated ${initialized.protocolVersion}`;
    });
  }

  const tools = await client.request("tools/list");
  await test(`${prefix} tools`, async () => {
    if (client.modern) assert.equal(tools.resultType, "complete");
    assert.ok(tools.tools.length >= 70);
    const names = new Set(tools.tools.map((tool) => tool.name));
    for (const required of [
      "novels_workspace_get",
      "novels_work_list",
      "novels_chapter_get",
      "novels_export_text",
      "novels_trash_list",
    ]) {
      assert.ok(names.has(required), `missing ${required}`);
    }
    const streamingTools = tools.tools.filter(
      (tool) => tool.inputSchema?.properties?.input_stream
    );
    assert.ok(streamingTools.length >= 10);
    return `${tools.tools.length} tools, ${streamingTools.length} streaming`;
  });

  const resources = await client.request("resources/list");
  await test(`${prefix} resources`, async () => {
    assert.ok(resources.resources.length >= 7);
    return `${resources.resources.length} resources`;
  });

  const templates = await client.request("resources/templates/list");
  await test(`${prefix} resource templates`, async () => {
    assert.ok(templates.resourceTemplates.length >= 8);
    return `${templates.resourceTemplates.length} templates`;
  });

  const prompts = await client.request("prompts/list");
  await test(`${prefix} prompts`, async () => {
    assert.ok(prompts.prompts.length >= 4);
    return `${prompts.prompts.length} prompts`;
  });

  const workspace = await readTool(client, "novels_workspace_get");
  await test(`${prefix} workspace`, async () => {
    assert.equal(workspace.ready, true);
    assert.ok(workspace.active_count >= 1);
    return `alias=${workspace.alias}; active=${workspace.active_count}`;
  });

  await test(`${prefix} resource read`, async () => {
    const resource = await client.request("resources/read", {
      uri: "novels://workspace",
    });
    assert.ok(resource.contents.length >= 1);
    assert.ok(resource.contents[0].text.includes('"ready"'));
    return "novels://workspace";
  });

  const works = await readTool(client, "novels_work_list", {
    status: "active",
    limit: 50,
    offset: 0,
  });
  const work = works.items.find((item) => !item.archived) ?? works.items[0];
  assert.ok(work, "No active work is available for the read-only suite.");

  const workDetail = await readTool(client, "novels_work_get", {
    work_id: work.id,
  });
  const chapters = await readTool(client, "novels_chapter_list", {
    work_id: work.id,
    limit: 20,
    offset: 0,
  });
  const chapter = chapters.items[0];

  await test(`${prefix} chapter read`, async () => {
    assert.equal(workDetail.work.id, work.id);
    assert.ok(chapter, "The selected work has no chapter.");
    const detail = await readTool(client, "novels_chapter_get", {
      work_id: work.id,
      chapter_id: chapter.id,
    });
    assert.equal(detail.chapter.id, chapter.id);
    assert.ok(Number.isInteger(detail.chapter.revision));
    return `${work.title} / ${chapter.title}`;
  });

  await test(`${prefix} prompt get`, async () => {
    const prompt = await client.request("prompts/get", {
      name: "novels_consistency_audit",
      arguments: { work_id: work.id },
    });
    assert.ok(prompt.messages.length >= 1);
    assert.ok(prompt.messages[0].content.text.length > 0);
    return prompt.description;
  });

  await test(`${prefix} invalid argument`, async () => {
    const response = await client.callTool("novels_chapter_get", {
      work_id: work.id,
      chapter_id: "not-a-uuid",
    });
    assert.equal(response.isError, true);
    return response.structuredContent?.error?.code ?? "rejected";
  });

  await test(`${prefix} markdown export`, async () => {
    const exported = await readTool(client, "novels_export_text", {
      work_id: work.id,
      options: {
        format: "md",
        include_chapter_title: true,
        include_volume_title: true,
        indent_paragraph: false,
        newline: "lf",
        title_format: "plain",
      },
    });
    assert.ok(exported.text.startsWith(`# ${work.title}`));
    assert.ok(exported.text.includes("\n\n### "));
    assert.ok(exported.chars > work.title.length);
    return `${exported.chars} chars`;
  });

  await test(`${prefix} text export`, async () => {
    const exported = await readTool(client, "novels_export_text", {
      work_id: work.id,
      options: {
        format: "txt",
        include_chapter_title: true,
        include_volume_title: true,
        indent_paragraph: true,
        newline: "crlf",
        title_format: "plain",
      },
    });
    assert.ok(exported.text.length > work.title.length);
    assert.ok(!exported.text.startsWith("# "));
    assert.ok(exported.text.includes(chapter.title));
    return `${exported.chars} chars`;
  });

  await test(`${prefix} trash list`, async () => {
    const trash = await readTool(client, "novels_trash_list", {
      limit: 100,
      offset: 0,
    });
    assert.ok(Array.isArray(trash.items));
    return `${trash.items.length} visible items`;
  });
}

const failed = results.filter((result) => !result.passed);
console.log(
  JSON.stringify(
    {
      endpoint,
      protocolVersions,
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      results,
    },
    null,
    2
  )
);

if (failed.length) process.exitCode = 1;
