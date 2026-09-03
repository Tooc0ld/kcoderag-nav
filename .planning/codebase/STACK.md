# Technology Stack

**Analysis Date:** 2026-08-28

## Languages

- **TypeScript (`.cts`)** — canonical CLI, transaction, host adapters, hooks, capability providers,
  generator, maintainer tools, smoke harness, and tests.
- **CommonJS (`.cjs`)** — compiled user and maintainer runtime in `dist/`, compiled tests in
  `dist-tests/`, and self-contained generated hook payloads.
- **JSON/TOML/Markdown/shell** — host-native MCP/settings, compatibility manifests, Skills, Rules,
  launchers, documentation, and workflow configuration.

Python is not part of the current runtime, build, test, migration, or installation path.

## Runtime

- Node.js 22+ is the only user runtime.
- Node 22 and 24 are required CI lines on Windows and Linux.
- TypeScript compiles `.cts` to directly executable `.cjs`; there is no `ts-node` or runtime
  compilation.
- Public executable: `dist/bin/kcoderag-nav.cjs`, exposed as the `kcoderag-nav` npm bin.
- Root `package.json` is the single version, script, and package inventory source.
- `package-lock.json` pins the audited development-only dependency graph.

## Frameworks and Protocols

- **Model Context Protocol (MCP)** — projects the external KCodeRag QA navigation service into each
  selected host's native configuration.
- **Host adapters** — Codex, Claude Code, Cursor, OpenCode, and ZCode implement one shared
  read/render-only interface while the host-neutral transaction owns writes.
- **Node built-in test runner** — compiled `dist-tests/**/*.test.cjs` covers unit, integration,
  lifecycle, pack, smoke, and release-readiness contracts.
- **npm/npx** — acquires the package and exposes five project lifecycle commands. Marketplace
  catalogs are not a distribution surface.

## Dependencies

### Runtime

- No npm production dependencies; runtime uses Node built-ins only.
- The KCodeRag QA MCP service is external and supplies graph lookup tools.

### Development

- TypeScript and Node 22 declarations, plus their lockfile-pinned transitive type package.
- Dependency names, versions, integrity hashes, edges, lifecycle scripts, and production closure are
  checked by the maintainer audit. Any drift requires re-audit.

## Configuration and Generated Products

- `src/hosts/` declares five project-scoped host integrations.
- `src/core/transaction.cts` is the only installation filesystem commit boundary.
- `plugin-src/` is the canonical deterministic template/config source for
  `kcoderag-navigation` and `code-style-nudge`.
- The public manual Skill trees are exactly `kcoderag`, `kcoderag-manage`, `kcoderag-feedback`,
  and `kcoderag-code-style`; Codex metadata uses quoted `agents/openai.yaml` values.
- `kcoderag-qa/` and `kcoderag-cursor/` are generated products, not independent sources.
- MCP configuration may contain credentials; values are never inspected for documentation,
  diagnostics, snapshots, or receipts.

## Host Configuration Surfaces

| Host | Project configuration |
|------|-----------------------|
| Codex | `.codex/`, `.agents/skills/` with four Skills and metadata |
| Claude Code | `.claude/settings.json`, `.claude/skills/` with four Skills, root `.mcp.json` |
| Cursor | `.cursor/rules/`, four `.cursor/skills/` trees, `.cursor/mcp.json`, `.cursor/hooks.json` |
| OpenCode | exactly one root JSON/JSONC config plus four Skills under `.opencode/` |
| ZCode | `.zcode/config.json`, four `.zcode/skills/` trees, project navigation hook runtime |

## Build and Assurance

- TypeScript 6 compiles source and tests via `tsconfig.json` and `tsconfig.tests.json`.
- Deterministic generator checks compare canonical sources with generated assets byte-for-byte.
- Pack audit creates and inspects an actual npm tgz against a closed inventory.
- Required CI uses immutable action pins, `npm ci --ignore-scripts`, dependency audit, build, tests,
  generation, documentation, pack, and readiness policy gates.
- Phase 04.2 verifies exact `0.3.0` five-host readiness against one frozen subject and one actual tgz;
  no tag, publish, or registry refetch occurs in scope.

## Platform Requirements

- Node.js 22+ and npm/npx on Windows or Linux.
- At least one supported project host: Codex, Claude Code, Cursor, OpenCode, or ZCode.
- Network access for initial npm acquisition and the internal QA MCP service.
- Installed hooks run offline and update checks fail open.

---

*Stack analysis refreshed: 2026-08-28*
