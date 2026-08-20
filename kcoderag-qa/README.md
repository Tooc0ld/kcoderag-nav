# KCodeRag QA navigation plugin

KCodeRag QA packages its internal MCP endpoint, a graph-first code-navigation
skill, and a non-blocking lookup hook for both Claude Code and Codex.

## Credentials

The shared QA Bearer credential is bundled in this internal plugin,
so installation requires no additional credential setup. Rotate the bundled value and
bump the plugin version together when the credential changes.

## Recommended project install

From the marketplace repository, install into a trusted target project:

```powershell
python scripts/manage_project_install.py install --target PATH --environment qa
```

The project installer writes only managed files under the target project's `.codex/`
and `.agents/` directories.

## Environment selection

QA and Dev plugins are mutually exclusive. Install exactly one environment at a time.

| Installed plugin | Query environment |
|---|---|
| QA | QA |
| Dev | Dev |

If the installed KCodeRag environment is unreachable, report it instead of querying
the other environment. Local search remains an explicit fallback when the index is
unavailable or stale.

## Optional user-level Codex install

```powershell
codex plugin marketplace add Tooc0ld/kcoderag-nav
codex plugin add kcoderag-qa@kcoderag-nav
```

This optional path is user-level. Codex does not currently provide a native
project-scoped plugin installation command. Current plugin manifests do not enforce
conflicts, so uninstall or disable the other KCodeRag environment before using this path.

## Install in Claude Code

```text
/plugin marketplace add Tooc0ld/kcoderag-nav
/plugin install kcoderag-qa@kcoderag-nav
```

## Behavior

- `search_code`, `context`, `get_call_chain`, `list_indexes`, `cypher`, and
  `submit_feedback` come from the selected MCP server.
- Structural symbol and call-relation searches are nudged toward KCodeRag.
- Exact-string replacement and verification of uncommitted edits stay local.
- Hook failures are advisory and fail open; they never block a command.

## Update awareness and application

A push to `master` does not replace an already installed plugin cache. An older install
without the checker must be manually refreshed once before it can detect later releases.

The checker runs lazily on the first relevant `PreToolUse` (`Grep`, `Glob`, or `Bash`)
for a session. It consumes that session before bounded I/O, reuses a strict 24-hour
remote-version cache across sessions, and silently fails open on every network, schema,
lock, or cache error. A notice is advisory only: it asks for user confirmation and does
not update automatically.

The primary path for ordinary marketplace users is the native host CLI. These commands
run from any directory and do not require a repository checkout:

```powershell
codex plugin marketplace upgrade kcoderag-nav --json
codex plugin add kcoderag-qa@kcoderag-nav --json

claude plugin marketplace update kcoderag-nav
claude plugin update kcoderag-qa@kcoderag-nav --scope project
```

With a checkout of this repository, the optional repository-checkout safety wrapper
provides the same ordered operations with stable failure output:

```powershell
python scripts/update_plugin.py --host codex --environment qa
python scripts/update_plugin.py --host claude --environment qa
```

Project-installed updates still require a repository checkout. Update it and then
refresh the managed files without changing environments:

```powershell
git pull --ff-only
python scripts/manage_project_install.py update --target PATH
```

Start a new Codex thread or Claude session after a successful update. QA and Dev remain
mutually exclusive; switching environments still requires uninstalling the current one.

The endpoint currently uses internal HTTP plus the bundled shared Bearer credential and
is intended for the current QA network only. The credential value is
not printed by the generator or installer.
