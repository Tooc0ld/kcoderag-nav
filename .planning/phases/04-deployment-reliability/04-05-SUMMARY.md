---
phase: 04-deployment-reliability
plan: 05
subsystem: selected-host-source-diagnostics
tags: [nodejs, codex, source-diagnostics, sha256, native-cleanup, secret-safety]

requires:
  - phase: 04-deployment-reliability/04-04
    provides: project-relative selected-host ownership and rootless managed Hook discovery
provides:
  - immutable secret-safe source findings with fast, deep, and mutation-gate scan modes
  - truthful source_conflict health for status and doctor plus no-write install/update gates
  - capability-gated Codex native cleanup with exact argv, SHA-256 authority, timeout, and complete rescan
  - exact degraded recognition for the known stale kcoderag-nav marketplace registration
affects: [04-06, 04-08, claude-source-diagnostics, cursor-source-diagnostics, deployment-smoke]

actuals:
  tokens: 71772
  tasks: 3
  commits: 7

tech-stack:
  added: []
  patterns:
    - closed metadata-only source findings with deterministic code-unit ordering
    - native capability observations separated from fingerprint-bound cleanup authority
    - fast/deep/gate scan modes with full post-cleanup rescan before project rendering

key-files:
  created:
    - src/hosts/user-sources.cts
    - tests/hosts/user-sources.test.cts
  modified:
    - src/core/contracts.cts
    - src/core/state.cts
    - src/hosts/host-adapter.cts
    - src/cli/commands.cts
    - src/hosts/codex.cts
    - tests/cli/commands.test.cts
    - tests/hosts/codex.test.cts

key-decisions:
  - "Codex cleanup capability is established only by a supported runtime version, exact native help/list schemas, complete inventory, and fixed non-shell argv; documentation is never execution authority."
  - "Owned cleanup requires both a dedicated flag and the exact freshly calculated SHA-256 fingerprint, then a complete successful native rescan before any project render or transaction."
  - "The degraded Codex route is closed to the exact kcoderag-nav marketplace name, normalized known legacy path/provenance, attributable dual-list failure, and marketplace-remove argv; every ambiguity is manual-only."
  - "Status is a bounded fast active-conflict view, doctor is deep and always read-only, and install/update independently run the full selected-host no-write gate."

patterns-established:
  - "Metadata reduction: adapters classify only names, paths, ownership identifiers, scope, and enabled state; URLs, headers, Bearers, config bodies, and process bodies never enter public findings."
  - "Authority freezing: canonical sorted safe plan bytes produce a SHA-256 fingerprint that binds host, capability, inventory schema, fixed argv, scope, and timeout."
  - "Native-before-project boundary: successful external cleanup is not trusted until complete plugin and marketplace inventories rescan cleanly."

requirements-completed: [DEP-03]

coverage:
  - id: D1
    description: "Closed immutable findings represent active, informational, owned, raw, manual, and ambiguous selected-host sources without serializing secret-bearing values."
    requirement: DEP-03
    verification:
      - kind: unit
        ref: "tests/hosts/user-sources.test.cts; npm test (238/238)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Status, doctor, install, update, and uninstall use the required fast/deep/gate/project-only boundaries and expose truthful source_conflict health without unintended writes."
    requirement: DEP-03
    verification:
      - kind: integration
        ref: "tests/cli/commands.test.cts; npm test (238/238)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Codex normal and exact degraded source inventories permit only fingerprint-authorized fixed native cleanup and require a complete clean post-removal rescan."
    requirement: DEP-03
    verification:
      - kind: e2e
        ref: "tests/hosts/codex.test.cts and tests/smoke; npm test (238/238)"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-08-25
status: complete
---

# Phase 04 Plan 05: Secret-Safe Selected-Host Source Diagnostics Summary

**Codex now diagnoses duplicate user-level sources without exposing configuration values and can remove only a precisely owned native registration under fresh fingerprint authority and a clean full rescan.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-08-25T07:53:00Z
- **Completed:** 2026-08-25T08:28:20Z
- **Tasks:** 3
- **Files modified:** 13

## Accomplishments

- Added a host-neutral, immutable source-diagnostic model with closed safe fields, deterministic ordering, distinct fast/deep/gate modes, and secret-like serialization rejection.
- Made status and doctor truthfully report `source_conflict`; kept doctor read-only; and enforced complete source gates before install/update rendering while leaving uninstall project-local.
- Added Codex capability preflight, exact JSON inventory parsing, fixed non-shell cleanup argv, 5-second per-call bounds, independent SHA-256 authority, and complete post-removal inventory verification.
- Supported the known broken `kcoderag-nav` marketplace state only through an exact degraded recognizer; malformed, shared, foreign, raw, manual, or ambiguous sources remain manual-only.
- Proved Windows and Linux-compatible source behavior without executing any real user-level cleanup or reading MCP connection values.

## Task Commits

Each TDD task retained RED and GREEN evidence:

