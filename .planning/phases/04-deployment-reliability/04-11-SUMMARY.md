---
phase: 04-deployment-reliability
plan: 11
subsystem: release-assurance
tags: [npm-pack, evidence-validation, codex, ci, tdd]

requires:
  - phase: 04-09
    provides: Final Cursor Rule/skill/MCP generated product
  - phase: 04-17
    provides: Final self-contained QA generated product
  - phase: 04-18
    provides: Retired Dev repository and package boundaries
provides:
  - Exact QA/Cursor repository and real npm tgz inventory enforcement
  - Immutable-subject pre-release evidence validator with exact four-lane CI binding
  - Closed real-Head acceptance validator for publication, cleanup, Hook, and mutation scope evidence
affects: [04-14, 04-15, 04-16, release, head-acceptance]

actuals:
  tokens: 13571
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns: [closed metadata-only evidence schemas, canonical fingerprint recomputation, repository-only compiled validators]

key-files:
  created:
    - src/maintainer/pre-release-evidence.cts
    - tests/maintainer/pre-release-evidence.test.cts
    - src/maintainer/head-acceptance.cts
    - tests/maintainer/head-acceptance.test.cts
  modified:
    - src/maintainer/pack-audit.cts
    - tests/maintainer/pack-audit.test.cts
    - tests/generator/repository-generation.test.cts

key-decisions:
  - "Pre-release authority binds three verdict artifacts to one immutable subject and a separate evidence-only child whose pushed head owns exactly four successful CI tuples."
  - "Head acceptance recomputes the native cleanup fingerprint from the canonical Codex cleanup seed instead of trusting a supplied digest."
  - "Both evidence validators are repository-only compiled tools and are rejected at every public package inventory boundary."

patterns-established:
  - "Evidence validators accept only bounded exact-key metadata and return frozen allow-listed summaries."
  - "Public package audits reject retired product prefixes and repository-only maintainer outputs by exact path, never broad content vocabulary."

requirements-completed: [DEP-01, DEP-02, DEP-03]

coverage:
  - id: D1
    description: Exact QA/Cursor repository and real tgz inventories reject every retired Dev product seam.
    requirement: DEP-01
    verification:
      - kind: integration
        ref: "tests/generator/repository-generation.test.cts and tests/maintainer/pack-audit.test.cts; npm run generate:check && npm run pack:audit"
        status: pass
    human_judgment: false
  - id: D2
    description: Pre-release evidence proves one immutable subject, evidence-only child, final pushed head, and exact successful CI matrix.
    requirement: DEP-02
    verification:
      - kind: unit
        ref: "tests/maintainer/pre-release-evidence.test.cts; node --test dist-tests/maintainer/pre-release-evidence.test.cjs"
        status: pass
    human_judgment: false
  - id: D3
    description: Real Head acceptance is closed around 0.2.0 publication identity, native cleanup, final health, root/deep Hook identity, and unchanged scope.
    requirement: DEP-03
    verification:
      - kind: unit
        ref: "tests/maintainer/head-acceptance.test.cts; node --test dist-tests/maintainer/head-acceptance.test.cjs"
        status: pass
    human_judgment: false

duration: 17min
completed: 2026-08-25
status: complete
---

# Phase 04 Plan 11: Final Pack and Evidence Validators Summary

**Exact QA/Cursor pack closure plus immutable pre-release and real-Head evidence validators with canonical Codex cleanup binding**

## Performance

- **Duration:** 17 min
- **Started:** 2026-08-25T10:08:53Z
- **Completed:** 2026-08-25T10:26:08Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Closed canonical repository and real npm archive inventories around only the QA and Cursor products, with seam-specific rejection of retired Dev package paths.
- Added a secret-safe validator that rejects stale/self-bound verdicts, non-evidence child deltas, head divergence, and any incomplete or substituted Ubuntu/Windows Node 22/24 CI tuple.
- Added a bounded real-Head validator that cross-checks exact 0.2.0 publication artifacts, recomputes degraded Codex cleanup authority, proves complete native removal before project writes, and fences Hook/mutation evidence to declared scope.

