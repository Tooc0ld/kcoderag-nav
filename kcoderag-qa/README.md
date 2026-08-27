# KCodeRag QA capability assets

This generated tree contains self-contained QA assets consumed by the public
`kcoderag-nav` project installer. It is not a marketplace or checkout install source. Users need
Node.js 22 or newer; they do not need Python, a repository checkout, a runtime TypeScript compiler,
or production npm dependencies.

The package exposes exactly two built-in capabilities:

- `kcoderag-navigation` provides the QA MCP projection and graph-first guidance on five hosts.
  All five hosts receive a successful-call marker and offline
  update notice.
- `jx3-style-nudge` provides a short structured pre-write advisory and the canonical
  `$jx3-code-style-correction` Skill where exact host evidence supports native delivery.

QA is the only public environment for MCP. Capabilities are not environment choices. Retired QA/Dev
state, Python installs, handwritten MCP/Hook, plugins, and other manual sources have no migration,
adoption, or automatic cleanup path in the current CLI.

## Install capabilities into one project

Interactive use selects one host and then one or more capabilities:

```powershell
npx kcoderag-nav@latest install
```

Automation repeats `--capability` and confirms the exact target:

```powershell
npx kcoderag-nav@latest install --host codex --capability kcoderag-navigation --yes
npx kcoderag-nav@latest install --host claude --capability kcoderag-navigation `
  --capability jx3-style-nudge --yes
