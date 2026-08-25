---
phase: 04-deployment-reliability
plan: 03
subsystem: host-lifecycle-migration
tags: [qa-only, host-adapters, legacy-dev, atomic-migration, cursor, smoke, tdd]

requires:
  - phase: 04-deployment-reliability
    provides: Plan 02 QA-only current state, exact legacy decoder, and observation-bound migration authority
provides:
  - QA-only Codex, Claude Code, and Cursor install/update/uninstall lifecycles
  - Exact owned legacy Dev-to-QA conversion through one state-last transaction
  - Three-host project coexistence and selected-host mutation isolation
  - QA-only temporary-package smoke lifecycle compatible with the retired environment selector
affects: [phase-04-source-diagnostics, phase-04-generator, phase-04-release, phase-05-hook-precision]

actuals:
  tokens: 26306
  tasks: 3
  commits: 9

tech-stack:
  added: []
  patterns:
    - Host adapters render only current QA while exact legacy QA/Dev records remain compatibility inputs
    - Dedicated Dev migration authority is checked independently from normal confirmation
    - Legacy conversion replaces every owned path in one immutable desired state with state committed last
    - Cursor user-local legacy identity is filesystem/digest based and never credential-semantic

key-files:
  created:
    - .planning/phases/04-deployment-reliability/04-03-SUMMARY.md
  modified:
    - src/hosts/codex.cts
    - src/hosts/claude.cts
    - src/hosts/cursor.cts
    - src/smoke/host-smoke.cts
    - tests/hosts/codex.test.cts
    - tests/hosts/claude.test.cts
    - tests/hosts/cursor.test.cts
    - tests/hosts/cross-host.test.cts
    - tests/migration/legacy-state.test.cts

key-decisions:
  - "Every public host lifecycle renders QA only; Dev identity is retained solely for exact legacy migration and uninstall compatibility."
  - "Cursor user-local legacy ownership is established by the frozen manifest/tree/digest contract, never by comparing MCP URL or authorization values."
  - "An exactly decoded legacy environment remains attached to drift observations so managed drift, not authority validation order, is the write-stopping result."

patterns-established:
  - "Host-local migration builder: decode exact legacy state, validate host/path/section/digests, render QA, and commit once through applyTransaction."
  - "Secret-opaque compatibility: values may be copied as opaque bytes for host configuration but are never used as diagnostic identity or emitted."
  - "Cross-host coexistence: one CLI invocation detects, renders, mutates, and uninstalls only its selected adapter tree."

requirements-completed: [DEP-01, DEP-03]

coverage:
  - id: D1
    description: "Codex, Claude Code, and Cursor new install/update lifecycles render only QA assets and current QA state."
    requirement: DEP-01
    verification:
      - kind: integration
        ref: "tests/hosts/{codex,claude,cursor}.test.cts; npm run test:host:codex, test:host:claude, test:host:cursor"
        status: pass
    human_judgment: false
  - id: D2
    description: "Exact owned legacy Dev projects require dedicated authority and convert atomically to QA with every injected commit failure restoring original bytes."
    requirement: DEP-01
    verification:
      - kind: integration
        ref: "tests/migration/legacy-state.test.cts and host legacy migration cases; npm run test:migration"
        status: pass
    human_judgment: false
  - id: D3
    description: "Three simultaneous QA host installations coexist and selected-host update/uninstall preserves sibling trees exactly."
    requirement: DEP-03
    verification:
      - kind: integration
        ref: "tests/hosts/cross-host.test.cts; npm run test:cross-host"
        status: pass
    human_judgment: false
  - id: D4
    description: "Cursor legacy diagnosis remains secret-opaque while its project and user-local compensation paths remain digest-bound and recoverable."
    requirement: DEP-03
    verification:
      - kind: integration
        ref: "tests/hosts/cursor.test.cts#legacy project and user-local cases; npm run test:host:cursor"
        status: pass
    human_judgment: false
  - id: D5
    description: "The complete temporary-tarball smoke lifecycle invokes the QA-only CLI contract for all hosts."
    requirement: DEP-01
    verification:
      - kind: e2e
        ref: "tests/smoke/host-smoke.test.cts; npm run test:smoke and npm test"
        status: pass
    human_judgment: false

duration: 26min
completed: 2026-08-25
status: complete
---

# Phase 04 Plan 03: Three-Host QA-Only Lifecycle and Legacy Migration Summary

**Codex, Claude Code, and Cursor now share a QA-only public lifecycle while exact owned legacy Dev projects can be converted explicitly, atomically, and without exposing credential values.**

## Performance

- **Duration:** 26 min
- **Started:** 2026-08-25T05:48:22Z
- **Completed:** 2026-08-25T06:14:30Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- Converted all three host adapters from retired environment selection/current-state assumptions to a single current QA lifecycle.
- Added exact Python/Node legacy QA/Dev recognition, dedicated Dev migration authority, one-transaction conversion, every-stage rollback, and clean uninstall restoration.
- Removed Cursor legacy credential comparison from diagnosis while retaining exact manifest, tree, path, and digest ownership checks plus user-local compensation.
- Proved Codex, Claude Code, and Cursor QA installations coexist and that updating or uninstalling one host preserves sibling host bytes.
- Restored the real temporary-package smoke lifecycle after public environment selectors were retired.

