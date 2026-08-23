<!-- refreshed: 2026-08-20 -->
# Architecture

**Analysis Date:** 2026-08-20

## System Overview

```text
 npx kcoderag-nav@latest <install|status|doctor|update|uninstall>
                              |
                    CLI policy + host registry
                              |
        +---------------------+---------------------+
        |                     |                     |
  Codex adapter        Claude Code adapter      Cursor adapter
 .codex/.agents       .claude + root .mcp     .cursor Rule/skill/MCP
        |                     |                     |
        +---------------------+---------------------+
                              |
                 validated desired state +
                 single-host atomic transaction
```

The Node.js project-integration runtime is the primary lifecycle architecture. Each command chooses
one adapter, adapters only inspect/render/status, and the host-neutral transaction is the normal
filesystem writer. Cursor's separately authorized legacy user-local migration is the one explicit
cross-boundary capability; it preflights exact ownership and journals compensation before deletion.

The environment package/marketplace tree below remains during the ordered Phase 03.1 retirement
and generation migration, but it is no longer the architectural seam for the unified CLI.

```text
                       kcoderag-nav marketplace
                    `.claude-plugin/marketplace.json`
                                  |
                 +----------------+----------------+
                 |                                 |
          Dev plugin package                 QA plugin package
          `kcoderag-dev/`                    `kcoderag-qa/`
                 |                                 |
     MCP registration/config                 MCP registration/config
     permissions + README                   permissions + README
                 |                                 |
       shared navigation behavior per environment
       skill + PreToolUse lookup-nudge hook + tests
```

This repository is a plugin distribution repository, not the KCodeRag parser or MCP
server implementation. It packages two environment-specific Claude Code/Codex plugin
variants that point to internal MCP services and teach agents graph-first navigation.

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Public npx CLI | Parses five lifecycle commands, confirmation, target and one host | `src/bin/kcoderag-nav.cts`, `src/cli/commands.cts` |
| Host registry | Resolves exactly Codex, Claude Code, or Cursor | `src/hosts/index.cts` |
| Codex adapter | Owns project Codex configuration, skill, CJS hook and state | `src/hosts/codex.cts` |
| Claude Code adapter | Owns project settings hook, root MCP key, skill, payload and state | `src/hosts/claude.cts` |
| Cursor adapter | Owns project Rule/skill/MCP/state and authorized user-local migration | `src/hosts/cursor.cts` |
| Atomic transaction | Validates digests, stages all files, commits state last, and rolls back | `src/core/transaction.cts` |
| Marketplace manifest | Publishes the two plugin names, local sources, and descriptions | `.claude-plugin/marketplace.json` |
| Dev package | Dev MCP permission scope and navigation assets | `kcoderag-dev/` |
| QA package | QA MCP permission scope and navigation assets | `kcoderag-qa/` |
| MCP permission policy | Allows only the package's environment-qualified MCP namespace | `kcoderag-dev/settings.json`, `kcoderag-qa/settings.json` |
| Hook registration | Runs the advisory lookup hook before search tools | `kcoderag-dev/hooks/hooks.json`, `kcoderag-qa/hooks/hooks.json` |
| Lookup hook | Detects likely structural searches and emits guidance; fails open | `kcoderag-dev/hooks/grep_nudge.py`, `kcoderag-qa/hooks/grep_nudge.py` |
| Navigation skill | Defines graph-first search/context/call-chain workflow | `kcoderag-dev/skills/code-lookup-discipline/SKILL.md`, `kcoderag-qa/skills/code-lookup-discipline/SKILL.md` |
| Explorer agent | Provides read-only graph-first exploration instructions (Dev package) | `kcoderag-dev/agents/kcode-explorer.md` |

## Pattern Overview

**Overall:** Environment-specific plugin packaging with shared graph-first navigation policy.

**Key Characteristics:**
- The marketplace is the composition root; each plugin is independently installable.
- Dev and QA are parallel packages with separate MCP namespace permissions and endpoint configuration files (`kcoderag-dev/.mcp.json`, `kcoderag-qa/.mcp.json`).
- Hooks are advisory and non-blocking. Structural lookup is redirected toward MCP tools, while exact text/local edit searches remain local.
- Runtime behavior is implemented by host plugin systems; this repository contains configuration, prompts, and a standard-library Python hook rather than a server runtime.

## Layers

**Distribution layer:**
- Purpose: Declare installable plugin products.
- Location: `.claude-plugin/marketplace.json`
- Contains: Owner, marketplace name, plugin source paths, descriptions.
- Depends on: The two package directories.

**Plugin configuration layer:**
- Purpose: Bind each package to its MCP server and host permissions.
- Location: `kcoderag-dev/.mcp.json`, `kcoderag-dev/settings.json`, `kcoderag-qa/.mcp.json`, `kcoderag-qa/settings.json`
- Contains: Environment-specific MCP registration and allow-list namespace.
- Used by: Claude Code/Codex plugin host.

**Agent guidance layer:**
- Purpose: Encode graph-first lookup workflow and tool selection.
- Location: `*/skills/code-lookup-discipline/SKILL.md`, `kcoderag-dev/agents/kcode-explorer.md`
- Contains: Search decision table, fallback rules, and exploration role instructions.
- Used by: Agents operating after plugin installation.

