---
quick_id: 260831-nb1
phase: quick-260831-nb1
plan: "01"
subsystem: release-assurance
tags: [documentation, github-actions, ci-performance, release]
requires:
  - phase: 04.2-public-debranding
    provides: exact 0.3.0 readiness evidence and release boundary
provides:
  - current local authority for the separately authorized v0.3.0 publication
  - branch-only ordinary CI push handling
  - lean tag publish job behind the unchanged four-lane release matrix
affects: [ci, release, documentation, phase-05]
actuals:
  tasks: 2
  commits: 2
tech-stack:
  added: []
  patterns: [required matrix as verification producer, dependent publish job as package finalizer]
key-files:
  created: [.planning/quick/260831-nb1-update-the-local-authoritative-mcp-qa-gu/260831-nb1-SUMMARY.md]
  modified: [.github/workflows/ci.yml, .github/workflows/release.yml, README.md, docs/MCP_QA_EXPERIENCE_GUIDE.md, tests/maintainer/ci-contract.test.cts, tests/maintainer/release-workflow.test.cts, .planning/STATE.md]
key-decisions:
  - "Preserve Phase 04.2 as readiness-only history while recording the later independently authorized v0.3.0 publication."
  - "Exclude tag refs from ordinary CI and remove only gates duplicated after the required four-lane Release matrix."
requirements-completed: [BRAND-04, TEST-10]
completed: 2026-08-31
status: complete
---

# Quick 260831-nb1: Release Guide and CI Streamlining Summary

**The local authority now records the completed `0.3.0` release, and tag publication no longer pays for duplicate ordinary CI or a second full validation pass.**

## Accomplishments

- Updated the repository-owned MCP QA guide and README to distinguish Phase 04.2's readiness-only scope from the later separately authorized `v0.3.0` Release workflow and npm publication.
- Limited ordinary CI push handling to branch refs; pull-request and manual CI behavior remains unchanged.
- Kept the exact Ubuntu/Windows by Node 22/24 Release matrix and its full gates, while reducing the dependent publish job to clean install, tag/version binding, build, dependency audit, real pack audit, and one npm publish.
- Added static contracts proving the tag-exclusion and required-matrix/publish-finalizer boundary.

## Task Commit

- Implementation and guide update: `dfeb55b`

## Fresh Verification

| Gate | Result |
|---|---|
| Build | PASS |
| CI workflow contract | PASS, 6/6 |
| Release workflow contract | PASS, 7/7 |
| Local guide audit | PASS, 6/6 plus CLI check |
| Documentation audit | PASS, 10/10 plus CLI check |
| Full serialized suite | PASS, 432/432, 202,720.9767 ms |
| Dependency audit | PASS, 2 direct + 1 transitive development packages |
| Deterministic generation | PASS, 0 changed/written paths |
| Retirement audit | PASS, 0 remaining scripts/source/tests |
| Real pack audit | PASS, version 0.3.0, 77 entries |
| Diff hygiene | PASS |

## CI Effect

- A `v*.*.*` tag push now triggers Release but not ordinary CI, removing one entire duplicate four-lane workflow run.
- Each Release required lane still runs launcher smoke, the complete test suite, generation, docs, retirement, five-host required smoke, and pack audit.
- The dependent Ubuntu publish job no longer repeats the heavy test/generation/docs/retirement/smoke gates. It still rebuilds and audits the exact tarball immediately before publication.

The expected saving is structural rather than a claimed hosted duration: four ordinary CI lanes are no longer started for release tags, and the publish job avoids a second serialized full suite plus five-host smoke. No hosted workflow was dispatched in this quick task.

## Scope Boundary

No GitHub workflow dispatch, Git push, tag creation, npm publish, registry mutation, Action-pin change, release-matrix reduction, credential change, or runtime product change occurred. Unrelated dirty and untracked work was preserved.

## Next Phase Readiness

The project remains positioned at Phase 05. Future release tag pushes will use the streamlined workflow; branch and pull-request assurance remains unchanged.
