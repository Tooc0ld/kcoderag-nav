# KCodeRag Nav for Cursor

This generated tree is the Cursor asset set consumed by the public `kcoderag-nav` project
installer. It supplies one KCodeRag MCP configuration, a graph-first navigation skill, and an
always-on Cursor Rule. It is not a standalone marketplace or user-directory install source.

## Install

Use Node.js 22 or newer. From the target project, install the default QA environment with:

```powershell
npx kcoderag-nav@latest install --host cursor
```

Dev is only for development and testing and must be selected explicitly:

```powershell
npx kcoderag-nav@latest install --host cursor --environment dev
```

Without `--host`, the CLI interactively offers Codex, Claude Code, and Cursor. Automation should
pass `--host cursor --yes`. The target defaults to the current directory; use `--target PATH` to
select another project. Before a mutation, the CLI displays the normalized absolute target and
manages only Cursor in that project.

The Cursor adapter owns only its declared files and KCodeRag section under `.cursor/rules/`,
`.cursor/skills/`, and `.cursor/mcp.json`. It preserves unrelated Cursor configuration and never
modifies Codex or Claude Code installations in the same project.

## Lifecycle and environment switching

Use the public `@latest` entry for the complete lifecycle:

```powershell
npx kcoderag-nav@latest install --host cursor
npx kcoderag-nav@latest status --host cursor
npx kcoderag-nav@latest doctor --host cursor
npx kcoderag-nav@latest update --host cursor
npx kcoderag-nav@latest uninstall --host cursor
```

QA and Dev are mutually exclusive within Cursor, and the installer never switches them
automatically. Explicitly uninstall the current environment before installing the other one.
Cursor may still coexist with independently managed Codex and Claude Code installations.

`status` and `doctor` are read-only. Update and uninstall refuse drift, symlinks, special files,
and ambiguous ownership before any write. A failed transaction restores Cursor without touching
the other hosts. After install or update, restart Cursor or run **Developer: Reload Window**.

## Legacy user-directory migration

When the adapter detects an old Cursor user-directory installation, it first verifies the exact
managed tree and digests. Removing that verified legacy tree requires a separate interactive
confirmation, or this explicit automation authority:

```powershell
npx kcoderag-nav@latest install --host cursor --yes --allow-legacy-user-removal
```

`--yes` confirms only the project target and never grants legacy deletion authority. Drift, extra
files, an invalid legacy state, or refusal of the separate prompt leaves both the user directory
and target project unchanged.

## Cursor capability boundary

Cursor receives graph-first routing through its always-on Rule and shared skill, and calls the
configured MCP server directly. It does not use or claim a Codex/Claude Code-style `PreToolUse`
hook. Exact strings, current edits, and an unavailable or stale index remain valid reasons to use
scoped local search.

The internal profile bundles the current QA/Dev testing credential. Its value stays opaque and is
never printed by generation, installation, status, diagnostics, tests, or documentation.
