---
phase: 04-deployment-reliability
plan: 13
subsystem: deployment-assurance
tags: [smoke, pre-commit, github-actions, npm-pack, codex, claude-code, cursor]

requires:
  - phase: 04-deployment-reliability
    provides: Plan 12 exact local release preparation and Plan 11 immutable artifact/evidence validators
  - phase: 04-deployment-reliability
    provides: Plans 07-10 QA/Cursor-only generated products and retired public Dev inventory
provides:
  - Real acquired-package QA lifecycle smoke with preinstall, doctor, selected-host conflict, and uninstall-exception evidence
  - Installed Codex/Claude registered Hook execution from project root and Unicode/space deep children plus honest Cursor Rule/skill/MCP evidence
  - Index-immutable QA/Cursor pre-commit groups with explicit retired Dev and marketplace-root refusal
  - Stable exact Ubuntu/Windows Node 22/24 CI and release lane identities with immutable checkout and publish-step-only npm authority
affects: [phase-04-release, phase-04-head-acceptance, phase-05-hook-precision, phase-06-real-host-evidence]

actuals:
  tokens: 12854
  tasks: 3
  commits: 8

tech-stack:
  added: []
  patterns:
    - Required package smoke uses isolated synthetic native inventories and persists only closed booleans and SHA-256 fingerprints
    - Pre-commit classifies canonical, QA, Cursor, and retired roots before check-only build/generation commands
    - GitHub matrix include entries provide stable lane identities separate from runner labels

key-files:
  created:
    - .planning/phases/04-deployment-reliability/04-13-SUMMARY.md
  modified:
    - src/smoke/host-smoke.cts
    - tests/smoke/host-smoke.test.cts
    - src/maintainer/pre-commit.cts
    - tests/maintainer/pre-commit.test.cts
    - .github/workflows/ci.yml
    - .github/workflows/release.yml
    - tests/maintainer/ci-contract.test.cts
    - tests/maintainer/release-workflow.test.cts

key-decisions:
  - "Required-contract smoke injects bounded empty Codex/Claude native inventories through an isolated Node preload, never depending on or mutating a developer's installed host CLI."
  - "Codex and Claude smoke executes the command registered by the acquired package; Cursor records Rule/skill/MCP evidence without claiming PreToolUse equivalence."
  - "CI and Release use four explicit lane tuples with github.sha checkout binding; one matrix job remains sufficient because GitHub needs waits for every matrix child before publish."
  - "Optional live smoke retains its narrower real-host evidence set rather than treating required-only synthetic conflict bits as failures."

patterns-established:
  - "Closed smoke receipts: lifecycle results expose booleans and digests, never command, config, path, process body, header, or token fields."
  - "Retired staging gate: Dev deletions and old root marketplace additions fail before build while the alternate index and worktree remain byte-identical."
  - "Exact remote lanes: ubuntu-node-22, ubuntu-node-24, windows-node-22, and windows-node-24 are the only required matrix identities."

requirements-completed: [DEP-01, DEP-02, DEP-03]

coverage:
  - id: D1
    description: "A real acquired package completes QA-only preinstall/install/status/doctor/update/conflict/uninstall semantics for Codex, Claude Code, and Cursor."
    requirement: DEP-01
    verification:
      - kind: e2e
        ref: "npm run smoke:required; required-contract PASS for all three hosts"
        status: pass
      - kind: integration
        ref: "tests/smoke/host-smoke.test.cts; 11/11"
        status: pass
    human_judgment: false
  - id: D2
    description: "Installed Codex/Claude Hook commands execute from root and Unicode/space deep children with one project fingerprint; Cursor remains Rule/skill/MCP-only."
    requirement: DEP-02
    verification:
      - kind: e2e
        ref: "tests/smoke/host-smoke.test.cts#exact and latest preserve acquired-manifest and synthetic-tarball provenance across all hosts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Pre-commit rejects partial QA/Cursor or retired-product staging without mutating alternate-index bytes, OIDs, or unrelated work."
    requirement: DEP-01
    verification:
      - kind: integration
        ref: "tests/maintainer/pre-commit.test.cts; 8/8"
        status: pass
    human_judgment: false
  - id: D4
    description: "Ordinary CI and tag Release expose the same exact four immutable lanes, while NPM_TOKEN exists only in the post-gate publish step."
    requirement: DEP-03
    verification:
      - kind: unit
        ref: "tests/maintainer/ci-contract.test.cts; 6/6"
        status: pass
      - kind: unit
        ref: "tests/maintainer/release-workflow.test.cts; 7/7"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-08-25
