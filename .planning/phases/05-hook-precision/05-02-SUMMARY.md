---
phase: 05-hook-precision
plan: "02"
subsystem: host-adapters
tags: [session-start, claude-code, zcode, cursor, opencode, packaged-smoke]

requires:
  - phase: 05-hook-precision
    provides: shared SessionStart/session-end section kinds, normalized dispatcher, reminder governor, and feedback state from Plan 05-01
provides:
  - Native Claude Code and ZCode startup/resume/clear/compact SessionStart projections through the shared dispatcher
  - Honest Cursor Rule/Skill/MCP/afterMCPExecution projection with no synthetic lifecycle or PreToolUse claim
  - Closed, bounded OpenCode tool.execute.after facts with isolated fail-open marker, feedback, and update callbacks
  - Five-host packaged smoke evidence that treats unsupported Cursor update hooks as explicitly absent
affects: [05-03, 05-04, 05-05, 05-06, generator, packaged-smoke, live-evidence]

actuals:
  tokens: 21174
  tasks: 2
  commits: 5

tech-stack:
  added: []
  patterns:
    - Host adapters project only proven native event surfaces while reusing the central dispatcher and governor
    - Plugin callbacks reduce native payloads to closed booleans and bounded identifiers before shared policy code
    - Packaged evidence records unsupported event lanes as false instead of treating their absence as failure

key-files:
  created:
    - tests/hosts/native-lifecycle.test.cts
    - tests/hosts/honest-events.test.cts
  modified:
    - plugin-src/hooks/hooks.json
    - src/hosts/claude.cts
    - src/hosts/zcode.cts
    - src/hosts/cursor.cts
    - plugin-src/opencode/kcoderag-nav.js
    - src/smoke/host-smoke.cts

key-decisions:
  - "Claude Code and ZCode register the same bounded startup/resume/clear/compact SessionStart lane, while unproved SessionEnd cleanup remains absent."
  - "Cursor remains Rule/Skill/MCP plus afterMCPExecution only; packaged evidence records updateNotice and updateRefresh as false rather than restoring an unsupported postToolUse hook."
  - "OpenCode callbacks pass only bounded session/tool/success facts to marker and feedback logic, with each callback boundary isolated fail-open."

patterns-established:
  - "Native lifecycle merge: add one contributor-owned section, preserve unrelated entries exactly, and reconcile stale managed event lanes deterministically."
  - "Unsupported-surface evidence: absence is an explicit contract fact, not an inferred failure and never a cross-host equivalence claim."

requirements-completed: [HOOK-06, HOOK-07, HOOK-08, ROUT-05, TEST-08, TEST-09, TEST-11]

coverage:
  - id: D1
    description: "Claude Code and ZCode merge bounded native SessionStart events without duplicate sections, unrelated-entry loss, or unproved SessionEnd cleanup."
    requirement: TEST-08
    verification:
      - kind: integration
        ref: "tests/hosts/native-lifecycle.test.cts#Claude and ZCode native lifecycle matrix"
        status: pass
    human_judgment: false
  - id: D2
    description: "Cursor exposes Rule, Skill, MCP, and afterMCPExecution only, preserving marker bounds and unrelated project content across lifecycle operations."
    requirement: TEST-09
    verification:
      - kind: integration
        ref: "tests/hosts/honest-events.test.cts#Cursor honest surface matrix"
        status: pass
      - kind: e2e
        ref: "tests/smoke/host-smoke.test.cts#five-host packaged readiness artifact"
        status: pass
    human_judgment: false
  - id: D3
    description: "OpenCode remains project-only and reduces real tool.execute.after outcomes to closed marker, feedback, and update facts without exposing callback bodies."
    requirement: HOOK-08
    verification:
      - kind: integration
        ref: "tests/hosts/honest-events.test.cts#OpenCode closed callback matrix"
        status: pass
      - kind: unit
        ref: "tests/hooks/opencode-update-notice.test.cts#closed outcome and fail-open callbacks"
        status: pass
    human_judgment: false
  - id: D4
    description: "Canonical generated hook evidence includes bounded SessionStart, PreToolUse, and PostToolUse lanes while Cursor packaged evidence rejects unsupported lifecycle/update-hook equivalence."
    requirement: TEST-11
    verification:
      - kind: integration
        ref: "npm test (465/465) && npm run generate:check"
        status: pass
    human_judgment: false

duration: 21min
completed: 2026-09-02
status: complete
---

# Phase 05 Plan 02: Native Lifecycle and Honest Host Events Summary

**Claude Code and ZCode now consume the shared SessionStart governor through native lifecycle events, while Cursor and OpenCode expose only their proven Rule/plugin event surfaces with closed fail-open facts.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-09-01T17:56:24Z
- **Completed:** 2026-09-01T18:16:51Z
- **Tasks:** 2
- **Files modified:** 16

## Accomplishments

- Added one bounded startup/resume/clear/compact SessionStart lane to Claude Code and ZCode, preserving unrelated native registrations, stable session/source identity, transactional rollback, and the receipt gate around SessionEnd cleanup.
- Reduced Cursor to its real Rule/Skill/MCP/afterMCPExecution surface and made both adapter and packaged smoke evidence reject synthetic SessionStart, PreToolUse, and postToolUse equivalence.
- Closed OpenCode `tool.execute.after` inputs to bounded session/tool/success facts before marker, feedback, and update handling; each callback remains independently fail-open.
- Regenerated the two affected canonical product files and verified the complete repository with 465 passing tests plus deterministic generation checks.

## Task Commits

Each TDD task was committed as a RED/GREEN pair, followed by one direct full-suite compatibility fix:

