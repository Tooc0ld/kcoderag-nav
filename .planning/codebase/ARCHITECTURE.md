<!-- refreshed: 2026-08-28 -->
# Architecture

**Analysis Date:** 2026-08-28

## System Overview

```text
npx kcoderag-nav@latest <install|status|doctor|update|uninstall>
        |
        v
CLI policy -> selected HostAdapter (read/render only) -> atomic transaction -> project-native files
        |                                                        |
        +-> status/doctor (read-only)                             +-> managed state/digests

Installed Codex/Claude launcher -> CJS advisory hook -> optional detached npm update worker
Installed Cursor project files  -> Rule + skill + MCP + afterMCPExecution marker
Installed OpenCode project files -> skill + MCP + tool.execute.after marker
Installed ZCode project files    -> skill + MCP + Pre/PostToolUse hooks
```

KCodeRag Nav is a Node.js project-integration package for Codex, Claude Code, Cursor, OpenCode,
and ZCode. The public composition root is one npm CLI. Every invocation selects exactly one host,
the adapter renders a complete desired state without writing, and the shared transaction is the
only installation filesystem writer.

The package contains two capabilities: `kcoderag-navigation` and `code-style-nudge`. Navigation
owns the `kcoderag`, `kcoderag-manage`, and `kcoderag-feedback` manual Skill trees; code style owns
`kcoderag-code-style` plus four references. All five hosts receive the manual trees. Only an exact
checked-in PASS receipt enables the native overlay, frozen to Claude Code `2.1.241`.

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Public npm CLI | Parses five commands, selects one host, confirms an exact project target, and emits stable output | `src/bin/kcoderag-nav.cts`, `src/cli/commands.cts` |
| Core contracts | Defines safe errors, target/state/status types, runtime checks, and managed-path validation | `src/core/` |
| Atomic transaction | Performs the only installation write, commits state last, and rolls back the selected host | `src/core/transaction.cts` |
| Host registry | Resolves exactly Codex, Claude Code, Cursor, OpenCode, or ZCode | `src/hosts/index.cts` |
| Host adapters | Detect and render host-native desired state without committing files | `src/hosts/` |
| Capability registry | Declares the two built-in manifests, providers, assets, and receipt-bound support policy | `src/capabilities/` |
| Advisory hook | Classifies structural search and eligible writes, emits bounded guidance, and fails open | `src/hooks/` |
| Update runtime | Reads a bounded local cache in foreground and refreshes npm latest in a detached worker | `src/hooks/update-check.cts`, `src/hooks/update-worker.cts` |
| Generator | Produces deterministic self-contained QA and Cursor assets from canonical templates | `src/generator/index.cts`, `plugin-src/` |
| Source diagnostics | Detects selected-host manual or active duplicates with secret-safe metadata | `src/core/`, `src/hosts/`, `src/cli/commands.cts` |
| Maintainer gates | Enforces dependency, generation, documentation, pack, scrub, and readiness contracts | `src/maintainer/` |
| Smoke harness | Acquires one actual package and proves lifecycle and loopback MCP evidence | `src/smoke/` |

## Pattern Overview

- One CLI invocation manages one host; project installations for different hosts can coexist.
- `install` composes `installed ∪ selected`; `update` defaults to installed capabilities; `uninstall`
  requires an explicit capability or `--all` in automation.
- Only current capability-scoped schema v1 is accepted. Retired environment-shaped or Python state
  has no migration, adoption, cleanup, or implicit conversion path.
- Every mutation deep-scans the selected host for manual or active duplicate sources before render.
  `status` and `doctor` remain read-only and expose only stable codes and safe paths.
- Canonical TypeScript and templates generate executable CJS and host assets. Installed execution
  requires Node.js 22+ only, with no runtime compiler or production dependency.
- Codex, Claude Code, and ZCode use advisory non-blocking hooks. Cursor intentionally uses an
  always-on Rule/skill/MCP model, and OpenCode uses a project plugin.
- Installed ownership is contributor-scoped, digest-backed, drift-aware, and recoverable without
  touching unrelated configuration.

## Layers

### Controller

`src/bin/` and `src/cli/` validate command policy, runtime, host selection, exact targets,
confirmation, and stable human/JSON output. They orchestrate reads and one transaction rather than
writing host files directly.

### Core

`src/core/` owns host-neutral contracts, path validation, state schema v1, composite digests,
mutation locks, project-root discovery, and transactional mutation. It does not import host-specific
modules.

### Providers

`src/hosts/` owns host-native roots, structured merge rules, source discovery, and desired-state
rendering. Adapters are read/render-only and return immutable plans to the transaction layer.

### Runtime Hooks

`src/hooks/` implements bounded parsing, structural-search guidance, receipt-gated code-style
guidance, one-time marker handling, successful-call markers, and offline update awareness. Every
host boundary catches malformed or unsupported input and exits successfully without blocking the
original operation.

### Build and Distribution

`src/generator/`, `plugin-src/`, generated QA/Cursor trees, and the root `package.json` form the
deterministic npm product. Generated trees are outputs, not independent maintenance sources. Root
marketplace catalogs and retired package trees are not installation surfaces.

### Assurance

`src/maintainer/`, `src/smoke/`, tests, local hooks, and CI prove dependency closure, deterministic
generation, exact package inventory, secret-safe diagnostics, five-host packaged lifecycle, and
readiness evidence.

## Data Flow

### Project Installation

