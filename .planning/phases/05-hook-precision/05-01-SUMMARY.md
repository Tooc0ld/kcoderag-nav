---
phase: 05-hook-precision
plan: "01"
subsystem: hooks
tags: [session-start, reminder-governor, semantic-routing, feedback, exact-tgz]

requires:
  - phase: 04.1-code-style
    provides: capability-scoped hooks, integrity receipts, and five-host adapters
  - phase: 04.2-public-debranding
    provides: exact-package readiness baseline and neutral generated assets
provides:
  - Exact-tgz Codex SessionStart tracer with PACKAGED-only evidence semantics
  - Hash-only epoch-aware reminder governor and receipt-gated SessionEnd cleanup
  - Low-noise structural lookup classification, index-aware routing, and feedback lifecycle
affects: [05-02, 05-03, 05-04, 05-05, 05-06, host-adapters, generated-product]

actuals:
  tokens: 39190
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - Closed metadata-only OS-cache records keyed by SHA-256 reminder identity
    - Eligibility-before-claim contributor dispatch with bounded fail-open output
    - Exact-package evidence levels that distinguish PACKAGED from native-host LIVE

key-files:
  created:
    - src/hooks/feedback-nudge.cts
    - tests/hooks/session-start.test.cts
    - tests/hooks/semantic-reminders.test.cts
    - tests/smoke/hook-tracer.test.cts
  modified:
    - src/hooks/pre-tool-dispatcher.cts
    - src/hooks/once-marker.cts
    - src/hooks/grep-nudge.cts
    - src/hooks/mcp-call-marker.cts
    - src/capabilities/navigation.cts
    - src/hosts/codex.cts
    - src/generator/index.cts

key-decisions:
  - "SessionStart contributor ordering is deterministic: navigation baseline first, then integrity/receipt-gated code-style and fresh-cache update fragments."
  - "Reminder identity is isolated by host, normalized managed root, capability, stable session, epoch, and reminder kind; raw identities and query/result bodies are never stored."
  - "Direct launcher and exact-tgz execution remain PACKAGED evidence; only a native-host observation may establish LIVE."

patterns-established:
  - "Epoch policy: startup establishes an epoch, resume retains it, and clear/compact advance it without elapsed-time or tool-count correction."
  - "Semantic policy: fixed/local verification stays silent; semantic/hybrid appears only after reliable current-session index availability."
  - "Outcome policy: only reliable successful KCodeRag results advance feedback state; submit_feedback suppresses later reminders only in the same session."

requirements-completed: [HOOK-06, HOOK-07, HOOK-08, ROUT-05]

coverage:
  - id: D1
    description: "Codex exact-tgz SessionStart traverses native registration, normalized dispatch, epoch claim, and bounded context without claiming LIVE."
    requirement: HOOK-08
    verification:
      - kind: integration
        ref: "tests/smoke/hook-tracer.test.cts#exact-tgz Codex SessionStart tracer"
        status: pass
    human_judgment: false
  - id: D2
    description: "SessionStart sources, conditional fragments, epoch transitions, and cleanup obey bounded fail-open policy."
    requirement: HOOK-08
    verification:
      - kind: unit
        ref: "tests/hooks/session-start.test.cts#SessionStart governor matrix"
        status: pass
    human_judgment: false
  - id: D3
    description: "Fixed-string, explicit-file, log/generated, uncommitted, and other local verification shapes stay silent."
    requirement: HOOK-06
    verification:
      - kind: unit
        ref: "tests/hooks/semantic-reminders.test.cts#semantic reminder matrix"
        status: pass
    human_judgment: false
  - id: D4
    description: "Deep narrow scopes and common Lua globals remain local while unique C++ symbols and qualified Lua methods receive graph-first guidance."
    requirement: HOOK-07
    verification:
      - kind: unit
        ref: "tests/hooks/semantic-reminders.test.cts#C++ and Lua classifier boundary matrix"
        status: pass
    human_judgment: false
  - id: D5
    description: "Semantic/hybrid guidance requires reliable current-session index availability; otherwise routing stays keyword/context/call-chain."
    requirement: ROUT-05
    verification:
      - kind: unit
        ref: "tests/hooks/semantic-reminders.test.cts#index availability matrix"
        status: pass
      - kind: integration
        ref: "npm run generate:check && npm run pack:audit"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-09-02