status: complete
---

# Phase 04 Plan 13: Cross-Platform Deployment Assurance Summary

**Real-package three-host lifecycle evidence, index-safe QA/Cursor staging, and exact four-lane CI/release contracts now share one closed QA-only deployment gate.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-08-25T11:01:20Z
- **Completed:** 2026-08-25T11:23:34Z
- **Tasks:** 3
- **Files modified:** 8 production/test/workflow files plus this summary

## Accomplishments

- Expanded required smoke from eleven shallow bits to an eighteen-bit lifecycle contract covering both read-only commands, preinstall readiness, active selected-host conflicts, blocked no-write install/update, and conflict-tolerant uninstall.
- Executed the actual installed Codex/Claude registered command from project root and a Unicode/space deep child, while recording only validity booleans and fingerprints; Cursor stays honestly Rule/skill/MCP-only.
- Split pre-commit generated ownership into QA and Cursor groups, rejected staged Dev deletions and retired marketplace roots before commands, and retained exact alternate-index/worktree immutability.
- Replaced implicit cross-product labels with four stable lane tuples in ordinary CI and tag Release, bound every checkout to `github.sha`, disabled checkout credential persistence, and kept npm credentials inside the final publish step only.
- Revalidated the final tree with focused workflow, smoke, pre-commit, deterministic generation, and real pack gates without running publication or the Plan 15-owned complete `ci:local`.

## Task Commits

1. **Task 1 RED: Specify complete real-package smoke** - `4af0bf4` (test)
2. **Task 1 GREEN: Expand required package smoke** - `557d4fa` (feat)
3. **Task 2 RED: Specify QA-only pre-commit groups** - `0324700` (test)
4. **Task 2 GREEN: Enforce QA-only pre-commit ownership** - `d5bb095` (fix)
5. **Task 3 RED: Specify exact CI and release lanes** - `4bb79f5` (test)
6. **Task 3 GREEN: Bind exact four-lane release contracts** - `94a961f` (ci)
7. **Rule 1 RED: Reproduce optional smoke scope regression** - `5c46512` (test)
8. **Rule 1 GREEN: Preserve optional live evidence scope** - `fffc167` (fix)

## Files Created/Modified

- `src/smoke/host-smoke.cts` - Isolated native inventory runner, five-command lifecycle, source-conflict gates, registered root/deep navigation, and closed evidence fingerprints.
- `tests/smoke/host-smoke.test.cts` - Eighteen-bit required matrix, no-selector QA proof, root/deep capability boundary, receipt schema, and optional-live regression.
- `src/maintainer/pre-commit.cts` - Separate QA/Cursor generated groups and explicit staged retired-product refusal.
- `tests/maintainer/pre-commit.test.cts` - Complete/partial QA and Cursor, deleted Dev, old marketplace, canonical partial, unrelated dirty/untracked, and alternate-index fixtures.
- `.github/workflows/ci.yml` - Exact four required lanes with stable names and immutable credential-free checkouts.
- `.github/workflows/release.yml` - Matching tag lanes and publish-after-matrix npm credential boundary.
- `tests/maintainer/ci-contract.test.cts` - Exact CI jobs/lanes, head binding, required gates, and no-publish authority assertions.
- `tests/maintainer/release-workflow.test.cts` - Exact Release jobs/lanes, matrix dependency, tag subject binding, and publish-step-only secret assertions.

## Decisions Made

