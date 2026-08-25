---
phase: 04-deployment-reliability
plan: 09
subsystem: generated-cursor-product
tags: [cursor, qa-only, generator, deterministic, rule, mcp, secret-safe]

requires:
  - phase: 04-deployment-reliability
    provides: Plan 07 atomic QA-only generator/product transition and retired public Dev tree
provides:
  - Closed deterministic four-file Cursor QA non-document product
  - Explicit Cursor manifest reference, QA-only Rule/skill, and non-Hook capability proofs
  - Metadata-only negative fixture evidence for inventory, wording, and disclosure boundaries
affects: [phase-04-pack, phase-04-release, phase-06-real-host-evidence]

actuals:
  tokens: 3301
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - Cursor product evidence is restricted to member names, versions, sizes, hashes, and booleans
    - Generated Cursor Rule/skill/MCP references are project-relative and validated inside the product root

key-files:
  created:
    - tests/generator/cursor-product.test.cts
    - .planning/phases/04-deployment-reliability/04-09-SUMMARY.md
  modified:
    - kcoderag-cursor/.cursor-plugin/plugin.json
    - kcoderag-cursor/rules/kcoderag-navigation.mdc
    - kcoderag-cursor/skills/code-lookup-discipline/SKILL.md
  verified:
    - kcoderag-cursor/mcp.json

key-decisions:
  - "Plan 04-09 production generation remains attributed to the user-approved atomic QA-only commit 022a9d8; verification closure does not rewrite already-canonical product bytes."
  - "Cursor remains an always-on Rule, skill, and MCP integration and is tested to reject PreToolUse or Hook-equivalence claims."
  - "Product-test failures use stable metadata-only codes so negative fixtures cannot place MCP configuration contents in evidence."

patterns-established:
  - "Closed Cursor inventory: exactly manifest, MCP projection, Rule, and skill outside the separately owned README."
  - "Negative product fixtures: missing/extra members and Dev/Hook wording fail with stable non-content error codes."

requirements-completed: [DEP-01]

coverage:
  - id: D1
    description: "The Cursor QA non-document product is a deterministic closed four-file inventory with fresh-render byte identity."
    requirement: DEP-01
    verification:
      - kind: integration
        ref: "tests/generator/cursor-product.test.cts#Cursor non-document product is a closed deterministic four-file inventory; 5/5 plan tests passed"
        status: pass
      - kind: integration
        ref: "node dist/generator/index.cjs --package cursor --group metadata-config|metadata-guidance --check; zero changed paths"
        status: pass
    human_judgment: false
  - id: D2
    description: "Cursor manifest references resolve inside the product and its guidance stays QA-only and Rule/skill/MCP-specific."
    requirement: DEP-01
    verification:
      - kind: unit
        ref: "tests/generator/cursor-product.test.cts#Cursor keeps the QA Rule, skill, and MCP capability boundary"
        status: pass
      - kind: unit
        ref: "tests/generator/cursor-product.test.cts#Cursor product rejects Dev and Hook-equivalence wording deterministically"
        status: pass
    human_judgment: false
  - id: D3
    description: "Cursor product evidence contains metadata and booleans only and rejects content-bearing fields."
    requirement: DEP-01
    verification:
      - kind: unit
        ref: "tests/generator/cursor-product.test.cts#Cursor evidence schema rejects any content-bearing field"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-08-25
status: complete
---

# Phase 04 Plan 09: Cursor QA Product Closure Summary

**Cursor now has a closed deterministic QA-only manifest/MCP/Rule/skill product with explicit internal-reference, capability-boundary, and metadata-only evidence checks.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-08-25T07:30:30Z
- **Completed:** 2026-08-25T07:40:33Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Verified that canonical Cursor metadata/config and metadata/guidance rendering produces zero changed bytes and that the repository-wide QA/Cursor generation check remains clean.
- Closed the non-document Cursor inventory at exactly four files and verified fresh temporary generation against repository hashes and package version identity.
- Proved that manifest MCP/Rule/skill references resolve within the product and that Cursor guidance is QA-only without PreToolUse or Hook-equivalence claims.
- Added deterministic negative fixtures for missing/extra members, Dev wording, capability spoofing, and content-bearing evidence while keeping failures metadata-only.

## Task Commits

1. **Task 1: Regenerate the complete Cursor QA navigation path** - `022a9d8` (shared user-approved atomic GREEN implementation; fresh verification produced zero writes)
2. **Task 2: Close and verify the Cursor non-document product** - `022a9d8` (initial test) and `08b6ce4` (threat-model and negative-fixture closure)

**Implementation provenance:** Commit `022a9d8` intentionally absorbed Plan 04-09 together with the QA-only canonical transition because the normal pre-commit hook rejects partial generated-product states.

