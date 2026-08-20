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

## Environment routing

| Installed environments | User intent | Query environments |
|---|---|---|
| QA | No environment specified | QA |
| Dev | No environment specified | Dev |
| QA + Dev | No environment specified | QA |
| QA | Explicit QA | QA |
| Dev | Explicit Dev | Dev |
| QA + Dev | Explicit QA | QA |
| QA + Dev | Explicit Dev | Dev |
| QA + Dev | Explicit environment comparison | QA + Dev |

Choose the route before issuing a graph query. If any selected environment is
unreachable, report that environment explicitly and do not query another environment
as a fallback.

## Optional user-level Codex install

```powershell
codex plugin marketplace add Tooc0ld/kcoderag-nav
codex plugin add kcoderag-qa@kcoderag-nav
```

This optional path is user-level. Codex does not currently provide a native
project-scoped plugin installation command.

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

The endpoint currently uses internal HTTP plus the bundled shared Bearer credential and
is intended for the current QA network only. The credential value is
not printed by the generator or installer.