1. **Task 1: Project proven native lifecycle events into Claude Code and ZCode**
   - `b3a9a98` — test: add failing native lifecycle matrix
   - `45de5b6` — feat: project native lifecycle events
2. **Task 2: Project honest Cursor Rule/events and OpenCode plugin callbacks**
   - `02b4d5c` — test: add failing honest event matrix
   - `0f783a9` — feat: enforce honest host event surfaces
3. **Full-suite compatibility fix**
   - `0d363b8` — fix: align packaged evidence with honest events

## Files Created/Modified

- `tests/hosts/native-lifecycle.test.cts` — Exercises Claude/ZCode merge, source identity, idempotency, rollback, malformed payload, and receipt-gated cleanup behavior.
- `tests/hosts/honest-events.test.cts` — Proves Cursor and OpenCode native-surface honesty, closed callback facts, secret canaries, idempotency, and rollback.
- `plugin-src/hooks/hooks.json` — Registers bounded SessionStart alongside existing PreToolUse/PostToolUse lanes.
- `src/hosts/claude.cts` — Projects and reconciles contributor-owned Claude SessionStart sections.
- `src/hosts/zcode.cts` — Projects the same lifecycle policy through ZCode process hooks without taking workspace-trust authority.
- `src/hosts/cursor.cts` — Removes stale synthetic pre/post lanes and keeps only the proven afterMCPExecution observation.
- `plugin-src/opencode/kcoderag-nav.js` — Normalizes real plugin outcomes into bounded marker, feedback, and update facts.
- `src/smoke/host-smoke.cts` — Evaluates Cursor packaged runtime through afterMCPExecution and explicit unsupported update lanes.
- `kcoderag-qa/hooks/hooks.json` and `kcoderag-qa/opencode/kcoderag-nav.js` — Deterministic generated products for the canonical source changes.

## Decisions Made

- Reused the Plan 05-01 session-start section kind unchanged; no shared contract widening was needed.
- Kept SessionEnd unregistered because no frozen receipt proves stable native session identity for these projections.
- Represented absent Cursor update-notice/refresh hook lanes as explicit `false` fields in packaged evidence, with completeness rules keyed by `cursor_events`.
- Kept OpenCode project-only and never promoted plugin callbacks, Rule presence, or packaged execution to native-host LIVE evidence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated directly impacted adapter expectations**
- **Found during:** Task 1 and Task 2 GREEN verification
- **Issue:** Existing ZCode, Cursor, and OpenCode callback tests encoded the superseded event shapes and failed after the intended host projections changed.
- **Fix:** Updated only the directly impacted assertions to require the new native lifecycle entries and closed facts.
- **Files modified:** `tests/hosts/zcode.test.cts`, `tests/hosts/cursor.test.cts`, `tests/hooks/opencode-update-notice.test.cts`
- **Verification:** Task-focused host matrices passed.
- **Committed in:** `45de5b6`, `0f783a9`

**2. [Rule 3 - Blocking] Materialized required generated products before normal commits**
- **Found during:** Task 1 and Task 2 pre-commit gates
- **Issue:** The repository gate correctly refused canonical source changes while their checked-in generated products were stale.
- **Fix:** Ran the deterministic generator and staged only the two corresponding generated files.
- **Files modified:** `kcoderag-qa/hooks/hooks.json`, `kcoderag-qa/opencode/kcoderag-nav.js`
- **Verification:** `npm run generate:check` returned no changed or written paths.
- **Committed in:** `45de5b6`, `0f783a9`

**3. [Rule 1 - Bug] Aligned full-suite packaged evidence with honest event surfaces**
- **Found during:** Overall `npm test`
- **Issue:** Generator/launcher tests still hard-coded a two-event Hook manifest, and packaged Cursor smoke still required the removed synthetic postToolUse update runtime.
- **Fix:** Added bounded SessionStart assertions and made Cursor packaged evidence require Rule/Skill/MCP/afterMCPExecution while explicitly recording update-notice/refresh as unsupported.
- **Files modified:** `tests/generator/qa-product.test.cts`, `tests/hooks/launcher.test.cts`, `src/smoke/host-smoke.cts`, `tests/smoke/host-smoke.test.cts`
- **Verification:** Focused regression set passed 40/40; complete suite passed 465/465.
- **Committed in:** `0d363b8`

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bugs, 1 Rule 3 blocking generated-product gate)
**Impact on plan:** All changes are direct compatibility and evidence corrections required by the planned host semantics; no dependency, shared contract, or native-surface scope was added.

## Issues Encountered

- The complete suite caught stale packaged evidence after focused host tests had passed. The correction strengthened the no-equivalence rule instead of restoring the unsupported Cursor hook.
- The roadmap progress helper inserted a duplicate bare plan checklist and malformed the phase table spacing; the tracking artifact was normalized to the existing detailed checklist while retaining the helper's 2/6 result.

## Known Stubs

None. Empty arrays and empty strings found by the mechanical scan are bounded collectors/defaults or validation predicates, not UI or runtime placeholders; no tests are skipped or marked todo.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 05-03 can close deterministic generation and exact-package evidence using canonical SessionStart/OpenCode assets that already pass repository-wide generation checks.
- Native-host LIVE evidence remains a later Phase 05 responsibility; this plan establishes packaged and adapter facts only and makes no LIVE claim.

## Self-Check: PASSED

- Summary and all 16 realized-diff files exist.
- All five task/fix commits resolve as Git commits.
- `src/capabilities/contracts.cts` is unchanged from the 05-01 completion baseline.
- Coverage metadata classifies all four deliverables without schema errors.
- Fresh complete verification passed 465/465 with no skipped or todo tests; deterministic generation check reported zero drift.

---
*Phase: 05-hook-precision*
*Completed: 2026-09-02*
