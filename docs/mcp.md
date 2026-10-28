# MCP Connection

novels-yes exposes the currently open workspace through a local
Streamable HTTP MCP server. The server is owned by the Tauri process and stops
when the workspace closes or changes.

## Connect

1. Open a workspace in novels-yes.
2. Open the `MCP` menu on the left side of the title bar and select
   `Manage connection`.
3. Choose the required access level.
4. Reveal the workspace token.
5. Copy the generated client configuration.

The default endpoint is:

```text
http://127.0.0.1:38471/mcp
```

If that port is occupied, the application tries ports `38472` through `38480`.
The actual endpoint is always shown in the connection dialog.

Example configuration:

```json
{
  "mcpServers": {
    "novels-yes": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:38471/mcp",
      "headers": {
        "Authorization": "Bearer <workspace-token>"
      }
    }
  }
}
```

The token belongs to one workspace. Switching, migrating or deleting the
workspace ends the current MCP session. Reopening the new workspace requires
the configuration and token shown in its own title-bar MCP menu.

## Protocol Compatibility

The server supports both `2026-07-28` and `2025-11-25`. Modern clients use
`server/discover` and request metadata on every call. Legacy clients use the
`initialize` handshake. Both paths expose the same tools, resources and
prompts.

## Access Levels

| Level   | Capability                                                         |
| ------- | ------------------------------------------------------------------ |
| `read`  | Search, read resources, statistics, prompts and navigation         |
| `write` | Read access plus ordinary content and metadata changes             |
| `admin` | Write access plus permanent deletion and workspace lifecycle tools |

Risk `R2` and `R3` tools still require an in-app approval, even with `admin`
access. Approval requests expire after 120 seconds and are denied on timeout.

Lowering the access level immediately removes disallowed tools and cancels
in-flight calls that no longer have enough permission.

All read-only tools accept `response_format: "json" | "markdown"`. The default
is `json`; use `markdown` when the client should present the result directly
to a person. Write tools always return structured content.

## Streaming Text Input

Supported write tools expose an optional `input_stream` argument. Use it when a
single `text`, `body`, `preface`, `plot_summary`, `synopsis` or `stashed_text`
argument is too large or arrives progressively.

```json
{
  "input_stream": {
    "stream_id": "client-stream-001",
    "field": "text",
    "chunk_index": 0,
    "chunk_total": 3,
    "text": "First chunk",
    "final": false
  }
}
```

Send the same stream ID with contiguous chunk indexes. A non-final chunk returns
immediately with a received-chunk count. On the final chunk, set `final: true`
and omit the target field; the bridge assembles the text and then executes the
tool with normal validation, approval and revision checks.

Streams expire after five minutes. One stream accepts at most 500,000 characters,
each chunk accepts at most 100,000 characters, and the application keeps at most
16 streams.

### Chapter Body Writes

Chapter body tools must follow the application flow: call
`novels_open_chapter` first, then write from the editor. If the current page,
work or selected chapter does not match the target, the bridge returns
`navigation_required` without changing disk content. After `novels_open_chapter`,
retry the same write. During a streamed chapter write, the editor input area
shows the received text and is locked until the operation settles.

## Task Queue

Tool calls execute through a single serial queue. A new call starts at least
1.2 seconds after the previous call started, and write refreshes remain inside
the same queue slot. Additional calls stay queued and appear as `Queued` in
task feedback. Resource reads and prompt expansion bypass the command queue so
context loading remains responsive.

## Task Feedback

Consecutive operations from the same client are grouped into one bottom-left
progress toast. Calls join the current batch while it is running or when they
arrive within 800 ms of the previous call finishing. The toast shows completed,
running, queued and failed counts and opens the `/mcp` page for details.

The 1.2-second start interval is an execution pacing rule, not an animation
sleep. Aggregate feedback also remains visible for at least 1.2 seconds, then
holds the completed state for 2.4 seconds, or 4 seconds when an operation
fails. Active updates are coalesced to reduce visual churn. Non-blocking writes
do not change pages; only explicit navigation tools do.