## Files Created/Modified

- `kcoderag-cursor/mcp.json` - Existing QA MCP projection, freshly rendered and hash-verified without exposing its values.
- `kcoderag-cursor/.cursor-plugin/plugin.json` - QA-only compatibility metadata and project-relative MCP/Rule/skill references.
- `kcoderag-cursor/rules/kcoderag-navigation.mdc` - Always-on QA structural navigation Rule.
- `kcoderag-cursor/skills/code-lookup-discipline/SKILL.md` - Shared QA lookup discipline with local fallback guidance.
- `tests/generator/cursor-product.test.cts` - Exact inventory, deterministic render, reference, negative wording, and metadata-only evidence proof.

## Decisions Made

- Kept all production bytes under the original atomic `022a9d8` provenance; the verification-only closure did not rewrite canonical Cursor artifacts.
- Treated Rule/skill/MCP wording as the only valid Cursor capability claim and made PreToolUse or Hook-equivalence wording a stable test failure.
- Restricted failure evidence to stable codes and product metadata; no MCP connection or authorization value is included in diagnostics.

## Deviations from Plan

### User-Approved Architectural Resolution

**1. [Rule 4 - Atomicity] Production work was absorbed by Plan 04-07**
- **Found during:** Original Plan 04-07 GREEN commit
- **Issue:** The normal pre-commit gate rejected a partially transitioned generator/product repository.
- **Decision:** The user selected the single atomic migration option.
- **Implementation:** Commit `022a9d8` regenerated the Cursor product together with the QA-only canonical product switch and Dev retirement.
- **Verification:** Both exact Plan 04-09 generation commands reported empty `changedPaths` and `writtenPaths`; repository generation also reported zero drift.

### Auto-fixed Issues

**2. [Rule 2 - Missing Critical] Completed explicit threat-model negative fixture coverage**
- **Found during:** Plan 04-09 verification audit
- **Issue:** The absorbed product test checked only the healthy repository state and did not directly prove that missing/extra members, Dev/Hook wording, unresolved manifest references, or content-bearing evidence fail deterministically.
- **Fix:** Added reference validation, stable error codes, negative product fixtures, and a closed metadata-only evidence schema.
- **Files modified:** `tests/generator/cursor-product.test.cts`
- **Verification:** `npm run build && node --test dist-tests/generator/cursor-product.test.cjs` passed 5/5; full `npm test` exited 0.
- **Committed in:** `08b6ce4`

---

**Total deviations:** 1 prior user-approved atomic implementation resolution and 1 missing-critical test closure.
**Impact on plan:** The final behavior and five-file ownership match the plan. No production scope, MCP value, Phase 05 Hook precision, or Phase 06 real-host claim was added.

## Threat-Model Verification

| Threat | Mitigation evidence | Result |
|--------|---------------------|--------|
| T-04-09-01 product tampering | Exact member set, fresh render hashes, missing/extra fixtures, full generation check | PASS |
| T-04-09-02 capability spoofing | QA/Rule assertions plus Dev and PreToolUse/Hook-equivalence negative fixtures | PASS |
| T-04-09-03 information disclosure | Closed evidence schema permits only paths, versions, sizes, hashes, and booleans | PASS |

## Fresh Evidence

- Exact Task 1 command: both write passes and both check passes returned `ok:true`, version `0.1.8`, and no changed or written paths.
- Exact Task 2 command: build succeeded and the compiled Cursor product suite passed 5/5 with zero failures, skips, or todos.
- `npm run generate:check`: passed with no changed paths or diagnostics across all current QA/Cursor assets.
- `npm test`: full serialized repository regression suite exited 0 after the final test change.
- Post-verification Git status shows no Cursor or other production-file changes; only the user's pre-existing planning/config and untracked work remains.

## Issues Encountered

- The absorbed test was narrower than the plan's explicit negative-fixture acceptance criteria. This was corrected in the plan-owned test without changing production behavior.

## Authentication Gates

None.

## Known Stubs

None.

## User Setup Required

None - no external service mutation, credential access, or manual configuration was required.

## Next Phase Readiness

- Cursor QA generated-product ownership is closed and ready for Phase 04 pack/release validation.
- Cursor real-host MCP registration and graph-query evidence remain correctly deferred to Phase 06.

## Self-Check: PASSED

- All four Cursor non-document artifacts and the plan-owned test exist.
- Commits `022a9d8` and `08b6ce4` exist in history.
- Fresh exact plan commands, repository generation, and the full regression suite pass after the last change.

---
*Phase: 04-deployment-reliability*
*Completed: 2026-08-25*
