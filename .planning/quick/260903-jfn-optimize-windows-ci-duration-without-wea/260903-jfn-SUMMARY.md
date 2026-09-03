---
quick_id: 260903-jfn
phase: quick-260903-jfn
plan: "01"
subsystem: continuous-integration
tags: [github-actions, windows, performance, test-partition]
requires:
  - quick: 260903-dng
    provides: stable Windows CI baseline and complete four-platform gates
provides:
  - ordinary CI test partition without the dominant packaged-readiness test
  - event-complete four-platform packaged coverage through CI or acceptance
  - measured Windows required-lane latency reduction
affects: [ci, acceptance, phase-05]
actuals:
  tasks: 3
  commits: 1
tech-stack:
  added: []
  patterns: [exact test-name partition, event-aware matrix delegation]
key-files:
  created: []
  modified: [.github/workflows/ci.yml, package.json, tests/maintainer/ci-contract.test.cts]
key-decisions:
  - "Keep the unfiltered npm test and release workflow unchanged; split only ordinary CI execution with one exact test-name pattern."
  - "On branch pushes, acceptance owns four-platform packaged coverage; pull requests and workflow_dispatch run the same packaged test in a separate parallel CI matrix."
  - "Keep Phase 05 plan 05-06 incomplete; packaged success does not promote native-host LIVE evidence."
completed: 2026-09-03
status: complete
---

# Quick 260903-jfn: Windows CI duration optimization summary

**The ordinary Windows CI critical path is materially shorter while all Windows/Linux and Node 22/24 packaged-readiness coverage remains required.**

## Accomplishments

- Added `test:ci`, which runs every ordinary test except one exact five-host packaged-readiness test, and `test:ci:packaged`, which runs only that exact test.
- Kept the unfiltered `npm test` command and the release workflow unchanged.
- Changed the four ordinary required lanes to run the 530-test partition.
- Added a separate four-platform packaged matrix for pull requests and manual CI, allowing the expensive test to run in parallel with ordinary contracts.
- Delegated branch-push packaged coverage to the existing exact-candidate acceptance workflow, avoiding duplicate serialized work on the same push.
- Added CI contract tests that lock the identical include/exclude pattern, exact matrices, event ownership, action pins, and no-bypass behavior.

## Measured hosted improvement

Both compared CI runs used GitHub-hosted Windows runners and the same required job boundaries.

| Required lane | Baseline run `33714423731` | Optimized run `33722434769` | Reduction |
|---|---:|---:|---:|
| Windows Node 22 | 15m 52s | 8m 05s | 7m 47s (49.1%) |
| Windows Node 24 | 15m 19s | 6m 23s | 8m 56s (58.3%) |

The optimized hosted logs report 530/530 ordinary tests in each Windows lane and contain no executed packaged-readiness result. The push-triggered packaged job is explicitly skipped, while exact-candidate acceptance run `33722434710` passed its four PACKAGED lanes and final gate on the same implementation SHA `9b2aaa042b06a22a46c6defa253bcbdc5993b380`.

## Verification evidence

| Gate | Result |
|---|---|
| Test-first CI contract | RED before scripts/workflow; PASS 8/8 after implementation |
| Local ordinary partition | PASS, 530/530, 144.7s |
| Local packaged partition | PASS, 1/1, 88.8s |
| Local unfiltered `npm test` | PASS, 531/531, 242.6s |
| Dependency audit | PASS, exact approved development graph |
| Deterministic generation | PASS, zero changed or written paths |
| npm package audit | PASS, 19/19 |
| Workflow action check | PASS; immutable SHAs resolve to the declared action releases |
| Hosted CI | PASS, run `33722434769`, all four required lanes |
| Hosted exact-candidate acceptance | PASS, run `33722434710`, all four PACKAGED lanes plus acceptance gate |

GitHub Actions expands each matrix entry into a separate job, subject to runner availability, so the pull-request/manual packaged matrix can execute alongside the ordinary matrix instead of extending every ordinary lane. Node 22 supports the exact `--test-skip-pattern` and `--test-name-pattern` filters used to close the partition.

## Remaining phase boundary

Phase 05 remains at 5/6 plans. Plan `05-06` still owns authenticated, native-host LIVE acceptance; this quick changes CI scheduling only and makes no LIVE or release claim.
