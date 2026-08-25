---
phase: 04-deployment-reliability
plan: 10
subsystem: npm-dev-entry-retirement
tags: [qa-only, npm-pack, manifests, legacy-migration, documentation-order, secret-safe]

requires:
  - phase: 04-deployment-reliability
    provides: Plan 14 root README and sole sibling guide synchronized before public Dev retirement
  - phase: 04-deployment-reliability
    provides: Plans 09 and 17 closed Cursor and QA replacement products
  - phase: 04-deployment-reliability
    provides: Plan 07 user-approved atomic QA-only generated-product transition
provides:
  - QA/Cursor/dist-only exact npm files allow-list with the public bin and Node runtime preserved
  - Verified absence of all four Dev MCP and compatibility discovery entries
  - Source-owned exact legacy Dev decode, migration, rollback, and uninstall evidence independent of deleted product bytes
  - Commit-order proof that both authoritative QA-only documents preceded retirement
affects: [phase-04-pack, phase-04-release, phase-04-dev-retirement, phase-04-head-acceptance]

actuals:
  tokens: 3192
  tasks: 2
  commits: 1

tech-stack:
  added: []
  patterns:
    - Public package retirement is proven from exact member paths and a real temporary tgz rather than broad directory assumptions
    - Historical Dev compatibility stays in exact source-owned state decoders and tests, never in generated discovery manifests

key-files:
  created:
    - .planning/phases/04-deployment-reliability/04-10-SUMMARY.md
  verified:
    - package.json
  absent:
    - kcoderag-dev/.codex.mcp.json
    - kcoderag-dev/.mcp.json
    - kcoderag-dev/.claude-plugin/plugin.json
    - kcoderag-dev/.codex-plugin/plugin.json

key-decisions:
  - "Plan 04-10 retains atomic implementation commit 022a9d8 because the normal pre-commit invariant required the QA-only canonical switch and every generated retirement counterpart to change together."
  - "Later package additions from Plans 04 and 05 remain valid because they preserve the exact QA/Cursor/dist-only boundary and add required compiled runtime modules without restoring Dev."
  - "The four retired MCP/config paths are verified only by filename absence; no connection, Header, Bearer, or configuration value enters evidence."
  - "Current Plan advances from 10 to 11 after this sequential main-tree closure; out-of-order Plan 17 was already recorded without skipping Plan 10."

patterns-established:
  - "Ordered retirement: root README commit 737c06c and sibling guide commit 879c7df0 precede atomic retirement commit 022a9d8."
  - "Closed archive: package allow-list, pack negative fixtures, and real tgz audit independently exclude Dev discovery and product paths."

requirements-completed: [DEP-01]

coverage:
  - id: D1
    description: "The public npm allow-list contains only exact QA, Cursor, and compiled runtime members while retaining the bin, Node engine, and zero runtime dependencies."
    requirement: DEP-01
    verification:
      - kind: integration
        ref: "Task 1 exact build/package assertion; 46 members = QA 13 + Cursor 5 + dist 28, Dev 0"
        status: pass
      - kind: integration
        ref: "npm run test:pack (10/10) and npm run pack:audit (48 exact tgz entries)"
        status: pass
    human_judgment: false
  - id: D2
    description: "All four Dev MCP/compatibility discovery entries are absent while exact legacy Dev migration and uninstall remain source-owned."
    requirement: DEP-01
    verification:
      - kind: integration
        ref: "Task 2 exact build/test:migration/path-absence sequence; migration 7/7"
        status: pass
      - kind: integration
        ref: "npm run generate:check and npm run test:release (8/8)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Both authoritative QA-only transition documents existed before the public discovery deletion."
    requirement: DEP-01
    verification:
      - kind: other
        ref: "README 737c06c ancestor check, sibling guide 879c7df0 presence/timestamp check, and explicit user-docs/sibling-guide policies"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-08-25
status: complete
---

# Phase 04 Plan 10: Public npm and Dev Discovery Retirement Summary

