# KCodeRag QA navigation assets

This generated tree contains the self-contained QA assets consumed by the
public `kcoderag-nav` project installer. It is not a standalone marketplace or checkout install
source. Users need Node.js 22 or newer and the public npm CLI; they do not need Python, a repository checkout,
or a runtime TypeScript compiler.

## Install QA into one project

QA is the only public environment. From the project that should receive KCodeRag navigation,
install one selected host:

```powershell
npx kcoderag-nav@latest install --host codex
npx kcoderag-nav@latest install --host claude
npx kcoderag-nav@latest install --host cursor
npx kcoderag-nav@latest install --host opencode
```

Without `--host`, the CLI interactively offers Codex, Claude Code, Cursor, and OpenCode. Automation passes
`--host codex|claude|cursor|opencode` and `--yes`. The target is exactly the current directory unless
`--target PATH` names another project. The CLI does not walk upward to a Git or SVN root. It shows
the normalized target before mutation and rejects filesystem roots, the user home, and host user
config, plugin, or cache roots.

One command manages and scans one host. Independent Codex, Claude Code, Cursor, and OpenCode QA installs can
coexist in the same project. Their native project locations are:

- Codex: `.codex/` and `.agents/skills/`.
- Claude Code: `.claude/settings.json`, `.claude/skills/`, and the KCodeRag section in root
  `.mcp.json`.
- Cursor: `.cursor/rules/`, `.cursor/skills/`, and the KCodeRag section in `.cursor/mcp.json`.
- OpenCode: one of `opencode.json`/`opencode.jsonc`, `.opencode/plugins/`, and `.opencode/skills/`.

## Five project lifecycle commands

Use the same public `@latest` entry throughout the lifecycle:

```powershell
npx kcoderag-nav@latest install --host codex
npx kcoderag-nav@latest status --host codex
npx kcoderag-nav@latest doctor --host codex
npx kcoderag-nav@latest update --host codex
npx kcoderag-nav@latest uninstall --host codex
```

- `install` creates or idempotently confirms the selected host's project-level QA install.
- `status` is a fast, read-only project health check. It reports installation, version, managed
  drift, update availability, and an active-source conflict summary.
- `doctor` is read-only and deep-scans the selected host's user-level plugin, raw MCP, manual Hook,
  cache, and disabled records. It also reports preinstall readiness when the project is not yet
  installed. There is no `doctor --fix`.
- `update` runs the complete source and ownership gates before changing the selected host's QA
  files. It never selects or restores Dev.
- `uninstall` removes only digest-proven project content. External duplicate sources do not block
  removal, but project drift still does.

`status` and `doctor` need no `--yes`; install, update, and uninstall confirm the exact target.
Install and update always perform the same deep source gate themselves. Drift, symlinks, special
files, unsafe targets, or ambiguous ownership stop before the first project write. A transaction
failure restores only the selected host.

## Source conflicts and controlled cleanup

User-level sources are classified by effect and ownership:

- An active plugin, raw MCP registration, or manual Hook produces `source_conflict` and `ok: false`
  and blocks install/update.
- One exactly owned legacy plugin or marketplace registration may produce a cleanup plan with a
  fixed native command and a canonical `sha256:` fingerprint.
- Cache residue and disabled records are informational doctor findings and do not block install.

Automation must replay the exact fingerprint shown by the current doctor or write gate:

```powershell
npx kcoderag-nav@latest update --host codex --target PATH --yes `
  --allow-owned-source-cleanup --cleanup-fingerprint sha256:<64-lowercase-hex>
