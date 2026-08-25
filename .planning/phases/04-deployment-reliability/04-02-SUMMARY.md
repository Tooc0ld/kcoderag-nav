---
phase: 04-deployment-reliability
plan: 02
subsystem: cli-state-safety
tags: [qa-only, legacy-migration, project-target, nodejs, tdd]

requires:
  - phase: 04-deployment-reliability
    provides: Plan 01 canonical QA-only contract and Plan 14 public transition guidance
provides:
  - QA-only public command parsing with independent observation-bound legacy Dev migration authority
  - Exact immutable current QA state plus named Python/Node legacy QA/Dev decoding
  - Canonical project-target rejection for filesystem roots, home, and selected-host global roots
affects: [phase-04-host-adapters, phase-04-source-diagnostics, phase-04-generator, phase-04-release]

actuals:
  tokens: 12046
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - Controller-owned QA constant with no public environment selector
    - Current QA state and legacy QA/Dev decoding use distinct immutable contracts
    - Target boundaries use canonical path-aware containment rather than string prefixes

key-files:
  created:
    - .planning/phases/04-deployment-reliability/04-02-SUMMARY.md
  modified:
    - src/bin/kcoderag-nav.cts
    - src/cli/commands.cts
    - src/core/contracts.cts
    - src/core/state.cts
    - src/core/project-target.cts
    - src/hosts/host-adapter.cts
    - tests/cli/commands.test.cts
    - tests/core/transaction.test.cts
    - tests/migration/legacy-state.test.cts

key-decisions:
  - "Schema version 1 remains unambiguous: the current parser accepts QA only, while the named legacy parser normalizes exact Python and Node QA/Dev records."
  - "General --yes confirmation never implies legacy Dev migration; authority is valid only for install/update with an observed legacy Dev identity."
  - "Unsafe-target checks are selected-host scoped, so another host's project directory remains a legal exact target."

patterns-established:
  - "QA-only current/legacy split: CurrentEnvironmentId is QA, while LegacyEnvironmentId is confined to compatibility readers."
  - "Boundary-safe paths: realpath canonicalization plus platform-aware relative containment rejects aliases and sibling-prefix mistakes."

requirements-completed: [DEP-01, DEP-02, DEP-03]

coverage:
  - id: D1
    description: "The public controller installs only implicit QA, rejects every retired environment selector before detection, and binds legacy Dev conversion to independent authority."
    requirement: DEP-01
    verification:
      - kind: integration
        ref: "tests/cli/commands.test.cts#QA-only CLI and legacy Dev authority cases; npm run test:cli"
        status: pass
    human_judgment: false
  - id: D2
    description: "Current state is exact, immutable, QA-only, and move-safe while the named compatibility decoder accepts exact Python and Node QA/Dev records."
    requirement: DEP-02
    verification:
      - kind: unit
        ref: "tests/migration/legacy-state.test.cts#current and legacy state boundary cases; npm run test:migration"
        status: pass
    human_judgment: false
  - id: D3
    description: "Filesystem roots, home, and selected-host global roots stop before adapter detection while ordinary non-VCS and other-host targets remain legal."
    requirement: DEP-03
    verification:
      - kind: unit
        ref: "tests/core/transaction.test.cts#project target boundary cases; npm run test:transaction"
        status: pass
      - kind: integration
        ref: "tests/cli/commands.test.cts#selected-host global targets; npm run test:cli"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-08-25
status: complete
---

# Phase 04 Plan 02: QA-Only CLI, State, and Target Boundary Summary

**The public controller now renders only QA, legacy Dev survives only behind exact decoding and independent authority, and unsafe global targets are rejected before adapter reads.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-08-25T05:19:00Z
- **Completed:** 2026-08-25T05:39:22Z
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments

