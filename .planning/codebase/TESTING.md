# Testing Patterns

**Analysis Date:** 2026-08-28

## Test Framework

- Node's built-in test runner executes compiled CommonJS under `dist-tests/`.
- Assertions use `node:assert/strict`; no third-party test or mocking framework is required.
- `npm test` runs compiled tests with controlled concurrency because repository-level tests create
  temporary roots and exercise index/build invariants.
- There is no Python test path.

## Primary Commands

```bash
npm run build
npm test
npm run test:scrub-baseline
npm run test:brand-audit
npm run test:pack
npm run test:smoke
npm run docs:check
npm run ci:local
```

Focused scripts are used while iterating; completion gates build first and then run the full relevant
contract inventory.

## Test Organization

- `tests/core/` — target, state, digest, lock, transaction, rollback, and project-root behavior.
- `tests/cli/` — command flags, host/capability selection, confirmation, and stable output.
- `tests/capabilities/` — registry, provider contributions, support receipts, and composition.
- `tests/generator/` — canonical byte generation and exact product inventories.
- `tests/hooks/` — protocol parsing, navigation/code-style handlers, launchers, markers, and updates.
- `tests/hosts/` — Codex, Claude Code, Cursor, OpenCode, and ZCode lifecycle/isolation.
- `tests/migration/` — current hard-stop behavior for retired/manual sources; no migration authority.
- `tests/maintainer/` — dependencies, docs, scrub, brand, pack, evidence, readiness, and workflow gates.
- `tests/smoke/` — actual-package lifecycle and evidence serialization.
- `tests/skills/` — canonical Skill structure, rule partition, and E01–E15 behavior.

Source files use `*.test.cts`; compilation mirrors them as `*.test.cjs` under `dist-tests/`.

## Fixtures and Test Seams

- Temporary directories and Git repositories provide real byte-level fixtures.
- Host adapters accept injected target/package/home roots; transaction tests inject stage/commit/
  rollback failures and compare complete pre/post trees.
- Update code accepts injected clocks, fetchers, spawners, and cache roots while source tests prove
  foreground zero-network behavior.
- Launcher tests spawn real `.cmd` and `.sh` entry points from root, deep, Unicode, spaced, moved,
  nested, and damaged-nearest working directories.
- Pre-commit tests use an independent `GIT_INDEX_FILE` and compare index bytes, staged blob OIDs, and
  unstaged working bytes.
- Scrub tests preserve private staged/unstaged/untracked canaries and reject overlap, unsafe targets,
  unexpected committed paths, or changed unrelated state.
- Pack tests create an actual npm tgz and validate member names/content, package identity, forbidden
  runtime content, and repository preservation.

## Coverage Types

### Unit

Pure parsers, validators, capability tables, support receipts, update-cache validation, archive
policies, and result-state classification use table-driven tests.

### Integration

Temporary projects exercise five-host install/status/doctor/update/uninstall, JSON/TOML/section merge
boundaries, cross-host coexistence, capability independence, source conflicts, drift, locks, and full
rollback.

### Package and Smoke

One acquired tgz is installed into isolated projects. Required smoke exercises project lifecycle,
registered runtime handlers, fail-open behavior, marker recording, update awareness, unsupported
code-style zero-write behavior, and loopback MCP evidence across the required host matrix.

### CI and Readiness

- `.github/workflows/ci.yml` repeats required gates on Windows/Linux with Node 22/24.
- Readiness binds one frozen Git subject/tree to one actual `0.3.0` tgz and five-host packaged
  outcomes.
- Tag, publish, registry refetch, and authenticated real-host queries are not Phase 04.2 PASS checks.

## Error and Safety Assertions

- Stable error codes and safe paths are asserted instead of raw subprocess/configuration bodies.
- MCP credentials, URLs, headers, arguments, and results never appear in test names, snapshots,
  receipts, or diagnostics.
- Preflight failures require zero writes; injected transaction failures require exact restoration.
- Unsupported capability selections fail before desired-state render while existing navigation stays
  healthy.
- Hook malformed/oversized/unsupported cases exit successfully without protocol noise.
- `NOT_RUN` remains non-success for required evidence and is never coerced to `PASS`.

## Coverage Tracking

There is no line-coverage target. Coverage is tracked through plan acceptance criteria, table-driven
matrices, lifecycle/smoke receipts, verification artifacts, and GSD summary coverage metadata.

## Deferred Evidence

- Phase 05 owns navigation precision and honest routing refinements.
- Phase 06 owns authenticated service queries and OpenCode/ZCode true-host admission/version evidence.
- Phase 07 owns global GSD hook/runtime persistence.
- Phase 08 owns production identity, transport, rotation, and release compatibility evidence.

---

*Testing analysis refreshed: 2026-08-28*
