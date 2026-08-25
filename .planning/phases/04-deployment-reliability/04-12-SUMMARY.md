---
phase: 04-deployment-reliability
plan: 12
subsystem: release-preparation
tags: [npm-release, git-tag, rollback, qa-only, tdd]

requires:
  - phase: 04-06
    provides: QA-only source and migration ownership boundaries
  - phase: 04-11
    provides: Closed QA/Cursor repository and npm pack inventory
provides:
  - Exact immutable five-path 0.1.8 to 0.2.0 release preparation contract
  - Pre-write compatibility-manifest inventory refusal for missing, extra, or retired Dev paths
  - Local commit and tag recovery across write, stage, commit, and tag failure boundaries
affects: [04-13, 04-15, release, npm-publication]

actuals:
  tokens: 4395
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns: [code-unit-sorted release allow-list, pre-write manifest inventory, local ref compensation, digest-only fixture assertions]

key-files:
  created: []
  modified:
    - src/maintainer/release.cts
    - tests/maintainer/release.test.cts

key-decisions:
  - "The permanent release identity is one frozen code-unit-sorted five-path allow-list: three QA/Cursor compatibility manifests plus package-lock.json and package.json."
  - "Any missing, extra, or retired Dev compatibility manifest is rejected before generator or gate execution with one path-free stable code."
  - "Release preparation remains a local-only helper with explicit write, stage, commit, and tag recovery seams; publication commands are absent."

patterns-established:
  - "Release tests compare owned file digests plus index, HEAD, refs, tags, and status without exposing configuration values."
  - "Failure recovery restores only the helper-owned five-path surface and preserves unrelated planning and sibling work."

requirements-completed: [DEP-01]

coverage:
  - id: D1
    description: Minor dry-run derives exact 0.2.0 and v0.2.0 from 0.1.8 after configured gates with an immutable five-path receipt and no local mutation.
    requirement: DEP-01
    verification:
      - kind: integration
        ref: "tests/maintainer/release.test.cts; npm run build && npm run test:release"
        status: pass
    human_judgment: false
  - id: D2
    description: Missing, extra, retired Dev, and version-drifted compatibility manifests are stable pre-write refusals.
    requirement: DEP-01
    verification:
      - kind: integration
        ref: "tests/maintainer/release.test.cts; npm run test:release"
        status: pass
    human_judgment: false
  - id: D3
    description: Local success creates one exact five-path commit and tag while all injected failures restore files, index, HEAD, refs, tags, planning state, and sibling work.
    requirement: DEP-01
    verification:
      - kind: integration
        ref: "tests/maintainer/release.test.cts; npm run test:release"
        status: pass
    human_judgment: false

duration: 9min
completed: 2026-08-25
status: complete
---

# Phase 04 Plan 12: Exact Local 0.2.0 Release Preparation Summary

**A frozen five-path QA/Cursor release boundary that derives 0.2.0 exactly and restores all local Git and file state across injected failures**

## Performance

- **Duration:** 9 min
- **Started:** 2026-08-25T10:34:00Z
- **Completed:** 2026-08-25T10:42:57Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Locked version propagation to the sorted QA/Cursor compatibility manifests, lockfile, and root package file, with no Dev path in release ownership.
- Added a metadata-only manifest inventory gate that rejects missing, extra, and retired Dev compatibility manifests before generator or release gates can run.
- Proved exact 0.1.8 to 0.2.0 dry-run identity, successful local commit/tag creation, and byte/index/ref/tag restoration at every injected write, stage, commit, and tag boundary.
- Confirmed the existing `release:minor` script already invokes compiled CJS deterministically, so `package.json` required no modification.

## Task Commits

Each TDD task was committed atomically:

1. **Task 1 RED: Specify exact 0.2.0 dry-run boundary** - `715a28f`
2. **Task 1 GREEN: Enforce exact five-path release inventory** - `76503f5`
3. **Task 2 RED: Specify local release rollback isolation** - `fabf98c`
4. **Task 2 GREEN: Make local release recovery exhaustive** - `1f0c7c2`

## Files Created/Modified

- `src/maintainer/release.cts` - Owns the sorted five-path release surface, pre-write manifest inventory, local gate ordering, exact staging/commit/tag checks, and recovery seams.
- `tests/maintainer/release.test.cts` - Covers exact 0.2.0 dry-run, manifest inventory drift, local release success, failure recovery, staged planning isolation, sibling preservation, and publication-command absence.

## Decisions Made

- Compatibility-manifest discovery is deliberately limited to top-level `kcoderag-*` product directories and the three supported host manifest directories, so unexpected product manifests are rejected without reading or reporting their contents.
- Failure fixtures assert SHA-256 digests and Git metadata instead of snapshotting configuration text into diagnostics.
- The helper may create only a local commit and local tag after gates. Push, publish, unpublish, and dist-tag operations remain outside this module and are not callable from it.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Verification

- `npm run build` - passed.
- `npm run test:release` - passed, 13/13 tests.
- Compiled contract inspection returned the exact three manifest paths and exact five release paths with both arrays frozen.
- Root version remained `0.1.8`; HEAD was unchanged by verification; no real `v0.2.0` tag exists.
- Static source scan found no release-helper publication argv and no stub markers.
- The real final full-gate release dry-run was intentionally not executed; Plan 15 owns that command on the final implementation subject.

## User Setup Required

None - no external service configuration or release authority was used.

## Next Phase Readiness

- Plan 13 can consume the exact local release helper without broadening its package or publication boundary.
- Plan 15 can run the first real full-gate `0.1.8` to `0.2.0` dry-run against the final audited subject.
- Fix-forward publication policy remains intact because this plan created no real tag and performed no network or registry mutation.

## Self-Check: PASSED

- Both planned source/test files and this summary exist.
- All four TDD task commits exist with RED commits preceding their GREEN commits.
- No skipped test, unrun required verification, blocking stub, or unresolved threat remains.

---
*Phase: 04-deployment-reliability*
*Completed: 2026-08-25*
