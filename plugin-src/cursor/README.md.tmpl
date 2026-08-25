# KCodeRag Nav for Cursor

This generated tree is the Cursor asset set consumed by the public `kcoderag-nav` project
installer. It supplies one QA MCP configuration, a graph-first navigation skill, and an always-on
Cursor Rule. It is not a standalone marketplace or user-directory install source.

## Install QA into one project

Use Node.js 22 or newer. From the exact target project, run:

```powershell
npx kcoderag-nav@latest install --host cursor
```

Without `--host`, the CLI can interactively select Cursor. Automation passes `--host cursor --yes`.
The target is exactly the current directory unless `--target PATH` names another project; the CLI
does not walk to a Git or SVN root. It displays the normalized target before mutation and rejects
filesystem roots, the user home, and host user config, plugin, or cache roots.

The Cursor adapter owns only declared files and the KCodeRag section under `.cursor/rules/`,
`.cursor/skills/`, and `.cursor/mcp.json`. It preserves unrelated Cursor configuration and never
modifies Codex or Claude Code installs in the same project.

## Five project lifecycle commands

```powershell
npx kcoderag-nav@latest install --host cursor
npx kcoderag-nav@latest status --host cursor
npx kcoderag-nav@latest doctor --host cursor
npx kcoderag-nav@latest update --host cursor
npx kcoderag-nav@latest uninstall --host cursor
```

- `status` is a fast, read-only project health check for install state, version, drift, update, and
  active source conflicts.
- `doctor` is read-only and deep-scans Cursor user-level plugin, raw MCP, manual Rule, cache, and
  disabled records. It reports preinstall readiness when QA is not installed and has no `--fix`.
- Install/update run the same complete source gate before writing. Uninstall removes only
  digest-proven project content and still refuses project drift.

QA is the only public environment. Independent Cursor, Codex, and Claude Code QA installs can
coexist. All mutations stop before writing on drift, unsafe paths, symlinks, special files, or
ambiguous ownership, and a failed transaction restores only Cursor.

## Cursor source and legacy boundaries

An active Cursor plugin, raw MCP registration, or manual Rule is `source_conflict` with `ok: false`.
Cache and disabled records are informational. Cursor does not assume an equivalent native plugin
cleanup CLI: without a verified versioned capability, user-level cleanup remains manual-only, and
the project installer never edits unknown user configuration.

When an old Cursor user-directory installation is detected, the adapter first verifies its exact
managed tree and digests. Removing that verified legacy tree requires a separate interactive
confirmation or this automation authority:

```powershell
npx kcoderag-nav@latest install --host cursor --yes --allow-legacy-user-removal
```

`--yes` confirms only the project target. Drift, extra files, invalid state, or refusal leaves the
legacy tree and project unchanged.

Dev is not installable. Exact project legacy Dev state can only be migrated to QA or uninstalled
after complete digest validation and separate authorization:

```powershell
npx kcoderag-nav@latest update --host cursor --target PATH --yes `
  --allow-legacy-dev-migration
```

Legacy migration authority does not authorize raw/manual source cleanup.

## Cursor capability boundary

Cursor receives graph-first routing through its always-on Rule and shared skill, and calls the
configured QA MCP server directly. It does not use or claim a Codex/Claude Code-style `PreToolUse`
Hook. Exact strings, current edits, and an unavailable or stale index remain valid reasons to use
scoped local search.

The CLI treats cwd and `--target` as exact project targets. Cursor has no Hook ancestor walk to
emulate; its Rule, skill, and MCP files move with a complete project copy or rename. After install
or update, restart Cursor or run **Developer: Reload Window**.

## Evidence and internal profile boundaries

Phase 04 proves the project lifecycle, source gate, Cursor Rule/skill/MCP package, and transaction
contract. It does not claim authenticated real-Cursor MCP tool registration or graph-query success.

The internal QA profile is install-ready without separate credential entry. Connection and
authorization values remain opaque and are never printed by generation, installation, status,
doctor, tests, logs, or documentation.