1. **Task 1: Define immutable secret-safe source findings and scan modes** - `ab8c6be` (RED), `e7df947` (GREEN)
2. **Task 2: Wire fast status, deep doctor, mutation gates, and truthful top-level health** - `e2bec6c` (RED), `843bb9d` (GREEN)
3. **Task 3: Detect and safely plan Codex owned-source cleanup** - `589babc` (RED), `d4a42a5` (GREEN), `fcf67e1` (regression fix)

## Files Created/Modified

- `src/hosts/user-sources.cts` - Closed finding, scan, capability, cleanup plan, fingerprint, and runner contracts.
- `src/core/contracts.cts`, `src/core/state.cts` - Public findings and truthful top-level `source_conflict` state.
- `src/hosts/host-adapter.cts` - Optional selected-host scan and owned-cleanup seams.
- `src/cli/commands.cts` - Fast status, deep doctor, full mutation gate, fingerprint authority, and post-cleanup orchestration.
- `src/hosts/codex.cts` - Native capability scanner, exact normal/degraded recognition, metadata-only user-source reader, and bounded cleanup runner.
- `package.json`, `src/maintainer/pack-audit.cts` - Published CJS inventory includes the shared source module.
- `tests/hosts/user-sources.test.cts`, `tests/cli/commands.test.cts`, `tests/hosts/codex.test.cts` - Source contract, command boundary, and Codex cleanup matrices.
- `tests/core/transaction.test.cts`, `tests/hosts/cross-host.test.cts` - Updated result contract and hermetic cross-host source fixtures.

## Decisions Made

- Native help and official implementation details guided the closed parser, but only the observed installed CLI version and exact runtime responses authorize cleanup.
- Raw MCP and manual Hook declarations are never edited automatically. Even an exact owned source is actionable only through a separately authorized, freshly fingerprinted plan.
- Marketplace-wide deletion is unavailable in the normal path unless the complete inventory proves exclusive ownership; the degraded path has its own stricter exact-identity predicates.
- Process stdout/stderr and user configuration values remain private inputs. Public output is restricted to stable codes, safe paths, sanitized commands, and fingerprints.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added the new shared runtime module to the public archive contract**
- **Found during:** Task 3 (Detect and safely plan Codex owned-source cleanup)
- **Issue:** The adapter imported `dist/hosts/user-sources.cjs`, but the plan file list did not include the public package and pack-audit inventories; an installed archive would otherwise omit required runtime code.
- **Fix:** Added the compiled module to `package.json` and the exact pack inventory.
- **Files modified:** `package.json`, `src/maintainer/pack-audit.cts`
- **Verification:** `npm run pack:audit` passed with the exact 48-entry archive contract.
- **Committed in:** `d4a42a5`

**2. [Rule 1 - Bug] Kept Windows native Codex execution non-shell and isolated scans from real user state**
- **Found during:** Full regression verification after Task 3
- **Issue:** Windows `execFile("codex")` could not invoke the PowerShell shim, and legacy tests using the production adapter could observe the developer's actual Codex home.
- **Fix:** Resolve the installed Codex Node entrypoint from PATH and invoke it with `process.execPath` while preserving fixed display argv; honor isolated `CODEX_HOME` and inject hermetic cross-host fixtures.
- **Files modified:** `src/hosts/codex.cts`, `tests/core/transaction.test.cts`, `tests/hosts/cross-host.test.cts`
- **Verification:** Production isolated probe succeeded; smoke passed 11/11; full suite passed 238/238.
- **Committed in:** `fcf67e1`

---

**Total deviations:** 2 auto-fixed (1 missing-critical package boundary, 1 runtime/isolation bug).
**Impact on plan:** Both fixes are required for installed Windows correctness and trustworthy secret-safe tests; no product surface or dependency was added.

## Issues Encountered

- The first full regression run exposed the Windows executable-resolution and non-hermetic fixture problems described above. The fixes passed targeted transaction/cross-host/smoke checks and the complete suite.
- Native Codex capability shapes were checked against the installed `codex-cli 0.146.1` and official OpenAI Codex source. No documentation statement was treated as cleanup authority.

## Authentication Gates

None.

## Known Stubs

None.

## User Setup Required

None - this plan performed implementation and isolated tests only; it did not modify real user-level Codex sources or require MCP credentials.

## Next Phase Readiness

- The shared contract is ready for Claude Code and Cursor selected-host scanners without changing CLI semantics.
- Package smoke and Head acceptance can consume stable safe finding codes and fingerprint-bound native plans.
- Phase 05 Hook precision, Phase 06 authenticated MCP evidence, and Phase 07 GSD Hook work remain deliberately unchanged.

## Self-Check: PASSED

- All declared production, test, package, and summary artifacts exist.
- All seven RED/GREEN/regression commits are present in Git history.
- Fresh build and full tests passed 238/238; generation check reported zero drift; pack audit accepted 48 entries.
- No known stub, skipped test, unrun verification, authentication gate, real user cleanup, or unexpected tracked deletion remains.

---
*Phase: 04-deployment-reliability*
*Completed: 2026-08-25*