- Removed public environment selection from parsing, prompts, and human success text while retaining stable QA identity in machine output.
- Split current QA state from exact Python/Node legacy QA/Dev decoding, with immutable normalized records and no absolute project binding.
- Added platform-aware, selected-host project-target boundaries for roots, home, global config/plugin/cache trees, aliases, and descendants without requiring Git or SVN.

## Task Commits

Each TDD task retained RED and GREEN evidence:

1. **Task 1: End-to-end QA-only public install and Dev refusal** - `3437d10` (RED), `b28534c` (GREEN)
2. **Task 2: Separate QA-only current state from legacy QA/Dev decoding** - `6e6b2ff` (RED), `5d0bf09` (GREEN)
3. **Task 3: Reject unsafe global targets without requiring a repository marker** - `4280587` (RED), `732012c` (GREEN)

## Files Created/Modified

- `src/bin/kcoderag-nav.cts` - QA-only target confirmation prompt.
- `src/cli/commands.cts` - Retired selector refusal, migration authority, QA output, and selected-host target policy.
- `src/core/contracts.cts` - Separate current and legacy environment types with QA-only `InstallState`.
- `src/core/state.cts` - Exact immutable current parser and normalized Python/Node legacy decoder.
- `src/core/project-target.cts` - Canonical home/global-root protection and platform-aware containment.
- `src/hosts/host-adapter.cts` - QA-only host contexts plus explicit legacy Dev authority and observation identity.
- `src/hosts/{codex,claude,cursor}.cts` - Explicit false authority in internal status render probes.
- `tests/cli/commands.test.cts` - Real controller QA-only, zero-write, authority, and selected-host scope regressions.
- `tests/core/transaction.test.cts` - Windows/POSIX target-boundary and non-VCS regressions.
- `tests/migration/legacy-state.test.cts` - Current/legacy state split, immutability, exactness, and move regressions.

## Decisions Made

- Kept the existing state schema version because the environment discriminator makes current QA and legacy Dev records unambiguous; only the parser entry point determines support status.
- Kept global target rejection selected-host scoped and injectable for deterministic tests while providing native Codex, Claude Code, and Cursor defaults.
- Preserved host-specific Dev-to-QA conversion implementation for Plan 04-03; Plan 02 exposes only the core decoder, identity, and authority seam.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Made internal host status probes explicit about migration authority**
- **Found during:** Task 2 (current/legacy state contract split)
- **Issue:** Making `allowLegacyDevMigration` a required host context correctly caused three existing status preview calls to fail compilation.
- **Fix:** Passed explicit `false` in the Codex, Claude Code, and Cursor read-only preview contexts without changing host lifecycle behavior.
- **Files modified:** `src/hosts/codex.cts`, `src/hosts/claude.cts`, `src/hosts/cursor.cts`
- **Verification:** `npm run build`, `npm run test:migration`, and `npm run test:transaction` passed.
- **Committed in:** `5d0bf09`

---

**Total deviations:** 1 auto-fixed (1 blocking issue).
**Impact on plan:** The adjustment was required to make the new authority contract explicit; it introduced no host migration behavior or scope expansion.

## Issues Encountered

- A deliberately invalid test-only source import caused TypeScript to emit two untracked `.cjs` files beside source before failing. The pre-commit hook blocked the commit; only those two generated files were removed, and the normal hook then passed.

## Authentication Gates

None.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 04-03 can implement each host's exact legacy Dev-to-QA conversion against `legacyEnvironment` and `allowLegacyDevMigration`.
- Source diagnostics, Hook root discovery, generator retirement, release, and Head deployment remain owned by their later Phase 04 plans.

## Self-Check: PASSED

- All nine key implementation/test artifacts and this summary exist.
- RED/GREEN commits `3437d10`, `b28534c`, `6e6b2ff`, `5d0bf09`, `4280587`, and `732012c` are present.
- Fresh build plus CLI 12/12, migration 5/5, and transaction 15/15 verification passed after the final production commit.

---
*Phase: 04-deployment-reliability*
*Completed: 2026-08-25*