## Task Commits

Each planned task retained RED and GREEN evidence:

1. **Task 1: Convert Codex legacy Dev to current QA in one transaction** - `819cf7e` (RED), `a2f5ea8` (GREEN)
2. **Task 2: Apply the QA-only and legacy conversion contract to Claude Code** - `06d00b0` (RED), `c05b00d` (GREEN)
3. **Task 3: Retire Cursor Dev rendering while preserving host isolation** - `362194e` (RED), `36a69e4` (GREEN)

Additional direct regressions were committed as `b783464` (smoke QA-only invocation), `a7633a4` (Codex drift RED), and `57893b3` (Codex drift GREEN).

## Files Created/Modified

- `src/hosts/codex.cts` - QA-only desired state, exact Python/Node legacy migration, restoration, and drift identity preservation.
- `src/hosts/claude.cts` - QA-only root MCP/settings lifecycle with exact legacy section/original preservation and rollback.
- `src/hosts/cursor.cts` - QA-only Rule/skill/MCP lifecycle, exact project legacy conversion, and credential-independent user-local legacy diagnosis.
- `src/smoke/host-smoke.cts` - QA-only synthetic MCP source and CLI invocation without the retired environment selector.
- `tests/hosts/{codex,claude,cursor}.test.cts` - Host-specific lifecycle, migration authority, drift, rollback, restoration, and secret-safe output coverage.
- `tests/hosts/cross-host.test.cts` - Three-host QA coexistence and selected-host-only mutation/uninstall coverage.
- `tests/migration/legacy-state.test.cts` - Exact legacy state conversion, authority, drift identity, and every-commit rollback coverage.

## Decisions Made

- Kept legacy conversion host-specific rather than introducing a shared writer; each adapter owns its native paths and structured sections while the core transaction remains the only commit boundary.
- Treated Cursor user-local legacy packages as historical owned inputs that always migrate to QA; neither package Dev assets nor credential-value comparison participates in diagnosis.
- Preserved an exactly decoded legacy environment even when later digest validation finds drift, allowing the controller to validate authority without hiding the primary drift refusal.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Aligned the smoke harness with the QA-only public CLI**
- **Found during:** Plan-level `npm test`
- **Issue:** The temporary-package smoke runner still passed retired `--environment qa` arguments and rewrote both QA and Dev synthetic MCP sources, so all three host installs failed before adapter detection.
- **Fix:** Removed the selector and restricted synthetic source rewriting to `kcoderag-qa`.
- **Files modified:** `src/smoke/host-smoke.cts`
- **Verification:** `npm run test:smoke` passed 11/11 and the final full suite passed 207/207.
- **Commit:** `b783464`

**2. [Rule 1 - Bug] Preserved Codex legacy Dev identity when drift is detected**
- **Found during:** Plan-level legacy authority review
- **Issue:** Codex discarded the safely decoded legacy environment after a managed digest failure, causing an authorized CLI call to report invalid authority before the real drift refusal.
- **Fix:** Bound the encoded environment outside the validation block and retained it in issue observations, matching Claude Code and Cursor behavior.
- **Files modified:** `src/hosts/codex.cts`, `tests/migration/legacy-state.test.cts`
- **Verification:** The new RED failed on missing Dev identity; GREEN passed migration 7/7, Codex 9/9, and the final full suite 207/207.
- **Commits:** `a7633a4`, `57893b3`

---

**Total deviations:** 2 auto-fixed bugs.
**Impact on plan:** Both fixes close direct QA-only lifecycle regressions and add no new product surface.

## Issues Encountered

- The initial complete suite exposed one remaining old smoke invocation after all declared host suites passed. It was fixed in scope and the entire suite was rerun from a fresh build.

## Authentication Gates

None.

## Known Stubs

None.

## User Setup Required

None - no external authority or live MCP credential was required for this plan.

## Next Phase Readiness

- All three supported adapters now consume the Plan 02 QA-only state contract and provide exact legacy conversion behavior.
- Later Phase 04 plans can build source diagnosis, root discovery, deterministic QA-only generation, and release evidence on a passing 207-test baseline.
- Phase 05 Hook precision, Phase 06 real authenticated MCP calls, and later production identity/rotation work remain deliberately deferred.

## Self-Check: PASSED

- All nine implementation/test artifacts and this summary exist.
- Planned RED/GREEN commits `819cf7e`, `a2f5ea8`, `06d00b0`, `c05b00d`, `362194e`, and `36a69e4` are present, plus deviation commits `b783464`, `a7633a4`, and `57893b3`.
- Fresh build and all declared host/migration/cross-host suites passed; final `npm test` passed 207/207, including the real temporary-tarball smoke lifecycle.
- No known stub, skipped test, unrun verification, authentication gate, or secret-bearing diagnostic remains.

---
*Phase: 04-deployment-reliability*
*Completed: 2026-08-25*
