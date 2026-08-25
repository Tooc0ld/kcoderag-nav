---
phase: 04-deployment-reliability
plan: 06
subsystem: deployment
tags: [claude-code, cursor, source-diagnostics, native-cleanup, host-isolation]

requires:
  - phase: 04-05
    provides: shared source finding, scan mode, fingerprint, and cleanup authority contracts
provides:
  - Claude Code source diagnosis with versioned native capability preflight and scoped cleanup
  - Cursor source diagnosis with explicit Rule semantics and manual-only cleanup boundary
  - selected-host scan isolation and mutually exclusive cleanup/migration authority
affects: [04-07, deployment-reliability, status, doctor, host-adapters]

actuals:
  tokens: 18176
  tasks: 3
  commits: 7

tech-stack:
  added: []
  patterns: [exact host inventory schemas, injected native runners, safe-path-only findings, one-host scan dispatch]

key-files:
  created: []
  modified:
    - src/hosts/claude.cts
    - src/hosts/cursor.cts
    - src/hosts/user-sources.cts
    - src/cli/commands.cts
    - src/smoke/stub-mcp-server.cts
    - tests/hosts/cross-host.test.cts

key-decisions:
  - "Claude cleanup is eligible only after the observed 2.1.241+ CLI passes exact help and inventory schemas; plugin uninstall keeps its observed scope and marketplace removal requires exclusive ownership."
  - "Cursor Rule sources have their own manual_rule type and never claim Hook or native cleanup equivalence."
  - "Owned source cleanup and legacy Dev migration remain independent, mutually exclusive authorities."

patterns-established:
  - "Selected-host diagnosis: one command resolves and scans exactly one adapter; sibling host state is neither enumerated nor aggregated."
  - "Native cleanup proof: capability, inventory schema, argv, scope, plan identity, and fingerprint are frozen before authority can execute."

requirements-completed: [DEP-03]

coverage:
  - id: D1
    description: "Claude Code classifies source tiers and exposes only exact scoped native cleanup plans."
    requirement: DEP-03
    verification:
      - kind: integration
        ref: "tests/hosts/claude.test.cts#Claude source diagnosis and cleanup matrix"
        status: pass
    human_judgment: false
  - id: D2
    description: "Cursor classifies plugin, MCP, Rule, cache, and ambiguous sources without fabricating native cleanup."
    requirement: DEP-03
    verification:
      - kind: integration
        ref: "tests/hosts/cursor.test.cts#Cursor source diagnosis boundaries"
        status: pass
    human_judgment: false
  - id: D3
    description: "Commands scan one selected host, preserve cross-host coexistence, and reject mixed authorities."
    requirement: DEP-03
    verification:
      - kind: e2e
        ref: "tests/hosts/cross-host.test.cts and tests/cli/commands.test.cts"
        status: pass
      - kind: other
        ref: "npm test (248/248), npm run generate:check, npm run pack:audit"
        status: pass
    human_judgment: false

duration: 31min
completed: 2026-08-25
status: complete
---

# Phase 04 Plan 06: Three-host Source Diagnostics Summary

**Claude Code now has exact capability-gated native cleanup, Cursor has honest manual-only Rule-aware diagnosis, and every lifecycle command scans only its selected host.**

## Performance

- **Duration:** 31 min
- **Started:** 2026-08-25T16:50:13+08:00
- **Completed:** 2026-08-25T17:21:27+08:00
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- Added bounded, secret-safe Claude Code plugin and marketplace inventory parsing with exact 2.1.241+ capability preflight, 5-second calls, scoped plugin uninstall, and exclusive marketplace ownership proof.
- Added Cursor plugin/MCP/Rule/cache source diagnosis that preserves Cursor's Rule/skill distinction and never invents a Hook or native cleanup command.
- Proved selected-host-only scanning, cross-host QA coexistence, project-only uninstall, fingerprint-bound cleanup, and cleanup/legacy authority separation.

## Task Commits

Each TDD task was committed atomically:

1. **Task 1: Add Claude Code source diagnosis and native owned-plugin cleanup** - `b3f0bc3` (RED), `947f2b1` (GREEN)
2. **Task 2: Add Cursor diagnosis without inventing an unsafe cleanup equivalent** - `b42aef3` (RED), `1624e65` (GREEN)
3. **Task 3: Prove selected-host scanning, cleanup authority, and cross-host coexistence** - `32f26f0` (RED), `691b20b` (GREEN)
4. **Overall verification fix** - `6a6847f` (smoke harness correction)

