---
quick_id: 260831-0ei
phase: quick-260831-0ei
plan: "01"
subsystem: release-assurance
tags: [github-actions, node24, readiness, maintenance-audit]
requires:
  - phase: 04.2-public-debranding
    provides: immutable hosted readiness evidence and local release-assurance gates
provides:
  - official Node-24-backed immutable checkout and setup-node workflow pins
  - zero-open broken-windows and cross-phase deferred-item audits
  - fresh local Phase 04.2 post-maintenance verification evidence
affects: [ci, release, readiness, phase-05]
actuals:
  tokens: 8683
  tasks: 3
  commits: 3
tech-stack:
  added: []
  patterns: [official stable-tag resolution to immutable commit and exact action runtime verification]
key-files:
  created: [.planning/quick/260831-0ei-close-phase-04-2-maintenance-debt-audit-/260831-0ei-SUMMARY.md]
  modified: [.github/workflows/ci.yml, .github/workflows/release.yml, .github/workflows/readiness.yml, tests/maintainer/readiness-workflow.test.cts, .planning/WINDOWS.md, .planning/phases/03.1-javascript-npx/deferred-items.md, .planning/phases/04.2-public-debranding/04.2-VERIFICATION.md, .planning/STATE.md]
key-decisions:
  - "Resolve only official latest stable Action releases, retain full-SHA pinning, and require node24 in action.yml at the exact commit."
  - "Treat prior hosted readiness as historical evidence and make no hosted timing or release claim for the maintenance HEAD."
patterns-established:
  - "Maintenance evidence separates immutable historical hosted receipts from fresh local revalidation."
requirements-completed: [BRAND-04, TEST-10]
coverage:
  - id: D1
    description: All CI, release, and readiness checkout/setup-node uses are official full-SHA Node 24 Action pins.
    requirement: TEST-10
    verification:
      - kind: integration
        ref: official GitHub release/tag/action.yml resolution plus workflow contract suites
        status: pass
    human_judgment: false
  - id: D2
    description: All seven stale windows and the duplicate deferred item are evidence-backed and closed.
    requirement: TEST-10
    verification:
      - kind: integration
        ref: gsd windows status and audit-uat
        status: pass
    human_judgment: false
  - id: D3
    description: Phase 04.2 remains locally passed without a hosted workflow or release mutation.
    requirement: BRAND-04
    verification:
      - kind: e2e
        ref: full local maintenance gate and 04.2-VERIFICATION post-maintenance addendum
        status: pass
    human_judgment: false
duration: 10min
completed: 2026-08-31
status: complete
---

# Quick 260831-0ei: Phase 04.2 Maintenance Debt Closure Summary

**Official Node 24 Action pins, a zero-open maintenance ledger, and fresh local Phase 04.2 proof without changing release authority.**

## Performance

- **Started:** 2026-08-31T00:29:47+08:00
- **Completed:** 2026-08-31T00:39:00+08:00
- **Tasks:** 3
- **Files modified:** 9
- **Complete local maintenance gate:** 223,296 ms

## Accomplishments

- Replaced every `actions/checkout` and `actions/setup-node` use in CI, release, and readiness with live-resolved official stable full-SHA commits whose exact `action.yml` declares `node24`.
- Demonstrated and closed windows 10 and 16-21, resolved the duplicate Phase 03.1 deferred item, and reached 0 open windows plus 0 cross-phase UAT items.
- Revalidated Phase 04.2 locally with 429/429 full tests, 12/12 five-host packaged smoke tests, and every release/readiness/documentation/package gate passing.

## Official Public Action Metadata

| Repository | Latest stable release | Resolved commit | Exact runtime |
|---|---|---|---|
| `actions/checkout` | `v7.0.1` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | `node24` |
| `actions/setup-node` | `v7.0.0` | `820762786026740c76f36085b0efc47a31fe5020` | `node24` |

Resolution used read-only GitHub release metadata, tag refs with annotated-tag peeling when required, and official raw `action.yml` content at the resolved commit. Final recheck found 10 checkout and 10 setup-node workflow uses, all equal to these exact commits.

## Task Commits

1. **Task 1: Replace deprecated-runtime Action pins through all workflow contracts** — `f7ef9c5`
2. **Task 2: Prove and close all seven windows plus the duplicate deferred item** — `87878b5`
3. **Task 3: Refresh Phase 04.2 local completion evidence without a hosted or release claim** — `aef48d0`

## Fresh Verification