status: complete
---

# Phase 05 Plan 01: Hook Precision Governor and Semantic Reminders Summary

**A native Codex SessionStart tracer now feeds a bounded epoch governor, precise structural-search routing, and reliable feedback state while keeping exact-package evidence explicitly PACKAGED.**

## Performance

- **Duration:** 45 min
- **Started:** 2026-09-01T17:00:00Z
- **Completed:** 2026-09-01T17:45:39Z
- **Tasks:** 3
- **Files modified:** 35

## Accomplishments

- Installed an actual locally hashed tgz into a clean Codex project and proved the SessionStart registration-to-context path, malformed-input fail-open behavior, epoch isolation, and rejection of launcher-only LIVE claims.
- Unified startup/resume/clear/compact through a closed, hash-only reminder governor with conditional code-style/update fragments and receipt-gated SessionEnd cleanup.
- Locked local-versus-structural C++/Lua search boundaries, exact-recheck suppression, current-session index gating, five-host success normalization, and per-epoch/per-session feedback transitions.
- Kept generated QA hook assets and all five host projections self-contained so the new runtime cannot silently fail after package installation.

## Task Commits

Each task was committed atomically with a test-first RED/GREEN pair:

1. **Task 1: Trace exact-tgz Codex SessionStart**
   - `b9b08bc` — test: add failing Codex SessionStart tracer
   - `6051680` — feat: trace Codex SessionStart from exact package
2. **Task 2: Govern SessionStart fragments and epochs**
   - `5078d12` — test: add failing SessionStart governor matrix
   - `9abb2f6` — feat: govern SessionStart reminder epochs
3. **Task 3: Enforce semantic reminder policy**
   - `155912e` — test: add failing semantic reminder matrix
   - `520ac6d` — feat: enforce semantic reminder policy

## Files Created/Modified

- `src/hooks/pre-tool-dispatcher.cts` — Normalizes SessionStart/tool events and dispatches bounded ordered contributors.
- `src/hooks/once-marker.cts` — Implements epoch-aware, hash-keyed reminder claims and closed marker metadata.
- `src/hooks/feedback-nudge.cts` — Normalizes reliable KCodeRag outcomes and governs feedback/index state transitions.
- `src/hooks/grep-nudge.cts` — Applies the narrow local-versus-structural lookup classifier before claiming reminders.
- `src/hooks/code-style-nudge.cts` — Preserves structured-write-before-integrity-before-claim ordering.
- `src/hooks/session-cleanup.cts` — Deletes only receipt-proven stable-session marker families.
- `src/hooks/update-check.cts` — Supplies fresh-cache-only update text and detached stale refresh scheduling.
- `src/capabilities/contracts.cts` and `src/capabilities/navigation.cts` — Declare SessionStart/SessionEnd sections and the installed runtime projection.
- `src/hosts/*.cts`, `src/generator/index.cts`, and `src/maintainer/pack-audit.cts` — Keep all five installed host products complete and audited.
- `kcoderag-qa/hooks/*.cjs` — Deterministically generated self-contained hook runtime.
- `tests/hooks/session-start.test.cts`, `tests/hooks/semantic-reminders.test.cts`, and `tests/smoke/hook-tracer.test.cts` — Lock the D-01 through D-14 behavior matrix.

## Decisions Made

