# External Integrations

**Analysis Date:** 2026-08-20

## APIs & External Services

**Code knowledge MCP (Dev):**
- KCodeRag Dev MCP server - graph-first symbol search, context inspection, call-chain traversal, index listing, read-only Cypher, and feedback submission.
  - SDK/Client: MCP server registration referenced by `kcoderag-dev/.codex-plugin/plugin.json` and `kcoderag-dev/.mcp.json` (the latter not read because it may contain credentials).
  - Auth: README documents an internal HTTP endpoint with a bundled shared Bearer credential; value is not recorded (`kcoderag-dev/README.md`).

**Code knowledge MCP (QA):**
- KCodeRag QA MCP server - the same six read/navigation tools for the QA graph environment.
  - SDK/Client: MCP server registration referenced by `kcoderag-qa/.codex-plugin/plugin.json` and `kcoderag-qa/.mcp.json` (contents not read).
  - Auth: README documents an internal HTTP endpoint with a bundled shared Bearer credential; value is not recorded (`kcoderag-qa/README.md`).

## Data Storage

**Databases:**
- KCodeRag knowledge graph (remote service behind MCP) - queried through MCP tools rather than a direct database driver; concrete database provider is not exposed in this repository.

**File Storage:**
- Local plugin checkout only: Markdown, JSON, and Python files under `kcoderag-dev/` and `kcoderag-qa/`.

**Caching:**
- None detected in this plugin repository.

## Authentication & Identity

**Auth Provider:**
- Internal Bearer-token authentication at the Dev/QA MCP HTTP endpoints, configured in the respective hidden `.mcp.json` files and described without values in `kcoderag-dev/README.md` and `kcoderag-qa/README.md`.
- Tokens are bundled by the internal plugin according to the READMEs; rotate the bundled credential together with the plugin version.

## Monitoring & Observability

**Error Tracking:**
- None detected.

**Logs:**
- Hook failures are explicitly advisory and fail open; `kcoderag-dev/hooks/grep_nudge.py` and `kcoderag-qa/hooks/grep_nudge.py` return exit code 0 on malformed input and emit optional JSON context only when a structural lookup is detected.

## CI/CD & Deployment

**Hosting:**
- Not detected for the plugin itself. The MCP endpoints are internal Dev and QA network services.

**CI Pipeline:**
- None detected. Validation is executable locally through `kcoderag-dev/hooks/test_grep_nudge.py` and `kcoderag-qa/hooks/test_grep_nudge.py`.

## Environment Configuration

**Required env vars:**
- `CLAUDE_PLUGIN_ROOT` / `PLUGIN_ROOT` are used by hook launch commands to locate `grep_nudge.py` (`kcoderag-dev/hooks/hooks.json`, `kcoderag-qa/hooks/hooks.json`).
- MCP endpoint and Bearer configuration lives in the corresponding `.mcp.json` files; names and values are intentionally not enumerated.

**Secrets location:**
- `kcoderag-dev/.mcp.json` and `kcoderag-qa/.mcp.json` exist and are treated as sensitive configuration; README states shared credentials are bundled. No secret values are reproduced.

## Webhooks & Callbacks

**Incoming:**
- Claude Code/Codex `PreToolUse` callbacks invoke the local hook through `kcoderag-dev/hooks/hooks.json` and `kcoderag-qa/hooks/hooks.json`.

**Outgoing:**
- Hook output is a host callback JSON object containing `hookSpecificOutput.additionalContext`; it nudges the host toward MCP tools and does not mutate files or block commands (`kcoderag-dev/hooks/grep_nudge.py`).

---

*Integration audit: 2026-08-20*