## Task Commits

Each TDD task was committed atomically:

1. **Task 1 RED: Specify retired Dev pack seams** - `f6944ca`
2. **Task 1 GREEN: Close retired Dev pack boundaries** - `5558469`
3. **Task 2 RED: Specify immutable pre-release evidence** - `b7116bc`
4. **Task 2 GREEN: Validate immutable pre-release evidence** - `95eda7e`
5. **Task 3 RED: Specify closed Head acceptance evidence** - `ee9dcfb`
6. **Task 3 GREEN: Validate closed Head acceptance evidence** - `402f349`

## Files Created/Modified

- `src/maintainer/pack-audit.cts` - Rejects retired Dev paths and repository-only evidence validators at exact package/archive boundaries.
- `tests/maintainer/pack-audit.test.cts` - Covers real tgz equality, retired Dev seams, legacy vocabulary, and non-publishable validator outputs.
- `tests/generator/repository-generation.test.cts` - Proves exact QA/Cursor trees and independent Dev canonical/directory/manifest failures.
- `src/maintainer/pre-release-evidence.cts` - Validates subject-bound verdicts, evidence-only Git metadata, final heads, and exact required CI jobs.
- `tests/maintainer/pre-release-evidence.test.cts` - Exercises valid evidence plus subject, verdict, delta, head, lane, and schema refusals.
- `src/maintainer/head-acceptance.cts` - Validates the bounded metadata-only real-Head acceptance contract.
- `tests/maintainer/head-acceptance.test.cts` - Exercises publication, degraded cleanup, health, Hook, scope, and secret-safety boundaries.

## Decisions Made

- Evidence-only commits are direct children of the implementation subject; the evidence commit itself can never be its own review subject.
- The Head receipt carries only digests, counts, stable IDs, fixed argv identities, booleans, and closed verdicts. It has no URL, header, Bearer, absolute-path, raw-output, or process-body seam.
- Canonical cleanup authority is independently recomputed with the same sorted JSON seed used by the runtime source-cleanup contract.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Kept evidence validators outside the installable npm archive**

- **Found during:** Tasks 2 and 3
- **Issue:** New compiled maintainer validators would otherwise be inferred as publishable outputs by the exact source-to-dist inventory policy.
- **Fix:** Declared both outputs repository-only and added declared/expected/archive boundary tests.
- **Files modified:** `src/maintainer/pack-audit.cts`, `tests/maintainer/pack-audit.test.cts`
- **Verification:** `npm run test:pack` and `npm run pack:audit`
- **Committed in:** `95eda7e`, `402f349`

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** The fix preserves the intended public-package boundary without adding runtime dependencies or user-facing package bytes.

## Issues Encountered

- A negative uppercase-SHA fixture initially used a digits-only SHA, so uppercasing was a no-op; the fixture was corrected to an actual uppercase hexadecimal value before the GREEN commit.
- The retired Dev archive member now intentionally reports the more specific `retired_product` code before the generic forbidden-path code; the existing precedence assertion was updated accordingly.

## Verification

- `npm run build` - passed.
- `npm test` - passed, 263/263 tests.
- `npm run generate:check` - passed with zero changed or written paths.
- `npm run pack:audit` - passed with 48 exact archive entries.
- No skipped tests, unrun verifications, or blocking stubs remain.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Pre-release plans can validate CLEAN/SECURED/PASS evidence against a fixed implementation subject and ordinary four-lane CI head.
- Publication and real Head deployment plans can produce receipts against a validator that already fixes version, cleanup, final health, Hook, and changed-scope acceptance criteria.
- No blocking issues remain.

## Self-Check: PASSED

- All seven planned source/test files exist.
- All six TDD task commits exist.
- Full build, test, generator, and real-pack gates passed in the final working tree.

---
*Phase: 04-deployment-reliability*
*Completed: 2026-08-25*