**Hook layer:**
- Purpose: Detect structural search intent and add non-blocking guidance.
- Location: `*/hooks/hooks.json`, `*/hooks/grep_nudge.py`
- Contains: PreToolUse matcher and parser/heuristics for Grep, Glob, Bash, and common shell search commands.
- Used by: Claude Code/Codex hook runner.

## Data Flow

### Plugin Installation and Lookup Guidance

1. The host reads `.claude-plugin/marketplace.json` and resolves a selected package source.
2. Package MCP configuration and permissions are loaded from the selected `kcoderag-*/.mcp.json` and `settings.json`.
3. For `Grep`, `Glob`, or `Bash`, the host invokes the registered PreToolUse command in `kcoderag-*/hooks/hooks.json`.
4. `grep_nudge.py` parses tool input, suppresses mechanical/local-file cases, and emits `additionalContext` recommending `search_code`, `context`, or `get_call_chain`.
5. The hook exits successfully with no output for malformed input or non-structural searches, preserving fail-open behavior.

**State Management:** The repository has no application database or persistent runtime state. Hook state is per invocation; package configuration is static. MCP service state lives outside this repository.

## Key Abstractions

**Host adapter:**
- Purpose: Declare a host's managed roots and pure detect/render/status behavior without writing.
- Examples: `src/hosts/codex.cts`, `src/hosts/claude.cts`, `src/hosts/cursor.cts`.
- Pattern: Narrow structured-section ownership plus exclusive files, exact state digests, and one
  registry-selected desired state per CLI invocation.

**Cursor legacy migration:**
- Purpose: Replace a verified retired user-local plugin with project-native Cursor integration.
- Pattern: Independent removal authority, exact file/directory/tree/profile preflight, private
  journal/backup, allow-listed deletion, and compensating restoration of both trees.

**Environment package:**
- Purpose: Keep Dev and QA MCP permissions, instructions, hooks, and documentation independently installable.
- Examples: `kcoderag-dev/`, `kcoderag-qa/`
- Pattern: Parallel directory trees with environment-specific names and MCP namespaces.

**Structural lookup heuristic:**
- Purpose: Classify a local search as symbol/navigation-oriented.
- Examples: `kcoderag-dev/hooks/grep_nudge.py`, `kcoderag-qa/hooks/grep_nudge.py`
- Pattern: Pure functions normalize command input, apply regex/token rules, then produce optional hook JSON.

## Entry Points

**Marketplace entry point:**
- Location: `.claude-plugin/marketplace.json`
- Triggers: `codex plugin marketplace add` or Claude marketplace installation.
- Responsibilities: Resolve `kcoderag-dev` and `kcoderag-qa` source directories.

**Hook entry point:**
- Location: `kcoderag-dev/hooks/grep_nudge.py` or `kcoderag-qa/hooks/grep_nudge.py`
- Triggers: Host `PreToolUse` event for `Grep`, `Glob`, or `Bash`.
- Responsibilities: Read JSON stdin, classify lookup patterns, write optional JSON stdout, and fail open.

## Architectural Constraints

- **Runtime ownership:** MCP servers and graph data are external; do not add parser/database behavior to this package repository.
- **Environment isolation:** Dev permissions use the Dev-qualified MCP namespace and QA permissions use the QA-qualified namespace (`kcoderag-dev/settings.json`, `kcoderag-qa/settings.json`).
- **Hook safety:** Hook errors, malformed JSON, and unsupported commands must return success without blocking the user's tool call (`*/hooks/grep_nudge.py`).
- **Secret boundary:** Environment MCP configuration files exist at `kcoderag-dev/.mcp.json` and `kcoderag-qa/.mcp.json`; treat their contents as sensitive and never expose credentials.
- **Duplication boundary:** Dev and QA assets intentionally mirror one another; changes to behavior should be synchronized and tested in both package trees.

## Anti-Patterns

### Treating local grep as the structural source of truth

**What happens:** Agents use local text search for definitions, callers, or cross-language relationships.
**Why it's wrong:** The package is designed to route structural questions to the indexed KCodeRag MCP graph.
**Do this instead:** Follow `*/skills/code-lookup-discipline/SKILL.md`; use `search_code`, `context`, and `get_call_chain`, then local search only for exact strings or uncommitted edits.

### Making the hook blocking or stateful

**What happens:** Hook classification failure prevents a search command or stores mutable process state.
**Why it's wrong:** The hook is explicitly advisory and must remain fail-open.
**Do this instead:** Keep `hook_output()` and `main()` pure/short-lived and preserve the success exit path in `*/hooks/grep_nudge.py`.

## Error Handling

**Strategy:** Fail open at the hook boundary; configuration/installation errors are delegated to the host.

**Patterns:**
- `main()` catches malformed input and returns exit code 0 in `*/hooks/grep_nudge.py`.
- `hook_output()` returns `None` for absent or invalid `tool_input`.
- Advisory output is emitted only when a structural lookup heuristic matches.

## Cross-Cutting Concerns

**Logging:** No application logging; hook communicates through optional JSON stdout.
**Validation:** Unit-style hook tests cover command parsing and classification in `kcoderag-dev/hooks/test_grep_nudge.py` and `kcoderag-qa/hooks/test_grep_nudge.py`.
**Authentication:** MCP authentication/credentials are configured externally through each package's `.mcp.json`; values are not documented here.

---

*Architecture analysis: 2026-08-20*