## Recent Operations

The connection menu shows the three latest operations with the concrete tool
name and target. `View all operations` opens the dedicated `/mcp` page, which
adds search, status filters, active tasks, connected clients and workspace
context. Finished operations are retained for 30 minutes, up to 500 records,
and persisted by workspace so a WebView reload does not lose them. Active tasks
are never persisted.

## Resources And Prompts

Useful resources include:

```text
novels://workspace
novels://works
novels://works/{workId}/outline
novels://works/{workId}/chapters
novels://works/{workId}/chapters/{chapterId}/text
novels://works/{workId}/stats
novels://codex/types
novels://codex/entries/{entryId}
novels://drafts
novels://trash
novels://settings
```

Available prompts cover chapter continuation, review, outline planning,
consistency auditing and import normalization. Prompts expand read-only
context; they do not perform hidden writes.

## Security

- The server binds only to `127.0.0.1`.
- Every MCP request requires the workspace Bearer token.
- Host must be `127.0.0.1:<port>` or `localhost:<port>`.
- Requests with an `Origin` header are accepted only from the application
  WebView or the local development origin.
- Request bodies are limited to 2 MiB, with 120 requests per minute.
- Tool calls are serialized by the bridge queue with a 1.2-second minimum start
  interval. The server accepts at most 8 in-flight bridge calls at once.
- Audit records contain tool names, hashes of arguments, timing and status.
  They do not contain chapter text, tokens or absolute workspace paths.
- Raw filesystem tools are not exposed.

If an MCP Inspector or another browser-hosted client sends an arbitrary
loopback `Origin`, the request is intentionally rejected. Use a native MCP
client or the Inspector backend transport that connects to the endpoint as a
local HTTP client.

## Verification

The unauthenticated health endpoint is available while the service is running:

```powershell
Invoke-RestMethod http://127.0.0.1:38471/healthz
```

Expected response:

```json
{
  "status": "ok",
  "protocol_versions": ["2026-07-28", "2025-11-25"]
}
```

If the port differs, use the endpoint shown in the connection dialog.

Run the read-only protocol regression against the open workspace:

```powershell
$env:NOVELS_YES_MCP_TOKEN = "<workspace token>"
pnpm test:mcp
```

The suite covers both protocol versions, authentication, tool/resource/prompt
discovery, workspace and chapter reads, argument validation, txt and Markdown
export, and trash listing. It does not create or delete content.

The destructive trash round trip is separate and requires in-app approval:

```powershell
pnpm test:mcp:trash
```

For the 1,000-chapter fixture:

```powershell
pnpm test:mcp:fixture -- --output .agent/mcp-fixture-1000
pnpm test:mcp:perf -- --root .agent/mcp-fixture-1000
pnpm test:mcp:fixture:clean -- --output .agent/mcp-fixture-1000
```

After opening that fixture as a workspace, `pnpm test:mcp:perf:live` measures
the real MCP bridge. The file benchmark's cold-open probe spawns a fresh Node
process to include process startup plus metadata, outline, chapter-index and
Codex-index reads. Tauri window startup remains a manual session-bound check.

## Troubleshooting

| Symptom                 | Action                                                          |
| ----------------------- | --------------------------------------------------------------- |
| `401 Unauthorized`      | Reveal and copy the current workspace token again               |
| `403 Forbidden`         | Use the application WebView or a native local MCP client        |
| `workspace_not_ready`   | Open a valid workspace before retrying                          |
| `permission_denied`     | Raise the access level in the connection dialog                 |
| `confirmation_required` | Approve the request in the application                          |
| `navigation_required`   | Call `novels_open_chapter`, then retry from the editor          |
| `chapter_busy`          | Save or close the chapter open in the editor                    |
| `revision_conflict`     | Read the latest chapter revision before retrying                |
| `bridge_unavailable`    | Wait for the workspace to finish loading or restart the service |
