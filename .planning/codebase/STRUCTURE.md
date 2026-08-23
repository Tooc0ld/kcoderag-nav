# Codebase Structure

**Analysis Date:** 2026-08-23

## Directory Layout

```text
kcoderag-nav/
├── package.json                    # Node 22+ CJS build, test, and public bin contract
├── src/
│   ├── bin/                        # Compiled CLI entry source
│   ├── core/                       # Host-neutral target, state, and atomic transaction core
│   ├── maintainer/                 # Dependency and repository maintenance audits
│   └── tracer/                     # Proven Codex QA npx vertical slice
├── tests/
│   ├── core/                       # Compiled shared-core and rollback matrix
│   ├── maintainer/                 # Compiled supply-chain contract tests
│   └── tracer/                     # Compiled npx tracer tests
├── .claude-plugin/                 # Marketplace metadata
│   └── marketplace.json
├── kcoderag-dev/                   # Dev environment plugin
│   ├── agents/                     # Explorer agent prompt
│   ├── hooks/                      # PreToolUse registration, implementation, tests
│   ├── skills/code-lookup-discipline/ # Graph-first navigation skill
│   ├── .mcp.json                   # Dev MCP registration (sensitive configuration)
│   ├── settings.json               # Dev MCP permission allow-list
│   └── README.md                   # Installation and behavior documentation
├── kcoderag-qa/                    # QA environment plugin (parallel layout)
│   ├── hooks/
│   ├── skills/code-lookup-discipline/
│   ├── .mcp.json                   # QA MCP registration (sensitive configuration)
│   ├── settings.json
│   └── README.md
└── .planning/codebase/             # Generated architecture maps
```

## Directory Purposes

**`.claude-plugin/`:** Marketplace composition metadata. Key file: `.claude-plugin/marketplace.json`.

**`src/core/`:** Host-neutral Node.js core. `contracts.cts` defines safe schemas,
`project-target.cts` validates the exact explicit target and adapter roots, `state.cts` creates
validated desired state without writing, and `transaction.cts` is the only core filesystem
mutator. All `.cts` maintenance sources compile to directly executable `.cjs`.

**`tests/core/`:** Node built-in tests for target/runtime/status contracts, digest preflight,
state-last commits, injected staging/commit failures, complete rollback, and retained recovery
evidence when rollback itself fails.

**`kcoderag-dev/`:** Installable Dev plugin. It contains the Dev MCP permission namespace, hook implementation, navigation skill, explorer agent, and user-facing install documentation.

**`kcoderag-qa/`:** Installable QA plugin. It mirrors the Dev package while targeting QA MCP configuration and permissions.

**`*/hooks/`:** Host hook declarations and Python implementation. `hooks.json` registers `grep_nudge.py`; `test_grep_nudge.py` verifies behavior.

**`*/skills/code-lookup-discipline/`:** Host-discoverable `SKILL.md` instructions for selecting graph tools over local search.

**`.planning/codebase/`:** Destination for generated codebase maps; keep architecture/structure documents here.

## Key File Locations

**Entry Points:**
- `src/bin/kcoderag-nav.cts`: TypeScript maintenance source for the public compiled CJS bin.
- `.claude-plugin/marketplace.json`: Marketplace and plugin source entry point.
- `kcoderag-dev/hooks/grep_nudge.py`: Dev hook process entry point.
- `kcoderag-qa/hooks/grep_nudge.py`: QA hook process entry point.

**Configuration:**
- `kcoderag-dev/.mcp.json`, `kcoderag-qa/.mcp.json`: Environment MCP registration; contents are sensitive.
- `kcoderag-dev/settings.json`, `kcoderag-qa/settings.json`: Environment-specific MCP permission allow-lists.
- `kcoderag-dev/hooks/hooks.json`, `kcoderag-qa/hooks/hooks.json`: PreToolUse registration.

**Core Logic:**
- `src/core/contracts.cts`, `src/core/project-target.cts`, `src/core/state.cts`, and
  `src/core/transaction.cts`: Shared host-neutral installation boundary and sole write engine.
- `kcoderag-dev/hooks/grep_nudge.py` and `kcoderag-qa/hooks/grep_nudge.py`: Search command tokenization, local-scope suppression, symbol heuristics, and advisory JSON generation.
- `*/skills/code-lookup-discipline/SKILL.md`: Agent-facing lookup policy.

**Testing:**
- `tests/core/transaction.test.cts`
- `kcoderag-dev/hooks/test_grep_nudge.py`
- `kcoderag-qa/hooks/test_grep_nudge.py`

## Naming Conventions

**Files:**
- Kebab-case or responsibility-based `.cts` names for TypeScript maintenance sources; compiled
  output mirrors these paths as `.cjs` under ignored `dist/` and `dist-tests/` roots.
- Lowercase snake_case for Python (`grep_nudge.py`, `test_grep_nudge.py`).
- Conventional host filenames for plugin metadata (`settings.json`, `hooks.json`, `.mcp.json`, `SKILL.md`, `README.md`).
- Uppercase Markdown maps under `.planning/codebase/` (`ARCHITECTURE.md`, `STRUCTURE.md`).

**Directories:**
- Environment packages use `kcoderag-dev` and `kcoderag-qa`.
- Host capability directories use lowercase plural names (`hooks`, `agents`, `skills`).
- Skill names use kebab-case (`code-lookup-discipline`).

## Where to Add New Code

**New environment plugin:**
- Add a package directory parallel to `kcoderag-dev/` and `kcoderag-qa/`.
- Register it in `.claude-plugin/marketplace.json`.
- Provide its own `.mcp.json`, `settings.json`, `README.md`, `hooks/`, and `skills/` as needed.

**New hook behavior:**
- Implement in both environment hook files when behavior is shared: `kcoderag-dev/hooks/grep_nudge.py` and `kcoderag-qa/hooks/grep_nudge.py`.
- Update both registrations only when event/matcher behavior changes: `*/hooks/hooks.json`.
- Add mirrored tests in `kcoderag-dev/hooks/test_grep_nudge.py` and `kcoderag-qa/hooks/test_grep_nudge.py`.

**New agent guidance:**
- Add a host skill under `*/skills/<kebab-case-name>/SKILL.md`.
- Add an agent prompt under `*/agents/` only for role-specific behavior; keep general policy in skills.

**Documentation:**
- Update the relevant package `README.md` for installation or user-visible behavior.
- Put generated architecture maps in `.planning/codebase/`.

## Special Directories

**`.claude-plugin/`:** Marketplace metadata; hand-maintained and committed.

**`.planning/codebase/`:** Generated analysis artifacts; committed according to project planning workflow.

**`*/hooks/__pycache__/`:** Python bytecode cache may appear locally; generated and should not be treated as source.

**`*/.codex-plugin/`:** Present in the working tree as untracked plugin metadata directories; treat as user/agent work and do not overwrite without explicit scope.

**`*/.mcp.json`:** Environment integration configuration; existence is noted, but credentials and endpoint values must not be copied into documentation.

---

*Structure analysis: 2026-08-23*
