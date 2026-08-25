---
phase: 04-deployment-reliability
plan: 01
subsystem: deployment-contract
tags: [qa-only, nodejs, project-scope, source-diagnostics, release-policy]

requires:
  - phase: 03.1-javascript-npx
    provides: Public Node.js 22+ npx lifecycle, host adapters, atomic transaction, generated host assets, and immutable release evidence
provides:
  - Canonical QA-only public product contract with exact legacy Dev decode boundaries
  - Classified DEP-01/DEP-02/DEP-03 acceptance predicates for release, Hook root discovery, and selected-host source governance
  - Managed AGENTS instructions synchronized with the Phase 04 release, safety, ownership, and deferred-scope fences
affects: [phase-04-implementation, cli-lifecycle, host-adapters, hook-root-discovery, source-diagnostics, release-0.2.0]

actuals:
  tokens: 8566
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - Public QA-only behavior is separated from exact legacy QA/Dev state decoding
    - User-level owned-source cleanup authority is independent and bound to a frozen fingerprint
    - Managed agent instructions preserve explicit Phase 05-08 and OpenCode delivery fences

key-files:
  created:
    - .planning/phases/04-deployment-reliability/04-01-SUMMARY.md
  modified:
    - .planning/PROJECT.md
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - AGENTS.md

key-decisions:
  - "Phase 04 supersedes the former public QA/Dev contract with QA-only 0.2.0 behavior while preserving Phase 1-3/03.1 as historical fact."
  - "Exact legacy Dev decoding remains available only for digest-verified migration or uninstall and never forms a hidden public Dev product."
  - "Release, legacy migration, and general confirmation authority cannot substitute for a frozen fingerprint-specific user-source cleanup authority."

patterns-established:
  - "Canonical-first transition: update PROJECT, REQUIREMENTS, ROADMAP, and managed AGENTS before production implementation."
  - "Nearest boundary safety: damaged nearest managed state fails open without falling through to an outer project."

requirements-completed: [DEP-01, DEP-02, DEP-03]

coverage:
  - id: D1
    description: "PROJECT, REQUIREMENTS, and ROADMAP define QA as the sole public environment and Dev as exact legacy decode input only."
    requirement: DEP-01
    verification:
      - kind: other
        ref: "04-01 Task 1 canonical-contract Node assertion"
        status: pass
    human_judgment: false
  - id: D2
    description: "The canonical contract requires nearest-state upward Hook discovery, damaged-boundary fail-open behavior, moved-project support, and safe exact targets without a VCS prerequisite."
    requirement: DEP-02
    verification:
      - kind: other
        ref: "04-01 Task 2 managed-context assertion and npm run build"
        status: pass
    human_judgment: false
  - id: D3
    description: "Selected-host status/doctor and write-time gates are secret-safe, source-tiered, and require independent fingerprint-bound authority for owned cleanup."
    requirement: DEP-03
    verification:
      - kind: other
        ref: "04-01 Task 2 managed-context assertion and unmanaged-region byte comparison"
        status: pass
    human_judgment: false

duration: 13min
completed: 2026-08-25
status: complete
---

# Phase 04 Plan 01: QA-Only Canonical Contract Summary

**QA-only `0.2.0` deployment semantics, legacy decoding limits, nearest-project Hook rules, and source-cleanup authority now form one executor-visible contract.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-08-25T04:53:06Z
- **Completed:** 2026-08-25T05:06:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Replaced the active public QA/Dev product definition with a QA-only `0.2.0` contract while preserving completed history.
- Converted DEP-01, DEP-02, and DEP-03 into observable release, project-root, migration, source-diagnostic, and Head-deployment predicates.
- Synchronized managed AGENTS Stack and Architecture guidance without changing any unrelated AGENTS region.

## Task Commits

Each task was committed atomically:

1. **Task 1: Establish the QA-only canonical contract end to end** - `5a8e9bd`
2. **Task 2: Regenerate managed AGENTS context and audit scope fences** - `d9830e5`

## Files Created/Modified

- `.planning/PROJECT.md` - Superseding QA-only product definition, boundaries, and locked Phase 04 decisions.
- `.planning/REQUIREMENTS.md` - Classified DEP-01/DEP-02/DEP-03 acceptance and evidence predicates.
- `.planning/ROADMAP.md` - Nineteen-plan Phase 04 ordering, release/Head success criteria, and deferred fences.
- `AGENTS.md` - Executor-visible QA-only stack, architecture, root discovery, source authority, and release policy.

## Decisions Made

- Historical QA/Dev delivery remains recorded; `0.2.0` explicitly supersedes its current public product effect.
- Cleanup of an owned user-level source requires a separate exact fingerprint authority; no broader confirmation can imply it.
- Phase 04 deployment evidence remains distinct from Phase 05 Hook precision, Phase 06 real MCP evidence, Phase 07 GSD Hook work, Phase 08 production security, and OpenCode delivery.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The first inline verification command was malformed by PowerShell backtick parsing; it changed no files. The same full verification was rerun with safe quoting and passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 04-02 can consume a single QA-only public CLI/current-state contract and implement dangerous-target refusal.
- Production behavior, generated assets, public documentation, release, and Head deployment remain intentionally owned by subsequent Phase 04 plans.

## Self-Check: PASSED

- All four modified contract artifacts and this summary exist.
- Task commits `5a8e9bd` and `d9830e5` are present in repository history.

---
*Phase: 04-deployment-reliability*
*Completed: 2026-08-25*