**The public archive is closed around QA, Cursor, and compiled CJS while every Dev discovery manifest is absent and exact legacy migration remains independently executable.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-08-25T09:47:48Z
- **Completed:** 2026-08-25T09:51:51Z
- **Tasks:** 2
- **Files modified:** 1 documentation artifact; 5 declared plan paths verified without writes

## Accomplishments

- Re-ran the exact Task 1 build and package assertion, proving no Dev member remains while QA, Cursor, bin, core, host, and maintainer runtime entries are preserved.
- Re-ran the exact Task 2 build, seven-case legacy migration suite, and four-path absence assertion without reading any retired MCP document.
- Audited a real temporary npm tgz: all 10 pack tests passed and the archive matched the exact 48-entry contract.
- Proved root README commit `737c06c` and sibling-guide commit `879c7df0` preceded retirement commit `022a9d8`, then revalidated both documents with their explicit maintenance policies.
- Verified later package changes add required compiled runtime files only and do not weaken the QA/Cursor/dist-only boundary.

## Task Commits

1. **Task 1: Remove Dev from npm's public allow-list** - `022a9d8` (shared user-approved atomic QA-only implementation); fresh package/build/pack verification required no write.
2. **Task 2: Delete all Dev host discovery manifests** - `022a9d8` (shared atomic deletion); fresh path and legacy-migration verification required no write.

**Implementation provenance:** Plan 04-07 established that the existing normal pre-commit gate cannot accept a half-transitioned generated repository. The user therefore approved one atomic commit spanning canonical selection, QA/Cursor replacement products, package retirement, and complete Dev tree deletion. Plan 04-10 retains logical ownership of the package allow-list and four discovery-path absences while verification keeps the broader deletion attributed to Plan 04-07/04-18.

## Files Created/Verified

- `package.json` - Exact 46-member public allow-list: 13 QA, 5 Cursor, and 28 compiled dist members; bin, Node 22 engine, metadata, scripts, and zero runtime dependencies preserved.
- `kcoderag-dev/.codex.mcp.json`, `kcoderag-dev/.mcp.json` - Retired MCP discovery projections confirmed absent by path only.
- `kcoderag-dev/.claude-plugin/plugin.json`, `kcoderag-dev/.codex-plugin/plugin.json` - Retired compatibility manifests confirmed absent by path only.
- `tests/migration/legacy-state.test.cts` - Source-owned exact Python/Node QA/Dev decode, explicit authority, drift refusal, migration/uninstall, and rollback proof.
- `.planning/phases/04-deployment-reliability/04-10-SUMMARY.md` - Verification closure and cross-repository retirement-order provenance.

## Decisions Made

- Kept production implementation at `022a9d8`; current package and absence checks prove the absorbed change remains correct.
- Accepted later `24a9cb9` and `d4a42a5` package inventory additions because they are required compiled modules and preserve the closed non-Dev archive.
- Distinguished empty root compatibility directories from actual marketplace catalogs; the prohibited root manifest files are absent and none enter the npm archive.
- Kept retirement evidence path-only for deleted MCP projections and retained Dev knowledge exclusively in exact source/test compatibility logic.

## Deviations from Plan

### Prior User-Approved Architectural Resolution

**1. [Rule 4 - Atomicity] Package/discovery retirement was absorbed by Plan 04-07**
- **Found during:** Original Plan 04-07 GREEN commit
- **Issue:** Removing only `package.json` and four discovery files left canonical/generated inventory inconsistent, and normal pre-commit correctly blocked the partial state.
- **Decision:** The user selected a single atomic QA-only canonical/generated/retirement commit.
- **Implementation:** `022a9d8` removed the package Dev members and four discovery paths together with the remaining Dev product and canonical source retirement.
- **Verification:** Exact Task 1/2 commands, generation, migration, release, and real tgz gates passed on the current tree.

### Verification Adjustments

