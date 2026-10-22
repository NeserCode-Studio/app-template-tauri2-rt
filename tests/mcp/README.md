# MCP regression

The default suite is read-only. It verifies both advertised protocol versions,
authentication, tools, resources, templates, prompts, workspace and chapter
reads, argument validation, txt and Markdown export, and trash listing.

```powershell
$env:NOVELS_YES_MCP_TOKEN = "<workspace token>"
pnpm test:mcp
```

Optional environment:

| Variable                   | Default                      |
| -------------------------- | ---------------------------- |
| `NOVELS_YES_MCP_ENDPOINT`  | `http://127.0.0.1:38471/mcp` |
| `NOVELS_YES_MCP_PROTOCOLS` | `2026-07-28,2025-11-25`      |

The suite intentionally does not create, delete, restore or purge workspace
content. Destructive and approval-dependent cases remain in the manual live
regression procedure so a routine run cannot change user data.

Run the trash round trip separately:

```powershell
pnpm test:mcp:trash
```

It creates one temporary work with two volumes and five chapters, verifies
rolled-up trash rows, restores the first volume, and checks sibling `order`
renumbering. Risk `R2` and `R3` calls require approval in the running app. The
test switches back to the original work before cleanup and fails if the
temporary work cannot be removed.

For the 1,000-chapter fixture:

```powershell
pnpm test:mcp:fixture -- --output .agent/mcp-fixture-1000
pnpm test:mcp:perf -- --root .agent/mcp-fixture-1000
pnpm test:mcp:fixture:clean -- --output .agent/mcp-fixture-1000
```

The fixture command only writes below the supplied output directory. It adds a
marker file, and cleanup refuses to delete a directory without that marker. The
performance command validates the fixture's file counts and reports JSON
timings. Its cold-open sample spawns a fresh Node process and includes process
startup plus workspace metadata, outline, chapter-index and Codex-index reads.
Tauri window startup remains a separate manual session-bound check.

Open the fixture as a workspace, then run:

```powershell
$env:NOVELS_YES_MCP_TOKEN = "<fixture workspace token>"
pnpm test:mcp:perf:live
```

This measures the real MCP bridge and writes
`.agent/tests/mcp-live-performance-report.json`. Vite ignores `.agent` during
development so Windows does not hold directory handles while a test removes
its temporary work.