| Gate | Result |
|---|---|
| Build | PASS, 2,764 ms |
| Dependency audit | PASS, frozen 2 direct + 1 transitive development packages |
| Full serialized suite | PASS, 429/429, 143,376.6029 ms test duration |
| Deterministic generation | PASS, 0 changed/written paths |
| Documentation | PASS, 6 files checked |
| Retirement audit | PASS, 0 remaining scripts/source/tests |
| Committed-head brand audit before evidence child | PASS, 527 scanned, 0 findings at `87878b5...` |
| Real pack audit | PASS, version 0.3.0, 77 entries |
| Five-host packaged smoke | PASS, 12/12, 55,353.9878 ms test duration |
| CI / release / readiness workflow contracts | PASS, 6/6 + 7/7 + 11/11 |
| Release readiness / seal / artifact upload | PASS, 7/7 + 5/5 + 13/13 |
| Broken-windows ledger | PASS, 0 open / 24 fixed / 0 waived |
| Cross-phase UAT audit | PASS, 0 outstanding items |
| Final committed evidence-child brand audit | PASS, 527 scanned, 0 findings at `aef48d0...` |
| Diff hygiene | PASS |

## Scope Boundary

The previously accepted hosted candidate, run, artifact, four lanes, receipt, and seal remain historical Phase 04.2 evidence. They were not replayed or presented as evidence for hosted timing on the maintenance HEAD.

| External operation | Status |
|---|---|
| Hosted readiness workflow/lane rerun | `NOT_RUN_BY_SCOPE` |
| Hosted timing measurement or speedup claim | `NOT_RUN_BY_SCOPE` |
| npm publish or registry mutation/refetch | `NOT_RUN_BY_SCOPE` |
| Git tag creation | `NOT_RUN_BY_SCOPE` |
| Git push or force-push | `NOT_RUN_BY_SCOPE` |
| GitHub workflow dispatch | `NOT_RUN_BY_SCOPE` |

## Files Created/Modified

- `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/workflows/readiness.yml` — official immutable Node 24 Action pins.
- `tests/maintainer/readiness-workflow.test.cts` — exact readiness pin contract.
- `.planning/WINDOWS.md` — machine-managed 0-open/24-fixed ledger.
- `.planning/phases/03.1-javascript-npx/deferred-items.md` — explicit resolved action-pin record.
- `.planning/phases/04.2-public-debranding/04.2-VERIFICATION.md` — non-destructive local maintenance addendum.
- `.planning/STATE.md` — quick-task activity while Phase 05 remains current.

## Decisions Made

- Full-SHA supply-chain immutability remains mandatory; stable tags are comments and evidence labels, never executable refs.
- A maintenance change can preserve a prior hosted readiness verdict only as historical authority; current-HEAD hosted performance remains unclaimed without a new authorized run.
- Ledger entries are fixed only after focused current tests prove each original deficiency is gone.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used the deferred auditor's explicit terminal field shape**
- **Found during:** Task 2 cross-phase UAT audit.
- **Issue:** A prose `[resolved]` prefix is not a terminal state to GSD's fail-safe deferred parser, so the first audit still reported one item.
- **Fix:** Represented the entry with its required `status: resolved` field while preserving all historical and closure evidence.
- **Files modified:** `.planning/phases/03.1-javascript-npx/deferred-items.md`
- **Verification:** `audit-uat --raw` reports `summary.total_items: 0`.
- **Committed in:** `87878b5`

**2. [Rule 1 - Bug] Removed a machine-local path from quick-task evidence**
- **Found during:** Final post-commit brand audit.
- **Issue:** The generated plan embedded an absolute maintainer-local GSD path, causing seven F002 findings in the otherwise clean final Git tree.
- **Fix:** Replaced the absolute path with portable `@gsd-core/...` references and the resolved `$GSD_TOOLS` shim variable; recorded the correction in the quick verification.
- **Files modified:** `260831-0ei-PLAN.md`, `260831-0ei-SUMMARY.md`, `260831-0ei-VERIFICATION.md`
- **Verification:** The corrected synthetic commit tree and final committed child both pass the Git brand audit with zero findings.

**Total deviations:** 2 auto-fixed Rule 1 evidence-format bugs. No product or workflow scope changed.

## Known Stubs

None. The former projection stubs were verified as completed implementations before their ledger entries were fixed.

## Threat Review

- Official-repository identity, stable release metadata, immutable commit form, and exact `node24` runtime content jointly mitigate Action-pin spoofing and tampering.
- Release credentials, workflow permissions, tag-only publication, artifact identity, and four-lane topology were unchanged and remain covered by passing contract tests.
- No new endpoint, credential path, runtime dependency, schema, or product file-access authority was introduced.

## User Setup Required

None.

## Next Phase Readiness

Phase 04.2 remains passed with maintenance debt closed. Project position stays at Phase 05, ready for low-false-positive Hook and honest-routing planning.

## Self-Check: PASSED

All three task commits and every declared evidence artifact exist. The summary records the fresh gate counts and durations, official public Action metadata, zero-open audits, and every external `NOT_RUN_BY_SCOPE` boundary.

---
*Quick task: 260831-0ei*
*Completed: 2026-08-31*