- Used an isolated Node preload to provide deterministic empty Codex/Claude native inventories on Windows and Linux CI. The interception is scoped to temporary acquired-package processes and never alters the optional live host path.
- Treated the registered command as sensitive operational detail for smoke output: it is used in memory, hashed into a fingerprint, and never returned in receipts.
- Kept Cursor's root/deep evidence tied to the same project Rule/skill/MCP asset set instead of presenting it as a Hook event.
- Used explicit matrix `include` entries so job names and evidence tuples cannot silently expand through a new axis or substitute runner.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved optional-live PASS semantics after expanding required evidence**
- **Found during:** Final Task 3 review
- **Issue:** Adding required-only preinstall/doctor/source-conflict bits to the shared evidence object made a successful optional real-host run impossible to mark PASS.
- **Fix:** Added a closed optional-live required-key set while retaining explicit QA-only proof; required-contract still requires all eighteen bits.
- **Files modified:** `src/smoke/host-smoke.cts`, `tests/smoke/host-smoke.test.cts`
- **Verification:** Focused RED/GREEN optional test, then final 11/11 smoke and `smoke:required` PASS.
- **Committed in:** `5c46512`, `fffc167`

**2. [Rule 2 - Missing Critical] Rejected retired root marketplace paths as well as Dev**
- **Found during:** Task 2 ownership-map update
- **Issue:** The former generated-root list treated retired `.agents/plugins`, `.claude-plugin`, and `.cursor-plugin` files as current generated products, allowing them to reach build/generation checks instead of failing explicitly.
- **Fix:** Moved all retired roots into the pre-command refusal set with exact alternate-index fixtures.
- **Files modified:** `src/maintainer/pre-commit.cts`, `tests/maintainer/pre-commit.test.cts`
- **Verification:** Pre-commit 8/8, including staged Dev deletion and three marketplace-root additions with unchanged index/OIDs/worktree bytes.
- **Committed in:** `d5bb095`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing-critical ownership boundary).
**Impact on plan:** Both fixes preserve existing optional behavior and enforce the already-locked no-marketplace constraint; no new distribution surface or host capability was added.

## Issues Encountered

- The first synthetic Codex raw-MCP marker used the generic `kcoderag` key, while Codex intentionally recognizes only the exact historical/current `kcoderag-qa`, `kcoderag-dev`, and `kcoderag-nav` keys. The fixture was narrowed to `kcoderag-qa`; Claude and Cursor fixtures were already correct.
- The repository does not contain the workflow skill's `scripts/ci_monitor.cjs`, so workflow syntax was checked against GitHub's official workflow-syntax documentation and the repository's exact contract tests. No live workflow or release was triggered.

## Authentication Gates

None. `NPM_TOKEN` was neither read nor used.

## Known Stubs

None. No skipped tests, TODOs, FIXMEs, placeholders, or unrun plan verifications remain.

## Verification Evidence

- `npm run build` - PASS.
- `npm run test:ci-contract` - 6/6.
- `npm run test:release-workflow` - 7/7.
- `npm run test:smoke` - 11/11.
- `npm run smoke:required` - exit 0 and required-contract PASS for all three hosts.
- `npm run test:precommit` - 8/8.
- `npm run generate:check` - 18 selected QA/Cursor paths, zero changed/written paths.
- `npm run pack:audit` - exact `0.1.8`, 48 entries.
- Complete `npm run ci:local` was intentionally not run because Plan 13 assigns the final documented implementation subject to Plan 15 after Plan 19 documentation/audit work.

## User Setup Required

None - no external service configuration or credential action is required for this plan.

## Next Phase Readiness

- Plan 15 can consume stable ordinary CI job identities for final evidence binding after the remaining documentation/audit work.
- Release publish remains automatically gated by all four tag matrix children, with no human approval checkpoint and no credential exposure to required lanes.
- Phase 05 Hook precision, Phase 06 authenticated real MCP evidence, and actual `0.2.0` publication remain correctly deferred.

## Self-Check: PASSED

- All eight declared plan files exist and the eight task/deviation commits are reachable.
- The final focused gate passed after the last production change.
- Only the user's pre-existing `.planning/config.json` modification and unrelated untracked planning/GSD files remain outside this plan.

---
*Phase: 04-deployment-reliability*
*Completed: 2026-08-25*
