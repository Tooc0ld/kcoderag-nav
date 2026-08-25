---
phase: 04-deployment-reliability
plan: 14
subsystem: public-documentation
tags: [qa-only, npx, source-diagnostics, legacy-migration, release-policy]

requires:
  - phase: 04-deployment-reliability
    provides: Plan 01 canonical QA-only deployment contract and locked D-01 through D-20 decisions
provides:
  - Root README public QA-only five-command lifecycle and project-boundary guidance
  - Sole sibling KCodeRag experience guide synchronized with source cleanup, legacy migration, Hook root, and release evidence boundaries
affects: [phase-04-cli, phase-04-generator, phase-04-release, phase-06-real-host-evidence]

actuals:
  tokens: 4409
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - Public transition guidance is committed before downstream Dev product removal
    - Cross-repository documentation ownership remains one-file, secret-safe, and independently committed

key-files:
  created:
    - .planning/phases/04-deployment-reliability/04-14-SUMMARY.md
  modified:
    - README.md
    - ../KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md

key-decisions:
  - "Public documentation exposes QA as the sole environment while retaining exact legacy Dev migration and uninstall instructions only."
  - "Owned user-source cleanup remains native-command, capability, scope, rescan, and frozen-fingerprint bound; ambiguous sources remain manual-only."
  - "Phase 04 documentation claims lifecycle and Hook/Rule evidence only; authenticated real-host MCP evidence remains Phase 06 ownership."

patterns-established:
  - "Sole-guide ownership: MCP_QA_EXPERIENCE_GUIDE.md exists only in the sibling KCodeRag service repository."
  - "Immutable recovery: a failed post-publication Head migration preserves 0.2.0 and fixes forward as 0.2.1."

requirements-completed: [DEP-01, DEP-02, DEP-03]

coverage:
  - id: D1
    description: "The root README publishes the QA-only five-command project lifecycle before public Dev removal."
    requirement: DEP-01
    verification:
      - kind: other
        ref: "npm run build and README Node contract assertion"
        status: pass
    human_judgment: false
  - id: D2
    description: "Both documents define exact target rejection, nearest managed-state discovery, damaged-boundary fail-open, and moved-project behavior."
    requirement: DEP-02
    verification:
      - kind: other
        ref: "cross-document Node contract assertion"
        status: pass
    human_judgment: false
  - id: D3
    description: "The authoritative sibling guide matches status/doctor/source cleanup, legacy migration, and immutable 0.2.0 evidence boundaries without a Phase 06 query claim."
    requirement: DEP-03
    verification:
      - kind: other
        ref: "authoritative guide Node assertion and KCodeRag canonical staged GatePlan hook"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-08-25
status: complete
---

# Phase 04 Plan 14: QA-only Public Guides Summary

**The root README and sole sibling KCodeRag guide now publish one QA-only, project-scoped lifecycle with fingerprint-bound source cleanup and immutable release recovery.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-08-25T05:16:39Z
- **Completed:** 2026-08-25T05:20:59Z
- **Tasks:** 2
- **Files modified:** 2 across two repositories

## Accomplishments

- Published the root QA-only install/status/doctor/update/uninstall transition contract before downstream Dev product removal.
- Synchronized only `D:/AIProgram/KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md`, preserving it as the sole authoritative guide.
- Documented exact native cleanup capabilities, frozen fingerprint authorization, legacy Dev migration, nearest-state Hook behavior, and 0.2.0-to-0.2.1 fix-forward semantics.
- Kept authenticated real-host MCP registration and query evidence explicitly deferred to Phase 06.

## Task Commits

Each task was committed atomically in its owning repository:

1. **Task 1: Publish the QA-only lifecycle and transition in the root README** - `737c06c` (`kcoderag-nav`)
2. **Task 2: Synchronize only the authoritative KCodeRag experience guide** - `879c7df0` (`KCodeRag`)

## Files Created/Modified

- `README.md` - Early public QA-only lifecycle, diagnostics, migration, Hook root, and release transition contract.
- `../KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md` - Sole authoritative Codex, Claude Code, and Cursor QA experience guide.
- `.planning/phases/04-deployment-reliability/04-14-SUMMARY.md` - Execution evidence and cross-repository commit record.

## Decisions Made

- Followed locked D-01 through D-20 without introducing a hidden Dev route, an automatic ambiguous-source repair, or a Phase 06 evidence claim.
- Retained KCodeRag service tool/reference sections while replacing only stale integration lifecycle guidance.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The tracer verification checkpoint was approved under the user's standing authorization and Task 2 completed without touching sibling repository work in progress.

## Authentication Gates

None.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plans 04-02 and 04-07 may now remove public Dev CLI/generator contracts against already-published transition guidance.
- Plan 04-19 can audit compiled behavior against these documents; Phase 06 still owns authenticated real-host MCP evidence.

## Self-Check: PASSED

- Root README, sole sibling guide, and this summary exist at their required paths.
- Task commits `737c06c` and `879c7df0` exist in their respective repository histories.
- Fresh build and cross-document QA-only contract assertions passed after both task commits.

---
*Phase: 04-deployment-reliability*
*Completed: 2026-08-25*
