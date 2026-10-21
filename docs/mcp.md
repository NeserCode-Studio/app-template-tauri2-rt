# MCP Connection

novels-yes exposes the currently open workspace through a local
Streamable HTTP MCP server. The server is owned by the Tauri process and stops
when the workspace closes or changes.

## Connect

1. Open a workspace in novels-yes.
2. Open `Workspace settings` and select `Manage connection`.
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
the configuration and token shown in its own settings.

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
- Request bodies are limited to 2 MiB, with 8 concurrent calls and 120
  requests per minute.
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

## Troubleshooting

| Symptom                 | Action                                                          |
| ----------------------- | --------------------------------------------------------------- |
| `401 Unauthorized`      | Reveal and copy the current workspace token again               |
| `403 Forbidden`         | Use the application WebView or a native local MCP client        |
| `workspace_not_ready`   | Open a valid workspace before retrying                          |
| `permission_denied`     | Raise the access level in the connection dialog                 |
| `confirmation_required` | Approve the request in the application                          |
| `chapter_busy`          | Save or close the chapter open in the editor                    |
| `revision_conflict`     | Read the latest chapter revision before retrying                |
| `bridge_unavailable`    | Wait for the workspace to finish loading or restart the service |