- Treated stable session identifiers as opaque hash material; Unicode-normalization-distinct values remain distinct, while managed roots use platform path normalization.
- Rearmed reminder epochs only for clear/compact. Resume remains in the existing epoch, and unsupported/missing sources do not guess a transition.
- Allowed semantic/hybrid guidance only after a reliable successful `list_indexes` event proves a usable index for the current stable session; otherwise guidance stays keyword/context/call-chain.
- Recorded successful feedback at session scope so it suppresses later epochs without leaking suppression across projects, hosts, or sessions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed an unavailable installed-runtime import**
- **Found during:** Task 2 (SessionStart fragment expansion)
- **Issue:** The flat installed hook dispatcher imported `../hosts/host-version-support.cjs`, which is not deployed beside installed hook files, causing the launcher to fail silently.
- **Fix:** Used the receipt-gated installed capability integrity proof at runtime and retained an exact local version check only when that optional value is available.
- **Files modified:** `src/hooks/pre-tool-dispatcher.cts`, generated dispatcher, and SessionStart tests.
- **Verification:** Actual-tgz launcher and SessionStart suites pass.
- **Committed in:** `9abb2f6`

**2. [Rule 1 - Bug] Corrected the exact-package marker assertion**
- **Found during:** Task 2 (closed marker metadata verification)
- **Issue:** The tracer still expected a historical zero-byte marker, while the governor intentionally writes bounded closed JSON metadata.
- **Fix:** Asserted the exact allowed schema fields and added secret/identity non-disclosure checks.
- **Files modified:** `tests/smoke/hook-tracer.test.cts`.
- **Verification:** Exact-tgz tracer passes and rejects forbidden marker content.
- **Committed in:** `9abb2f6`

**3. [Rule 2 - Missing Critical] Completed the installed feedback/governor runtime closure**
- **Found during:** Task 3 (installed semantic reminder integration)
- **Issue:** The new dispatcher and marker imports required feedback/governor files in the npm package, generated tree, and every host contribution; omitting them would make installed hooks silently fail open.
- **Fix:** Added package files, deterministic generation, pack auditing, five-host projections, and generator/launcher/smoke regression coverage.
- **Files modified:** `package.json`, `src/generator/index.cts`, `src/maintainer/pack-audit.cts`, `src/hosts/*.cts`, generated hook assets, and related tests.
- **Verification:** Generator tests, launcher tests, five-host packaged smoke, `generate:check`, and `pack:audit` pass.
- **Committed in:** `520ac6d`

---

**Total deviations:** 3 auto-fixed (1 blocking issue, 1 bug, 1 missing critical runtime closure).
**Impact on plan:** All changes were necessary to keep the planned installed hook path operational and self-contained; no new dependency or LIVE claim was introduced.

## Issues Encountered

- A full `npm test` run exposed six launcher fixture failures and one five-host packaged-readiness failure after stable-session governance became mandatory. The fixtures were corrected to use stable isolated sessions and complete deployed runtime files; fresh reruns passed all 17 launcher cases and all 19 host-smoke cases.

## Verification

- Hook/launcher/tracer focused run: 61/61 passing.
- Generator suites: 22/22 passing.
- Launcher regression: 17/17 passing.
- Five-host packaged smoke: 19/19 passing, including the exact injected tgz readiness case.
- `npm run generate:check`: passing.
- `npm run pack:audit`: `{"ok":true,"version":"0.3.1","entries":79}`.
- Evidence boundary: launcher and exact-tgz observations are PACKAGED only; this plan records no LIVE host evidence.

## Known Stubs

None. The changed-file scan found no goal-blocking placeholder implementation, skipped test, or unrun required verification.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The shared contracts and installed runtime closure are ready for honest projection into Claude Code, Cursor, OpenCode, and ZCode in Plan 05-02.
- Native-host LIVE verification remains intentionally pending for later Phase 05 evidence plans; PACKAGED results must not be promoted.

## Self-Check: PASSED

- All declared source, generated, and test artifacts exist on disk.
- All six task commits resolve in repository history.
- No required verification or goal-blocking stub remains open.

---
*Phase: 05-hook-precision*
*Completed: 2026-09-02*
