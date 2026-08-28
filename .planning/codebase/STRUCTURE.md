# Codebase Structure

**Analysis Date:** 2026-08-28

## Directory Layout

```text
kcoderag-nav/
├── package.json                     # Node 22+ build, scripts, package inventory, public bin
├── package-lock.json                # Audited development dependency graph
├── src/
│   ├── bin/                         # Compiled CLI entry source
│   ├── cli/                         # Command policy, confirmation, host dispatch, output
│   ├── capabilities/                # Two built-in capability contracts/providers/registry
│   ├── core/                        # Host-neutral target, state, locks, transaction, diagnostics
│   ├── fixtures/                    # Host delivery evidence capture/verification
│   ├── generator/                   # Deterministic QA/Cursor product renderer
│   ├── hooks/                       # Advisory dispatch, guidance, markers, update runtime
│   ├── hosts/                       # Codex, Claude, Cursor, OpenCode, ZCode adapters
│   ├── maintainer/                  # Dependency, docs, scrub, pack, readiness, release gates
│   └── smoke/                       # One-package five-host lifecycle/MCP smoke harness
├── tests/                           # Mirrored compiled Node test sources
├── plugin-src/
│   ├── capabilities/                # Canonical navigation and code-style Skill assets
│   ├── hooks/                       # Host launcher/registration templates
│   └── README.md.tmpl               # Generated package guidance source
├── kcoderag-qa/                     # Deterministic generated QA product tree
├── kcoderag-cursor/                 # Deterministic generated Cursor product tree
├── docs/
│   └── MCP_QA_EXPERIENCE_GUIDE.md  # Sole current installation/experience authority
├── .github/workflows/               # Required CI and separately authorized release workflow
├── .githooks/pre-commit             # Node-based index-safe repository gate
└── .planning/                        # Project context, roadmap, phase artifacts, codebase maps
```

Compiled `dist/` and `dist-tests/` trees are local build outputs. They are package/test inputs but not
canonical maintenance sources.

## Directory Responsibilities

### `src/core/`

Defines host-neutral contracts, exact target validation, schema-v1 install state, managed-path safety,
source diagnostics, mutation locks, and the only installation filesystem transaction. It must not
import host-specific modules.

### `src/hosts/`

Contains pure read/render/status adapters and the fixed host registry. Each adapter owns native project
paths and structured merge rules; it returns one immutable desired state and never commits files.

### `src/capabilities/`

Declares `kcoderag-navigation` and `code-style-nudge`, their package-relative assets, logical section
contributions, provider registry, and receipt-bound support checks. Host adapters retain native paths.

### `src/hooks/`

Owns bounded advisory classification, dispatcher composition, one-time code-style markers,
successful-call markers, session cleanup policy, local update-cache reads, and detached refresh work.
Protocol boundaries always fail open.

### `src/generator/` and `plugin-src/`

Render sorted deterministic product bytes from canonical templates, compiled CJS, package version,
and opaque connection inputs. Generated trees must never become competing maintenance sources.

### `src/maintainer/`

Implements exact dependency, generated-tree, documentation, retirement, scrub-baseline, brand, pack,
evidence, readiness, and release-policy gates. Repository-only compiled tools are excluded from the
public package inventory where declared.

### `src/smoke/`

Acquires one actual tgz into temporary projects and exercises install/status/doctor/update/uninstall,
host runtime handlers, markers, update awareness, source conflicts, rollback, and loopback MCP evidence
for all required hosts.

### `tests/`

Mirrors production areas with `*.test.cts`. Tests import compiled `dist/**/*.cjs`, so clean verification
always builds first. Temporary projects and repositories provide real filesystem/Git boundaries.

## Key File Locations

### Entry Points

- `src/bin/kcoderag-nav.cts` — public CLI source.
- `src/cli/commands.cts` — five-command orchestration.
- `src/hosts/index.cts` — five-host adapter registry.
- `src/generator/index.cts` — deterministic asset generator.
- `src/smoke/host-smoke.cts` — package lifecycle smoke runner.
- `src/maintainer/release-readiness.cts` — local readiness contract.

### Core Logic

- `src/core/contracts.cts` — public host/command/status types and stable errors.
- `src/core/state.cts` — schema-v1 capability ownership and composite digest validation.
- `src/core/transaction.cts` — state-last atomic commit and rollback.
- `src/core/project-root.cts` — nearest managed-state launch contract.
- `src/core/source-diagnostics.cts` — selected-host duplicate-source reporting.

### Capability and Hook Logic

- `src/capabilities/registry.cts` — frozen built-in capability registry.
- `src/capabilities/code-style-nudge.cts` — code-style provider contributions.
- `src/hooks/pre-tool-dispatcher.cts` — bounded capability handler composition.
- `src/hooks/grep-nudge.cts` — navigation classification.
- `src/hooks/code-style-nudge.cts` — eligible-write advisory behavior.
- `src/hooks/once-marker.cts` and `src/hooks/mcp-call-marker.cts` — bounded secret-free markers.

### Assurance

- `src/maintainer/pre-commit.cts` — index-safe local gate.
- `src/maintainer/pack-audit.cts` — exact actual-tgz audit.
- `src/maintainer/brand-audit.cts` — closed-family path/content scanner.
- `src/maintainer/scrub-baseline.cts` — dirty-worktree preservation contract.
- `docs/MCP_QA_EXPERIENCE_GUIDE.md` — repository-owned current guide.

## Naming Conventions

- TypeScript source: kebab-case `.cts`; tests: `*.test.cts`; emitted files: matching `.cjs` paths.
- Functions/locals: `camelCase`; exported interfaces/types: `PascalCase`; constants:
  `SCREAMING_SNAKE_CASE`.
- Host-native asset names remain unchanged unless the canonical generator and every consumer are
  updated together.
- Capability IDs are `kcoderag-navigation` and `code-style-nudge`; Skill name is
  `code-style-correction`.

## Where to Add New Code

### New host adapter

Add a pure adapter under `src/hosts/`, register it in `src/hosts/index.cts`, declare only project
roots/sections, and add lifecycle, source-gate, isolation, rollback, pack, and smoke coverage. Keep
writes in the shared transaction.

### New capability

Add its contract/provider under `src/capabilities/`, canonical assets under `plugin-src/capabilities/`,
host contributions through adapter render, and complete composition/lifecycle/integrity tests. A new
public capability changes the closed product contract and requires explicit planning.

### New hook behavior

Implement bounded pure behavior under `src/hooks/`, compose it through the dispatcher, and cover
malformed input, time/size bounds, fail-open behavior, launcher protocols, and supported host evidence.

### Documentation changes

Update `README.md` for the public overview and `docs/MCP_QA_EXPERIENCE_GUIDE.md` for authoritative
installation/experience behavior. Do not update or synchronize an external guide.

## Special Boundaries

- `.planning/` is managed by GSD; planned docs scrubs must preserve unrelated dirty/untracked work.
- MCP configuration values are sensitive even when their files are package inputs.
- `.github/workflows/release.yml` is not authority to publish during readiness-only work.
- Root marketplace catalogs and retired environment package trees must not be restored.

---

*Structure analysis refreshed: 2026-08-28*
