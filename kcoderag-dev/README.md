# kcoderag-nav — kcoderag-dev plugin

A Claude Code plugin (the **Dev-environment** entry in the `kcoderag-nav`
marketplace) that nudges Claude to prefer the **KCodeRag MCP** tools over
`grep`/`Glob` when looking up code, and auto-registers the KCodeRag Dev MCP server
on install.

The MCP server address and auth token are built in — everyone on the internal
network who can reach the Dev server gets zero-config install.

## What it does

- **Auto-registers the MCP server** (`.mcp.json`) — the Dev server
  (`http://10.11.184.143:8020/mcp`) with its Bearer token is pre-configured. No
  `claude mcp add` needed.
- **PreToolUse hook** (`hooks/grep_nudge.py`) — when you `Grep`/`Glob` for a symbol
  or call relation, it injects a non-blocking tip to use the MCP tools instead. It
  never blocks; it only advises (exit 0, no deny).
- **`kcode-explorer` agent** — an MCP-first exploration agent.
- **`code-lookup-discipline` skill** — decision table for MCP vs grep.
- **Pre-allows `mcp__kcoderag-dev__*`** (`settings.json`) — no permission prompts.

The registered MCP server is named `kcoderag-dev`, so its tools are
`mcp__kcoderag-dev__search_code`, `mcp__kcoderag-dev__get_call_chain`,
`mcp__kcoderag-dev__context`, `mcp__kcoderag-dev__list_indexes`,
`mcp__kcoderag-dev__cypher`.

## Install

```
/plugin marketplace add Tooc0ld/kcoderag-nav
/plugin install kcoderag-dev@kcoderag-nav --scope user
```

The first command registers the **marketplace** (`kcoderag-nav` — the store). The
second installs the **plugin** (`kcoderag-dev` — the Dev-environment plugin from
that marketplace). You add the marketplace once; other plugins from the same
marketplace (e.g. `kcoderag-qa`) just need `/plugin install <name>@kcoderag-nav`.

Use `--scope user` to enable it across all your projects, or `--scope project` to
enable it only in the current project.

Because the `.mcp.json` carries the internal Dev server address and token, install
is zero-config for anyone who can reach `10.11.184.143:8020` (i.e. anyone on the
internal network with access to the Dev box). External users who clone this repo
cannot connect — the address is internal-only.

## Python dependency (for the nudge hook)

The hook runs `python "$CLAUDE_PLUGIN_ROOT/hooks/grep_nudge.py"`. It needs a
`python` on PATH (standard library only — no packages to install).

- **Windows**: `python` is the norm — works as-is.
- **macOS / Linux**: if you only have `python3`, edit `hooks/hooks.json`
  and change `python` → `python3`.

## Verify it works

1. After install, ask Claude to find a symbol by name and watch it use
   `mcp__kcoderag-dev__search_code` first.
2. If you deliberately `Grep` for a bare symbol like `KPlayer::GetLevel`, you
   should see a tip suggesting the MCP tools (non-blocking — the grep still runs).
3. `mcp__kcoderag-dev__*` calls should not prompt for permission (pre-allowed).

## Hook behavior detail

`grep_nudge.py` nudges only when the pattern looks like a symbol/call-relation
lookup — a bare identifier (`getPlayerInfo`), a C++-qualified name
(`KPlayer::GetLevel`), or a pattern containing keywords like `function`/`class`/
`method`. It stays silent for exact-string and bulk-replace greps (e.g.
`foo.bar.*`, `s/old/new/g`), so it never gets in the way of mechanical text work.

## Repo layout (multi-plugin marketplace)

This repo IS the marketplace (`kcoderag-nav`). Each plugin lives in its own
subdirectory; the root `.claude-plugin/marketplace.json` is the catalog:

```
kcoderag-nav/                       ← marketplace root
  .claude-plugin/marketplace.json   ← catalog (lists all plugins)
  kcoderag-qa/                      ← QA-environment plugin
  kcoderag-dev/                      ← this plugin (Dev environment)
    .claude-plugin/plugin.json
    .mcp.json  hooks/  agents/  skills/  settings.json  README.md
```

To add another plugin (e.g. `kcoderag-prod`): copy the `kcoderag-dev/` directory to
`kcoderag-prod/`, change its `.mcp.json` to the prod server URL, add one entry to
the root `marketplace.json` (`{ "name": "kcoderag-prod", "source": "./kcoderag-prod" }`),
commit, push. Users then `/plugin install kcoderag-prod@kcoderag-nav` — no need to
re-add the marketplace.

## Security note

The `.mcp.json` embeds the internal Dev server URL and a Bearer token
(`kcoderag-dev-token-2026`). This is intentional for zero-config install, on the
assumption that the repo audience overlaps with the internal network audience.
The server address is internal-only, so a leaked token is not usable from outside.
If the token is ever rotated, update `.mcp.json` and push a new version.