1. The CLI validates Node.js 22+, flags, the exact project target, selected host, and requested
   capabilities.
2. The selected adapter reads current state and performs the selected-host source gate without
   exposing credential values.
3. Capability support and current-state integrity are preflighted before desired-state creation.
4. The adapter renders one complete immutable desired state for the requested final capability set.
5. `applyTransaction` verifies expected digests, stages bytes, commits state last, and restores the
   selected host on failure.
6. Output reports only stable codes and safe relative paths.

### Lookup Guidance and Update Awareness

1. Codex, Claude Code, or ZCode invokes a generated launcher for the relevant native hook event.
2. From session cwd, the launcher walks upward to the nearest selected-host managed state. A damaged
   nearest boundary fails open and never falls through to an outer project.
3. The dispatcher validates schema, composite digest, and every managed file digest before routing
   capability handlers.
4. Navigation emits bounded advice only for eligible structural searches. Manual code-style use is
   host-invoked; the automatic route additionally requires a supported receipt row, an eligible
   structured write, and a stable session identity.
5. The first eligible event may schedule a detached registry refresh; foreground execution reads
   local bounded state only.
6. Codex/Claude/ZCode `PostToolUse`, Cursor `afterMCPExecution`, and OpenCode
   `tool.execute.after` record the same secret-free bounded success marker.

## Host Projections

| Host | Managed project surface | Native behavior |
|------|-------------------------|-----------------|
| Codex | `.codex/`, `.agents/skills/` | advisory Pre/PostToolUse launchers and MCP projection |
| Claude Code | `.claude/settings.json`, `.claude/skills/`, root `.mcp.json` | advisory Pre/PostToolUse dispatcher and MCP projection |
| Cursor | `.cursor/rules/`, `.cursor/skills/`, `.cursor/mcp.json`, `.cursor/hooks.json` | always-on Rule/skill/MCP plus success marker |
| OpenCode | one root JSON/JSONC config and `.opencode/` | project plugin, skill, MCP, and after-event marker |
| ZCode | `.zcode/config.json`, `.zcode/skills/`, project hook runtime | project MCP/skill and advisory Pre/PostToolUse; trust remains user-controlled |

## Key Abstractions

**HostAdapter** declares host identity, managed roots, detection, rendering, and status methods. It
cannot commit files.

**DesiredState** is one complete immutable mutation plan for a selected host, including expected
digests and the state path.

**InstallState** is the exact schema-v1 ownership graph for capabilities, contributor-scoped files
and sections, originals, individual digests, and one composite digest.

**InstallError** is a stable secret-safe refusal with optional normalized path metadata.

**Generated product** is the byte-deterministic CJS, templates, skills, host configuration, and
launchers derived from canonical sources and the root package version.

## Architectural Constraints

- Only the shared transaction writes installation files.
- Every resolved path stays inside the explicit target and adapter-declared managed roots; traversal,
  symlinks, special files, and ambiguous ownership are rejected.
- MCP URL, authorization, headers, and connection bodies are opaque sensitive values and never enter
  diagnostics, documentation, tests, or receipts.
- Manual code-style selection is supported on all five hosts. An unsupported native decision renders
  no handler, dispatcher registration, launcher, or automatic reminder while preserving the Skill.
- Marker creation follows full managed-tree integrity verification; drift cannot consume a valid
  one-time reminder.
- OpenCode and ZCode are project-only. OpenCode rejects simultaneous JSON and JSONC roots. ZCode does
  not pre-authorize workspace trust.
- `docs/MCP_QA_EXPERIENCE_GUIDE.md` is the sole current experience guide. The sibling repository's
  former guide is only a one-time read-only import source and is not updated or bound into readiness.
- Phase 04.2 verifies exact `0.3.0` readiness against one frozen subject and one actual tgz. It does
  not tag, publish, refetch the registry, unpublish, or rewrite history.
- Phase 05 hook precision, Phase 06 authenticated true-host evidence, Phase 07 global GSD hooks, and
  Phase 08 identity/HTTPS/token rotation remain deferred.

## Anti-Patterns

### Treating local grep as the structural source of truth

Use the KCodeRag MCP graph for definitions, callers, and cross-language relationships; reserve local
search for exact strings and uncommitted edits.

### Making advisory hooks blocking or stateful

Hook parsing, lookup, marker, and update failures must produce no blocking result. Persistent state is
limited to bounded, secret-free cache and marker records with explicit ownership.

### Writing host files directly from adapters

Adapters only inspect and render. All installation mutation belongs to the transaction layer.

### Treating generated trees as canonical sources

Update TypeScript or `plugin-src/`, then regenerate and verify. Do not hand-maintain product output.

## Error Handling

- Expected CLI failures use stable `InstallError` codes and safe paths.
- Transaction failure restores the selected host; rollback failure keeps a private recovery tree and
  reports only its safe relative location.
- Hook and worker boundaries swallow operational failures, emit no diagnostic noise on protocol
  stdout, and never reject the original host operation.
- `status` and `doctor` are read-only; JSON mode emits exactly one parseable secret-safe value.

## Cross-Cutting Concerns

- Deterministic CJS and host assets aligned to the root package version.
- Narrow project ownership and unrelated configuration preservation.
- Secret-safe metadata-only evidence.
- Node 22/24 and Windows/Linux parity.
- Honest separation between packaged readiness and Phase 06 authenticated true-host evidence.

---

*Architecture analysis refreshed: 2026-08-28*
