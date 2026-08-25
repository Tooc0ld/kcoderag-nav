# KCodeRag QA navigation assets

This generated tree contains the self-contained QA assets consumed by the
public `kcoderag-nav` project installer. It is not a standalone marketplace or checkout install
source. Use Node.js 22 or newer and the public npm CLI.

## Install

QA is the only public environment. Install it into one selected host with:

```powershell
npx kcoderag-nav@latest install --host codex
npx kcoderag-nav@latest install --host claude
npx kcoderag-nav@latest install --host cursor
```

Without `--host`, the CLI interactively offers Codex, Claude Code, and Cursor. Automation should
pass `--host codex|claude|cursor` and `--yes`. The target defaults to the current directory; use
`--target PATH` to choose another project. Every mutation displays the normalized absolute target
before confirmation and manages only the selected host.

The hosts use their native project locations:

- Codex: `.codex/` and `.agents/skills/`.
- Claude Code: `.claude/settings.json`, `.claude/skills/`, and the KCodeRag section in root
  `.mcp.json`.
- Cursor: `.cursor/rules/`, `.cursor/skills/`, and the KCodeRag section in `.cursor/mcp.json`.

Independent QA installations for different hosts can coexist in the same project. Exact legacy
Dev state is accepted only for an explicitly authorized, digest-verified migration to QA or
uninstall; Dev is not installable or selectable.

## Lifecycle

Use the same public `@latest` entry for every lifecycle command:

```powershell
npx kcoderag-nav@latest install --host codex
npx kcoderag-nav@latest status --host codex
npx kcoderag-nav@latest doctor --host codex
npx kcoderag-nav@latest update --host codex
npx kcoderag-nav@latest uninstall --host codex
```

`status` and `doctor` are read-only. Update and
uninstall refuse drift, symlinks, special files, and ambiguous ownership before any project write;
failed transactions restore the selected host without touching the other hosts.

After install or update, open a new Codex thread or Claude Code session, or reload the Cursor
window. A first `npx` acquisition failure cannot write the project because the CLI has not started.

## Behavior

- `search_code`, `context`, `get_call_chain`, `list_indexes`, `cypher`, and `submit_feedback` come
  from the selected MCP server.
- Structural symbol and call-relation searches are nudged toward KCodeRag.
- Exact-string replacement and verification of uncommitted edits stay local.
- Codex and Claude Code use an advisory, fail-open `PreToolUse` hook. Hook failures never block the
  original command.
- Cursor uses an always-on Rule, shared skill, and MCP configuration; it does not claim an
  equivalent `PreToolUse` hook.

## QA routing

Use the installed KCodeRag QA service for graph lookup. If QA is unreachable, report
that state; local search remains an explicit fallback when the index is unavailable
or stale.

## Update awareness

The installed Codex and Claude Code hooks run offline. On the first eligible event in a session,
the foreground path reads only bounded local update state and may schedule a detached npm Registry
refresh. It never waits for network I/O. Network, cache, lock, schema, or worker failures silently
fail open. An available update is advisory and points to:

```powershell
npx kcoderag-nav@latest update
```

## Internal profile boundary

The internal QA connection profile includes its shared Bearer credential, so QA testing requires
no additional credential setup. The value remains opaque: generation,
installation, status, diagnostics, tests, and documentation must never print it.
