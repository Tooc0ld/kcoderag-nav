---
phase: 04-deployment-reliability
plan: 16
subsystem: real-host-acceptance
tags: [npm, npx, codex, claude-code, cursor, windows, fix-forward, deployment]

requires:
  - phase: 04-deployment-reliability
    provides: Immutable public 0.2.0 publication, QA-only lifecycle, rootless Hook launchers, and source diagnostics
provides:
  - Public exact/latest 0.2.2 identity converged with master, tag, and npm gitHead after immutable fix-forward
  - Real Head Codex, Claude Code, and Cursor project installations are QA-only and healthy
  - Real Codex and Claude launchers return identical advisory protocol from root, Unicode-deep, and space-deep working directories
affects: [phase-05-hook-precision, phase-06-real-host-evidence, phase-08-production-release]

actuals:
  tokens: 6300
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - Immutable releases are repaired only by forward versions; deployed acceptance follows the repaired exact artifact
    - Real-host evidence records health, protocol class, and public identity without persisting configuration or credential values

key-files:
  created:
    - .planning/phases/04-deployment-reliability/04-16-SUMMARY.md
  modified: []

key-decisions:
  - "The original exact 0.2.0 Head receipt was superseded after real-host acceptance exposed inventory and launcher-concurrency defects; 0.2.0 remains immutable and acceptance follows fix-forward 0.2.2."
  - "Do not fabricate the closed 0.2.0-only 04-16-HEAD-ACCEPTANCE.json schema for a 0.2.2 outcome; record the deviation and the real metadata-only evidence instead."
  - "The live QA service protocol deployment drift is a later KCodeRag service/Phase 06 evidence item and is not a Phase 04 project-integration blocker."

patterns-established:
  - "Fix-forward acceptance: public exact/latest, gitHead, master, and tag must converge on the repaired version before deployed health is accepted."
  - "Host-boundary evidence: Codex/Claude prove launcher advisory parity while Cursor is accepted through project Rule, skill, MCP, status, and doctor without a false Hook claim."

requirements-completed: [DEP-01, DEP-02, DEP-03]

coverage:
  - id: D1
    description: "Public exact/latest kcoderag-nav 0.2.2, master, v0.2.2, and npm gitHead identify one immutable repaired artifact."
    requirement: DEP-01
    verification:
      - kind: integration
        ref: "npm view kcoderag-nav@0.2.2 plus git rev-parse HEAD/origin/master/v0.2.2"
        status: pass
      - kind: e2e
        ref: "GitHub CI runs 32879666733 and 32879669905; Release run 32879669865"
        status: pass
    human_judgment: false
  - id: D2
    description: "Head Codex, Claude Code, and Cursor project installations are QA-only, healthy, drift-free by managed-state checks, and have no active source conflict."
    requirement: DEP-01
    verification:
      - kind: e2e
        ref: "0.2.2 status/doctor against I:/JX3_SVN/Head for codex, claude, and cursor"
        status: pass
    human_judgment: false
  - id: D3
    description: "Installed Codex and Claude launchers resolve the same managed advisory from Head root, a Unicode-deep directory, and a space-deep directory."
    requirement: DEP-02
    verification:
      - kind: e2e
        ref: "real Head run_hook.cmd root/unicode-deep/space-deep matrix; exit 0, valid JSON, advisory true, one protocol fingerprint per host"
        status: pass
      - kind: integration
        ref: "tests/hooks/launcher.test.cts including eight-way Windows stdout isolation"
        status: pass
    human_judgment: false
  - id: D4
    description: "Selected-host diagnostics and cleanup authority remain secret-safe and project-scoped after the real-host parser fixes."
    requirement: DEP-03
    verification:
      - kind: integration
        ref: "npm test: 286/286, including Codex/Claude inventory variants, cleanup fingerprint, rollback, and secret sentinel cases"
        status: pass
    human_judgment: false

duration: 2d
completed: 2026-08-26
status: complete
---

# Phase 04 Plan 16: Real Head Acceptance Summary

**The planned 0.2.0-only Head migration was completed by immutable fix-forward to public 0.2.2, with healthy QA-only Codex, Claude Code, and Cursor project state and stable root/deep advisory launchers.**

## Performance

- **Duration:** 2 days including real-host diagnosis, two forward releases, and public verification
- **Completed:** 2026-08-26
- **Tasks:** 3 outcomes completed through documented deviation
- **Repository files modified by this closeout:** 1

## Accomplishments

- Preserved immutable 0.2.0, corrected real Codex/Claude inventory parsing in 0.2.1, and corrected concurrent Windows launcher output isolation in 0.2.2.
- Converged npm exact/latest 0.2.2, `master`, `origin/master`, `v0.2.2`, and npm `gitHead` on `e9b6566ac2149485f9b31c5cf948ccc959b39d60`.
- Verified real `I:\JX3_SVN\Head` Codex, Claude Code, and Cursor project installations as QA-only and healthy with no active source conflict.
- Verified installed Codex and Claude launchers from root, Unicode-deep, and space-deep working directories with exit 0, valid advisory JSON, and identical output fingerprints per host.

## Task Commits

1. **Repair current Codex and Claude inventory compatibility** — `a59bb9c` (`fix`)
2. **Publish the first immutable repair** — `ea07c05` (`release v0.2.1`)
3. **Isolate concurrent Windows Hook stdout buffers** — `7a0f190` (`fix`)
4. **Publish the accepted exact artifact** — `e9b6566` (`release v0.2.2`)

## Files Created/Modified

- `.planning/phases/04-deployment-reliability/04-16-SUMMARY.md` — records the real fix-forward acceptance and why the obsolete 0.2.0-only receipt was not fabricated.

## Decisions Made

- Treat 0.2.2 as the exact accepted Head artifact because the locked D-20 policy requires immutable fix-forward after a published defect.
- Keep the historical 0.2.0 validator and receipt schema unchanged; a new 0.2.2 result cannot truthfully satisfy a schema that hard-codes the original publication subject.
- Defer the live QA MCP protocol deployment drift to later service deployment/Phase 06 evidence work by explicit user decision.

## Deviations from Plan

### Fix-forward superseded the exact 0.2.0 acceptance artifact

- **Found during:** Real Head acceptance after public 0.2.0 publication.
- **Issue:** Current Codex/Claude inventories did not match the closed parser assumptions, and the Windows launcher used `%RANDOM%` filenames that collided under concurrent invocation.
- **Fix:** Published parser compatibility as 0.2.1, then exclusive temporary-directory launcher allocation as 0.2.2; reran public identity, CI, lifecycle, doctor, and real launcher evidence.
- **Verification:** 286/286 local tests, all four required GitHub CI lanes, successful release workflow, three-host public lifecycle smoke, healthy Head status/doctor, and root/deep launcher checks.
- **Impact:** The intended deployed outcome is stronger and current, while the immutable-release rule remains intact. The obsolete 0.2.0-only receipt is intentionally absent rather than falsified.

## Issues Encountered

- The live QA endpoint currently negotiates an older MCP protocol and omits the newer structured result fields. The user explicitly accepted this as a later KCodeRag service deployment fix, outside Phase 04's npm/project-integration closure.

## User Setup Required

None. The real Head project already contains the accepted QA-only 0.2.2 installations for all three hosts.

## Next Phase Readiness

- Phase 05 can focus on Hook precision without reopening deployment ownership or launcher reliability.
- Phase 06 retains authenticated MCP/service protocol evidence, including the deferred live QA deployment alignment.

---
*Phase: 04-deployment-reliability*
*Completed: 2026-08-26*
