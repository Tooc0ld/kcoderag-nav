---
phase: quick-260820-umj-scope-nudge
plan: 01
subsystem: plugin-hooks
tags: [python, hooks, shell-parsing, code-generation, tdd]
requires: []
provides:
  - Quote- and escape-aware compound-command segmentation for structural lookup nudges
  - Compact 303-character generated nudge with preserved routing policy
  - QA/Dev behavior regressions for pipelines, compound operators, wrappers, and fail-open bounds
affects: [phase-1, plugin-generation, hook-routing]
actuals:
  tokens: 5560
  tasks: 3
  commits: 6
tech-stack:
  added: []
  patterns:
    - Split bounded shell command segments before reusing the existing simple-command classifier
    - Edit plugin-src canonical inputs and regenerate both self-contained environment packages
key-files:
  created: []
  modified:
    - plugin-src/hooks/grep_nudge.py
    - scripts/generate_plugins.py
    - tests/test_generation.py
    - tests/test_routing_and_hooks.py
    - kcoderag-qa/hooks/grep_nudge.py
    - kcoderag-dev/hooks/grep_nudge.py
key-decisions:
  - "Treat only unquoted and unescaped shell control operators as command boundaries."
  - "Keep the hook advisory and fail-open; malformed quotes and excessive segmentation return no patterns."
  - "Keep the installed-package compatibility phrase 'default to QA' while compressing the full nudge to 303 characters."
patterns-established:
  - "Compound-command parsing: isolate simple commands first, then apply the existing option/pattern/scope rules per segment."
  - "Generated text contracts: assert both a character budget and the policy phrases that must survive compression."
requirements-completed: [HOOK-SCOPE-01, HOOK-NUDGE-01, DIST-PARITY-01]
coverage:
  - id: D1
    description: "Single-file searches followed by pipelines or compound commands stay local, while repository searches in any segment still nudge."
    requirement: HOOK-SCOPE-01
    verification:
      - kind: integration
        ref: "tests/test_routing_and_hooks.py#HookCommandParsingTests"
        status: pass
    human_judgment: false
  - id: D2
    description: "The generated QA/Dev nudge is 303 characters and preserves tool, local-search, routing, and no-fallback semantics."
    requirement: HOOK-NUDGE-01
    verification:
      - kind: unit
        ref: "tests/test_generation.py#GenerationTests.test_nudge_is_compact_and_policy_complete"
        status: pass
    human_judgment: false
  - id: D3
    description: "Canonical and generated QA/Dev hooks remain synchronized and all repository tests pass."
    requirement: DIST-PARITY-01
    verification:
      - kind: integration
        ref: "python scripts/generate_plugins.py --check; QA/Dev 53/53; unittest discover 47/47"
        status: pass
    human_judgment: false
duration: 18min
completed: 2026-08-20
status: complete
---

# Quick Task 260820-umj: Compound Scope and Nudge Summary

**Compound shell commands now preserve per-segment search scope, and the generated routing nudge is reduced from 506 to 303 characters without losing policy.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-08-20T14:03:03Z
- **Completed:** 2026-08-20T14:20:58Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Added bounded, quote- and escape-aware segmentation for pipelines, `&&`, semicolons, and line boundaries.
- Preserved single-file/log scope decisions per command segment while detecting structural searches in later segments.
- Shortened the full generated nudge from 506 to 303 characters and retained tool selection, local-text exceptions, QA/Dev routing, and no-fallback guidance.
- Added dual-environment regressions for compound separators, later search segments, quoted/escaped controls, cmd/pwsh wrappers, malformed input, and the segment bound.

## Task Commits

1. **Task 1 RED: expose pipeline scope regression** - `59a8a18`
2. **Task 1 GREEN: preserve search scope across pipelines** - `3675d34`
3. **Task 2 RED: define compact nudge contract** - `c133665`
4. **Task 2 GREEN: shorten graph lookup nudge** - `aeebc23`
5. **Task 3: cover compound command boundaries** - `ab9a13d`
6. **Compatibility fix: preserve QA routing phrase** - `9c97596`

## TDD Evidence

- Pipeline regression RED: both generated hooks returned `['KPlayer']` for `rg KPlayer one.cpp | head -1`; the targeted test then passed after canonical parser changes and regeneration.
- Nudge budget RED: `506 not less than or equal to 320`; the generated text now measures 303 characters and the policy contract passes.
- Distinct compound-command cases were GREEN characterizations of the Task 1 scanner, so no artificial implementation changes were introduced.

## Files Created/Modified

- `plugin-src/hooks/grep_nudge.py` - Canonical segment scanner and compact nudge body.
- `scripts/generate_plugins.py` - Compact routing guidance derived after validating required routing rows.
- `tests/test_routing_and_hooks.py` - QA/Dev compound-command behavior coverage.
- `tests/test_generation.py` - Nudge budget and policy contract.
- `kcoderag-qa/hooks/grep_nudge.py` - Regenerated QA hook.
- `kcoderag-dev/hooks/grep_nudge.py` - Regenerated Dev hook.

## Decisions Made

- A real shell separator isolates scope; quoted or escaped separator characters remain part of the search pattern.
- All segments are inspected so a later structural search still nudges, but malformed or excessive segmentation stays silent and fail-open.
- The nudge budget is enforced on the complete generated string rather than misinterpreting `additionalContextLimit` as actual prompt length.

## Deviations from Plan

### Auto-fixed Issues

**1. Preserved the existing project-install routing phrase contract**

- **Found during:** Final repository test suite
- **Issue:** The first compact wording used `QA is default`, while an existing install test requires `default to QA`.
- **Fix:** Replaced it with the equivalent required phrase without increasing the 303-character total.
- **Files modified:** `scripts/generate_plugins.py`, generated QA/Dev hooks
- **Verification:** The previously failing install test and compact-nudge test both pass; the full suite passes.
- **Committed in:** `9c97596`

**Total deviations:** 1 auto-fixed compatibility regression. No scope expansion.

## Issues Encountered

- Importing generated hooks during an ad-hoc length check rewrote tracked bytecode caches; only those exact diagnostic side effects were restored before committing.

## User Setup Required

None.

## Next Phase Readiness

- Parser and nudge changes are synchronized across QA and Dev packages.
- No blocker remains; future shell forms should be added as behavior-level cases in `HookCommandParsingTests` before changing the scanner.

---
*Phase: quick-260820-umj-scope-nudge*
*Completed: 2026-08-20*