## Files Created/Modified

- `src/hosts/claude.cts` - Claude metadata scanner, exact native capability preflight, inventory parsers, and scoped cleanup execution.
- `src/hosts/cursor.cts` - Cursor safe metadata scanner and exact legacy-state diagnosis without credential comparison.
- `src/hosts/user-sources.cts` - Shared `manual_rule` finding support and source serialization validation.
- `src/core/contracts.cts` - Public source type contract for Cursor Rules.
- `src/cli/commands.cts` - Exact Cursor legacy exception and mutually exclusive cleanup/migration authority.
- `src/smoke/stub-mcp-server.cts` - Deterministic loopback connection lifecycle for delayed multi-host smoke runs.
- `tests/hosts/claude.test.cts` - Claude schema, capability, source tier, cleanup, timeout, and secret-safety coverage.
- `tests/hosts/cursor.test.cts` - Cursor active/manual/legacy/ambiguous source coverage.
- `tests/hosts/cross-host.test.cts` - Fully isolated three-host lifecycle fixtures.
- `tests/cli/commands.test.cts` - Selected-host invocation and mixed-authority refusal coverage.

## Decisions Made

- Treat observed official/native help as a capability preflight, but require exact runtime JSON schemas before any destructive plan is eligible.
- Preserve Cursor's distinct Rule semantics through `manual_rule`; no verified Cursor uninstall means every conflicting Cursor source remains manual-only.
- Permit only an exact Cursor legacy source finding to reach the pre-existing, independently authorized migration path; raw MCP, manual Rule, drift, and ambiguity still hard-stop writes.
- Reject owned-source cleanup flags combined with legacy Dev migration before adapter detection so neither authority can widen the other.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added an honest public source type and exact legacy migration exception**

- **Found during:** Task 2
- **Issue:** The shared source vocabulary could represent only manual Hooks, which would mislabel Cursor Rules; adding the new source gate also made the exact separately authorized Cursor legacy migration block itself.
- **Fix:** Added `manual_rule` and allowed only the exact digest-verified legacy Cursor source finding to proceed to the existing migration authority.
- **Files modified:** `src/core/contracts.cts`, `src/hosts/user-sources.cts`, `src/cli/commands.cts`
- **Verification:** Cursor and CLI integration suites pass their active/manual/legacy matrices.
- **Committed in:** `1624e65`

**2. [Rule 1 - Bug] Removed stale keep-alive reuse from the multi-host loopback smoke stub**

- **Found during:** Overall verification
- **Issue:** Claude native preflight extended the idle gap beyond Node's default server keep-alive window, so the next host's first initialize request reused a stale connection and timed out before reaching the stub.
- **Fix:** The synthetic stub now closes each response connection; production MCP transport is unchanged.
- **Files modified:** `src/smoke/stub-mcp-server.cts`
- **Verification:** The formerly failing exact/latest three-host smoke passes, followed by the complete 248/248 suite.
- **Committed in:** `6a6847f`

---

**Total deviations:** 2 auto-fixed (1 missing critical contract, 1 verification harness bug)

**Impact on plan:** Both fixes preserve the locked host distinctions and make the planned three-host proof reliable without widening cleanup or runtime behavior.

## Issues Encountered

- The first complete run exposed the idle keep-alive race above. Safe receipt-count diagnostics isolated the missing initialize request; temporary diagnostics were removed before commit.

## User Setup Required

None - no external service configuration or real user cleanup was performed.

## Next Phase Readiness

- DEP-03 source diagnosis now applies consistently to Codex, Claude Code, and Cursor with selected-host isolation.
- Later plans can build on stable `status`/`doctor` and cleanup authority behavior; Phase 05 Hook precision and Phase 06 real authenticated MCP evidence remain explicitly unclaimed.

## Self-Check: PASSED

- All ten changed source/test files and seven implementation commits exist.
- `npm test` passed 248/248; generation check reported zero changed paths; pack audit accepted 48 entries.
- No skipped tests, TODO/FIXME stubs, credential output, or tracked-file deletions were introduced.

---
*Phase: 04-deployment-reliability*
*Completed: 2026-08-25*
