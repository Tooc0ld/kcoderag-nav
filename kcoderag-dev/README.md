# KCodeRag Dev navigation plugin

KCodeRag Dev packages its internal MCP endpoint, a graph-first code-navigation
skill, and a non-blocking lookup hook for both Claude Code and Codex.

## Credentials

The shared DEV Bearer credential is bundled in this internal plugin,
so installation requires no additional credential setup. Rotate the bundled value and
bump the plugin version together when the credential changes.

## Recommended project install

From the marketplace repository, install into a trusted target project:

```powershell
python scripts/manage_project_install.py install --target PATH --environment dev
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
codex plugin add kcoderag-dev@kcoderag-nav
```

This optional path is user-level. Codex does not currently provide a native
project-scoped plugin installation command. Current plugin manifests do not enforce
conflicts, so uninstall or disable the other KCodeRag environment before using this path.

## Install in Claude Code

```text
/plugin marketplace add Tooc0ld/kcoderag-nav
/plugin install kcoderag-dev@kcoderag-nav
```

## Behavior

- `search_code`, `context`, `get_call_chain`, `list_indexes`, `cypher`, and
  `submit_feedback` come from the selected MCP server.
- Structural symbol and call-relation searches are nudged toward KCodeRag.
- Exact-string replacement and verification of uncommitted edits stay local.
- Hook failures are advisory and fail open; they never block a command.

The endpoint currently uses internal HTTP plus the bundled shared Bearer credential and
is intended for the current DEV network only. The credential value is
not printed by the generator or installer.