npx kcoderag-nav@latest install --host cursor --capability kcoderag-navigation --yes
npx kcoderag-nav@latest install --host opencode --capability kcoderag-navigation --yes
npx kcoderag-nav@latest install --host zcode --capability kcoderag-navigation --yes
```

The target is exactly the current directory unless `--target PATH` names another project. The CLI
does not walk upward to a Git or SVN root. It rejects filesystem roots, user home, and host user
config/plugin/cache roots. One invocation manages one host, so independent host capability sets can
coexist in the same project.

Native project locations are `.codex/` plus `.agents/skills/` for Codex;
`.claude/settings.json`, `.claude/skills/`, and root `.mcp.json` for Claude Code;
`.cursor/rules/`, `.cursor/skills/`, `.cursor/mcp.json`, and `.cursor/hooks.json` for Cursor; and one
`opencode.json`/`opencode.jsonc` plus `.opencode/plugins/` and `.opencode/skills/` for OpenCode; and
`.zcode/config.json` plus `.zcode/skills/` for ZCode.

## Exact support matrix

JX3 support comes only from checked-in digest-bound receipts. ZCode navigation currently has
project adapter-contract and synthetic lifecycle coverage; real-host evidence remains Phase 06:

| Frozen host row | Navigation | JX3 nudge | Evidence verdict |
| --- | --- | --- | --- |
| Codex `0.146.1` | supported | unsupported | exact `UNSUPPORTED` |
| Claude Code `2.1.241` | supported | supported | exact `PASS`, native model-visible pre-write |
| Cursor `3.17.8` | supported | unsupported | exact `UNSUPPORTED` |
| OpenCode `1.18.23` | supported | unsupported | exact `UNSUPPORTED` |
| ZCode (real-host version pending) | supported | unsupported | no JX3 PASS receipt; exact refusal |

Unlisted versions do not inherit JX3 support. Selecting JX3 on an unsupported host returns
`host_version_unsupported` before desired-state rendering or transaction work and writes nothing;
an existing navigation install stays healthy.

## Five project lifecycle commands

```powershell
npx kcoderag-nav@latest install --host claude --capability kcoderag-navigation
npx kcoderag-nav@latest status --host claude
npx kcoderag-nav@latest doctor --host claude
npx kcoderag-nav@latest update --host claude
npx kcoderag-nav@latest uninstall --host claude --capability kcoderag-navigation
```

- `install` composes `installed ∪ selected`. Repeating an identical clean selection is a byte- and
  mtime-stable no-op and never removes an unselected installed capability.
- `status` is a fast, read-only report for every capability on the selected host.
- `doctor` is a read-only deep scan of capability state and selected-host user sources. It also
  works before install and has no `--fix` mode.
- `update` targets every installed capability by default; repeated `--capability ID` flags filter
  that installed set.
- `uninstall` requires an interactive choice, explicit `--capability ID`, or explicit `--all`.
  It never defaults to removing everything.

Every mutation preflights the complete selected set and commits one host transaction. One
unsupported capability, conflict, or drift makes the entire request fail with zero writes; there
is no partial success. `status` and `doctor` need no `--yes`, while mutation commands confirm the
exact target. `--json` emits one stable secret-safe JSON value.

## Source conflicts and integrity

An active plugin, raw MCP registration, manual Hook/Rule, retired Python install, or ambiguous
source produces `source_conflict` with `ok: false`. The same gate runs before install, update, and
uninstall, before provider access, adapter rendering, or transaction work. The CLI reports stable
codes, source types, scopes, and safe paths only. Every such source is manual-only: the current CLI
does not migrate, adopt, edit, invoke native removal for, or automatically clean it.

Current state accepts only exact capability-scoped schema v1. It binds a sorted capability set,
per-capability file/section contributors, individual digests, restorable originals, and one
canonical composite digest. Unknown or missing owners, digest mismatch, symlink, special file,
unsafe target, or ambiguous ownership stops before the first write. Shared files are recomposed
from remaining contributors and restore their original bytes only after the final contributor is
removed.

JX3 also enforces complete D-15 runtime integrity before claiming its once marker: the nearest
state, composite digest, and every managed file digest must match. A missing or edited Skill,
reference, handler, dispatcher, launcher, or registration is silent and fail-open, leaves the
marker unclaimed, and appears as `capability_drift` in status/doctor. There is no embedded fallback
rule summary.

## Navigation and host behavior

- The QA MCP exposes `search_code`, `context`, `get_call_chain`, `list_indexes`, `cypher`, and
  `submit_feedback`.
- Codex and Claude Code navigation is advisory and fail-open. Only the exact supported Claude row
  adds JX3 to the native `PreToolUse` dispatcher.
- Cursor uses an always-on Rule, shared navigation Skill, MCP, `postToolUse` update notice, and
  `afterMCPExecution` success marker. It does not claim equivalent JX3 `PreToolUse` delivery.
- OpenCode uses a project plugin and MCP. Its toast and `tool.execute.after` event do not claim
  model-visible pre-write delivery.
- ZCode uses project MCP and `hooks.events` with `hooks.enabled: true` in `.zcode/config.json` plus a workspace Skill. Its
  advisory, fail-open `PreToolUse` adds navigation/update context and its `PostToolUse` records
  success; neither hook claims JX3 pre-write delivery.
- Successful calls write bounded secret-free markers: Codex/Claude Code use `PostToolUse`, Cursor
  uses `afterMCPExecution`, OpenCode uses `tool.execute.after`, and ZCode uses project `PostToolUse`.

## QA routing

Use the installed KCodeRag QA service for graph lookup. If QA is unreachable, report
that state; local search remains an explicit fallback when the index is unavailable
or stale.

Codex and Claude Code launchers start at the session cwd and select the nearest host-specific
managed state. A damaged or incompatible nearest state is a silent fail-open boundary and never
falls through to an outer project. State uses relative paths and digests, so a complete project
move, rename, copy, or drive change remains usable. CLI cwd and `--target` are always exact; only
the runtime launcher walks upward.

## JX3 once marker and manual D-19 reset

JX3 considers only structured Write/Edit/MultiEdit/apply_patch-style calls with a reliable target,
a frozen C/C++/Lua extension, and a non-empty `session_id`, `thread_id`, or `conversation_id`. It is
silent for shell, delete/rename-only, unknown-path, or unstable-identity events. One host session,
project boundary, and capability can claim at most one notice.

Claims live in the operating-system cache directory `kcoderag-nav/nudges` (normally
`%LOCALAPPDATA%\kcoderag-nav\nudges` on Windows or
`${XDG_CACHE_HOME:-$HOME/.cache}/kcoderag-nav/nudges` on Linux). To reset them manually:

1. Close every related Codex, Claude Code, Cursor, and OpenCode session.
2. Delete the whole `kcoderag-nav/nudges` directory with an operating-system file tool.
3. Open only the host sessions you need.

Closing sessions first prevents a live process from recreating a claim. `status` and `doctor` are
read-only and never remove the directory. There is no sixth public cleanup command. Directory,
capacity-pruning, or deletion failures are fail-open and never block the original host action.

## Update and evidence boundaries

All five hosts share an offline foreground update checker. It reads bounded local state and may
detach an npm Registry refresh, but never waits for the network or updates automatically. Codex
and Claude Code add a known notice to eligible context, Cursor returns `additional_context`, and
OpenCode displays a warning toast; ZCode adds the same short notice through project `PreToolUse`.
Each session/project cycle is deduplicated and every failure is silent. The notice only suggests an
explicit update command such as `npx kcoderag-nav@latest update --host zcode`. This follows ZCode's official
[MCP](https://zcode.z.ai/en/docs/mcp-services), [Skill](https://zcode.z.ai/en/docs/skill), and
[Hook](https://zcode.z.ai/en/docs/hooks) contracts.

Phase 04.1 packed evidence covers the complete supported Claude dual-order lifecycle and exact
unsupported-host zero-write refusal while navigation remains usable. Authenticated real-host MCP
query evidence remains Phase 06 work; offline or loopback checks do not claim that result.

Connection and authorization values remain opaque. Generation, install, status, doctor, tests,
receipts, logs, and documentation expose metadata only. Production identity, HTTPS, and rotation
remain a separate security phase.

## Historical Phase 04 record — not current instructions

For immutable audit traceability only, Phase 04 used
`--allow-owned-source-cleanup --cleanup-fingerprint sha256:<64-lowercase-hex>` with the reviewed
commands `codex plugin remove PLUGIN@MARKETPLACE --json`,
`codex plugin marketplace remove kcoderag-nav --json`,
`claude plugin uninstall PLUGIN@MARKETPLACE --scope user|project|local`, and
`claude plugin marketplace remove MARKETPLACE --scope SCOPE`, followed by a complete post-removal
rescan. Phase 04.1 removed those authorities and the QA/Dev migration decoder. These strings are
historical evidence, not current cleanup, migration, or uninstall guidance.