**2. [Rule 3 - Blocking] Corrected documentation checker invocation**
- **Found during:** Extended transition-order verification
- **Issue:** A zero-argument `docs:check` call returned the expected stable `missing_policy` error because this maintainer CLI requires an explicit policy and path.
- **Resolution:** Re-ran with `--policy user-docs README.md` and `--policy sibling-guide ../KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md`; both returned `ok:true` with one checked file.
- **Files modified:** None.

**3. [Rule 3 - Verification] Narrowed root catalog assertion to actual manifest files**
- **Found during:** Package discovery metadata assertion
- **Issue:** Empty `.claude-plugin` and `.cursor-plugin` directories exist locally, so treating directory presence itself as a catalog was over-broad.
- **Resolution:** Asserted the six supported root plugin/marketplace manifest candidates are absent and confirmed the package contains none; no file content was inspected.
- **Files modified:** None.

---

**Total deviations:** One prior user-approved atomic implementation resolution and two verification-command corrections; no production deviation was required during Plan 04-10 closure.

## Verification Evidence

- Task 1 exact command - build passed and the allow-list assertion exited 0.
- Task 2 exact command - build passed, migration passed 7/7, and all four retired discovery paths were absent.
- Package metadata assertion - 46 exact allow-list members: QA 13, Cursor 5, dist 28, Dev 0; bin retained, Node `>=22`, runtime dependencies 0.
- `npm run generate:check` - 18 QA/Cursor generated assets, zero drift.
- `npm run test:pack` - 10/10 against a real temporary tgz and negative member, runtime, dependency, credential, and manifest fixtures.
- `npm run pack:audit` - exact `0.1.8`, 48 archive entries.
- `npm run test:release` - 8/8, including exact release paths and current dirty-state preservation.
- `npm run test:docs` - 7/7; corrected explicit project and sibling checks each returned `ok:true`.
- `git ls-files -- kcoderag-dev/**` - no tracked Dev product member.
- Post-verification package diff - empty; sibling guide SHA-256 remained unchanged from the precheck.

## Threat Model Closure

| Threat | Evidence | Result |
|--------|----------|--------|
| T-04-10-01 transition-order repudiation | Root commit ancestry, sibling commit timestamp/presence, both explicit documentation policies | Mitigated |
| T-04-10-02 package tampering | Exact allow-list assertion, generator closure, 10 negative pack tests, real 48-entry tgz audit | Mitigated |
| T-04-10-03 legacy migration denial of service | Source-owned seven-case legacy decoder/migration/uninstall/rollback suite | Mitigated |
| T-04-10-04 retired MCP information disclosure | Four path-absence assertions only; no retired MCP/config content entered evidence | Mitigated |

## Issues Encountered

- The maintenance docs CLI intentionally rejects missing policy input. Correct explicit invocations passed; no product issue remained.
- Empty local compatibility directories are not catalogs. All supported root manifest candidates and npm archive entries are absent.

## Authentication Gates

None.

## Known Stubs

None. The plan introduces no runtime/UI placeholder and leaves no skipped or todo test.

## User Setup Required

None - no external service, credential, user configuration, or live MCP endpoint was inspected or changed.

## Next Phase Readiness

- Sequential state can advance to Plan 11 for the final exact archive/pack gate.
- Plan 18 can close the already-absorbed remaining Dev tree deletion through path-only verification.
- Final `0.2.0` propagation and public release remain owned by later Phase 04 plans.

## Self-Check: PASSED

- The summary and `package.json` exist; all four declared Dev discovery paths are absent.
- Root production commits `737c06c`, `022a9d8`, `24a9cb9`, and `d4a42a5` plus sibling guide commit `879c7df0` are reachable.
- Exact task commands and all listed generator, migration, pack, release, and documentation gates passed on the current final production tree.
- Coverage classification accepted all three deliverables as fully automated and passing.
- No plan-owned production path changed during closure, and pre-existing dirty/untracked work remains untouched.

---
*Phase: 04-deployment-reliability*
*Completed: 2026-08-25*