```

`--yes` confirms only the project target. Cleanup begins only after a versioned capability
preflight and exact fingerprint match. The CLI then runs the fixed non-shell argv and requires a
complete post-removal plugin and marketplace rescan proving absence before any project write.

- Codex normally removes one exactly owned plugin with
  `codex plugin remove PLUGIN@MARKETPLACE --json`. The degraded fallback
  `codex plugin marketplace remove kcoderag-nav --json` is allowed only for the recognized,
  exclusive legacy `kcoderag-nav` marketplace registration when version/help schema, path
  provenance, and both list-failure attributions match.
- Claude Code normally uses
  `claude plugin uninstall PLUGIN@MARKETPLACE --scope user|project|local`. Marketplace removal is
  allowed only when complete plugin and marketplace inventories prove exclusive KCodeRag ownership
  at the exact scope, using
  `claude plugin marketplace remove MARKETPLACE --scope SCOPE`.
- Cursor has no assumed equivalent plugin CLI. Without a verified versioned native capability,
  cleanup remains manual-only.

Raw MCP, handwritten Hook, shared marketplace, multiple source, unknown path/name, incomplete
inventory, failed/timeout command, changed fingerprint, and any ambiguous observation remain
manual-only. Diagnostics expose stable codes and safe paths, never configuration values.

## Exact legacy Dev migration

Dev is not installable or selectable. An exact legacy QA/Dev state can be read only for a
digest-verified migration to QA or uninstall. Interactive install/update shows the Dev-to-QA
change and asks separately. Automation must add the independent authority:

```powershell
npx kcoderag-nav@latest update --host codex --target PATH --yes `
  --allow-legacy-dev-migration
```

This flag does not authorize user-source cleanup. Drift, partial state, extra owned content, or an
unknown owner stops before mutation.

## Navigation and host behavior

- `search_code`, `context`, `get_call_chain`, `list_indexes`, `cypher`, and `submit_feedback` come
  from the selected MCP server.
- Structural symbol and call-relation searches are nudged toward KCodeRag.
- Exact-string replacement and verification of current edits stay valid scoped local searches.
- Codex and Claude Code use an advisory, fail-open `PreToolUse` Hook. Hook failures never block the
  original Grep, Glob, or shell command.
- Cursor uses an always-on Rule, shared skill, and MCP configuration. It does not claim an
  equivalent `PreToolUse` Hook.
- Successful KCodeRag calls are recorded with secret-free, fail-open local markers: Codex and
  Claude Code use `PostToolUse`, Cursor uses `afterMCPExecution`, and OpenCode uses
  `tool.execute.after`. Marker files contain no arguments, results, URL, headers, or Bearer.
- On its first project-plugin load, OpenCode may prepare its matching `@opencode-ai/plugin`
  runtime under `.opencode/`. That host-owned cache can make the first start slower and is
  intentionally preserved by `kcoderag-nav uninstall`.

## QA routing

Use the installed KCodeRag QA service for graph lookup. If QA is unreachable, report
that state; local search remains an explicit fallback when the index is unavailable
or stale.

Codex and Claude Code Hook bootstrap starts at the session cwd and walks upward to the nearest
selected-host managed state. Root and deep sessions therefore use the same project; a nested
managed project wins. A damaged nearest state, incompatible version, or missing launcher is a
silent fail-open boundary and never falls through to an outer project. State and launcher
ownership use project-relative paths and digests, so a complete project copy, rename, move, or
drive change remains usable.

The CLI itself never performs this upward search: cwd and `--target` remain exact project targets.
After install or update, open a new Codex thread or Claude Code session, or run
**Developer: Reload Window** in Cursor.

## Update and evidence boundaries

Installed Codex and Claude Code Hooks run offline. On the first eligible event, the foreground
reads bounded local update state and may detach an npm Registry refresh; it never waits for network
I/O. Failures stay silent and fail-open. An update notice only suggests the selected-host command,
for example:

```powershell
npx kcoderag-nav@latest update --host codex
```

Phase 04 proves project lifecycle, source gates, pack contents, and Hook/Rule contracts. It does not
claim authenticated real-host MCP registration or graph-query success; that evidence belongs to a
later host-validation phase.

## Internal profile boundary

The internal QA profile is install-ready without separate credential entry. Its connection and
authorization values remain opaque: generation, installation, status, doctor, tests, logs, and
documentation must never print them. Production identity, HTTPS, and rotation remain a separate
security phase.
