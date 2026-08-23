# Testing Patterns

**Analysis Date:** 2026-08-24

## Test Framework

**Runner:**
- Node's built-in test runner executes compiled CommonJS under `dist-tests/`.
- `npm test` uses `--test-concurrency=1` because some repository-level immutability tests must not
  race other suites that intentionally create short-lived root fixtures.
- Legacy Python tests remain only as temporary parity/retirement inputs.

**Assertions:**
- `node:assert/strict`; no third-party test framework or mocking package.

**Primary commands:**
```bash
npm run build
npm test
npm run test:launcher
npm run test:precommit
npm run test:pack
npm run test:ci-contract
npm run ci:local
```

## Test Organization

- Sources mirror production areas under `tests/core/`, `tests/cli/`, `tests/generator/`,
  `tests/hooks/`, `tests/hosts/`, `tests/maintainer/`, `tests/migration/`, and `tests/tracer/`.
- Files use responsibility-based `*.test.cts`; compilation mirrors them as `*.test.cjs`.
- Test modules import compiled `dist/**/*.cjs`, so clean verification always builds first.

## Fixtures and Seams

- Temporary directories and temporary Git repositories provide real byte-level fixtures.
- Host adapters accept injected target/package roots; transaction tests inject commit/rollback
  failures and compare complete pre/post trees.
- Update logic accepts injected clocks, spawners, and transports while foreground zero-network
  behavior is also asserted from source.
- Launcher tests spawn the actual `.cmd` on Windows and `.sh` on POSIX (including Git sh on the
  Windows development host) from Unicode paths and nested working directories.
- Pre-commit tests use an independent `GIT_INDEX_FILE` and compare full index bytes, staged blob
  OIDs, and unstaged working bytes.
- Pack tests create a real temporary npm tgz and validate tar entries, manifest versions, forbidden
  runtime content, and repository preservation.

## Coverage Types

**Unit:**
- Pure parsers, routing tables, update-cache validation, archive policies, and result-state
  classification use table-driven cases.

**Integration:**
- Temporary projects exercise install/status/update/uninstall for Codex, Claude Code, and Cursor,
  JSON/TOML merge boundaries, cross-host coexistence, legacy migration, and rollback.
- Compiled subprocess tests verify the public bin, hook protocol, self-relative launchers,
  generator CLI, documentation audits, pre-commit gate, and pack audit.

**E2E/CI contract:**
- `npm run ci:local` runs build, exact dependency audit, all Node tests, repository generation
  check, and the real tarball audit.
- `.github/workflows/ci.yml` repeats those gates on Windows/Linux with Node 22/24; ordinary push/PR
  jobs have no publish token or publish step.
- Honest three-host loopback smoke is assigned to Plan 03.1-06 and is not counted as Plan 05 PASS.

## Error and Safety Assertions

- Stable error codes and safe relative paths are asserted instead of raw subprocess/config bodies.
- Secret-bearing MCP values are never used in test names, snapshots, diagnostics, or artifacts.
- Failure matrices require zero writes before preflight completion and exact restoration after
  injected transaction failures.
- Required checks treat failures and unavailable evidence as non-success; optional/live evidence
  must use explicit three-state results.

## Coverage Tooling

- No line-coverage target is configured. Behavioral coverage is tracked through plan acceptance
  criteria, table matrices, integration receipts, and GSD summary coverage metadata.

---

*Testing analysis: 2026-08-24*
