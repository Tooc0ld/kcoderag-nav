---
quick_id: 260831-nxv
phase: quick-260831-nxv
plan: "01"
subsystem: ci-performance
tags: [github-actions, documentation, path-classification, required-checks]
requires:
  - quick: 260831-nb1
    provides: branch-only ordinary CI and streamlined release publication
provides:
  - fail-safe Node classifier for documentation-only Git changes
  - lightweight documentation/package CI path without full platform tests
  - successful job-level matrix skip rather than workflow-level path filtering
affects: [ci, documentation, pack-audit, phase-05]
actuals:
  tasks: 2
  commits: 2
tech-stack:
  added: []
  patterns: [closed documentation allow-list with full-CI fallback, job-level conditional required checks]
key-files:
  created: [src/maintainer/ci-change-scope.cts, tests/maintainer/ci-change-scope.test.cts, .planning/quick/260831-nxv-route-documentation-only-branch-and-pull/260831-nxv-SUMMARY.md]
  modified: [.github/workflows/ci.yml, src/maintainer/pack-audit.cts, tests/maintainer/ci-contract.test.cts, package.json, .planning/STATE.md]
key-decisions:
  - "Keep the CI workflow unfiltered because required workflows skipped by path filters can remain Pending; skip only the full matrix job after an always-running classifier."
  - "Treat only README.md, docs/**, and .planning/** as documentation; product Markdown and every ambiguous or mixed set use full CI."
requirements-completed: [TEST-10]
completed: 2026-08-31
status: complete
---

# Quick 260831-nxv: Documentation-only CI Routing Summary

**Documentation-only branch pushes and pull requests now run one lightweight Ubuntu gate instead of the Windows/Linux by Node 22/24 full regression matrix.**

## Accomplishments

- Added a bounded Node-only GitHub event and Git diff classifier with secret-free `scope` and `changed_count` outputs.
- Defined a closed documentation set: root `README.md`, `docs/**`, and `.planning/**`.
- Made empty, malformed, new-branch, manual, oversized, failed-diff, mixed, workflow, source, package, generated product, and product Markdown changes select full CI.
- Added an always-running Ubuntu scope job that reuses its install/build to run `docs:check`, `guide:check`, and `pack:audit` for documentation-only changes.
- Preserved the exact four full matrix lanes and all existing gates behind `needs.change-scope.outputs.scope == 'full'`.
- Declared the compiled classifier as repository-only so it cannot enter the public npm tarball.

## Behavior

| Changed paths | Result |
|---|---|
| `README.md`, `docs/**`, `.planning/**` only | One Ubuntu build + dependency/docs/guide/pack gate; full matrix skipped |
| Product Skill/Rule/README Markdown | Full four-lane CI |
| Source, tests, workflow, package or generated assets | Full four-lane CI |
| Mixed documentation and product paths | Full four-lane CI |
| Manual dispatch, new branch, invalid/empty/failed diff | Full four-lane CI |

The dedicated `readiness/04.2-candidate` workflow remains unchanged: it binds an exact candidate commit and tarball, so any candidate commit still requires its release-evidence lanes.

## Task Commit

- Classifier, workflow routing, package boundary, and tests: `c74f404`

## Fresh Verification

| Gate | Result |
|---|---|
| Build | PASS |
| Change-scope tests | PASS, 6/6 including a real two-dot Git diff |
| CI workflow contract | PASS, 7/7 |
| Pack-audit tests | PASS, 17/17 |
| Full serialized suite | PASS, 439/439, 278,981.6073 ms |
| Dependency audit | PASS, 2 direct + 1 transitive development packages |
| Deterministic generation | PASS, 0 changed/written paths |
| Documentation and guide audits | PASS |
| Retirement audit | PASS, 0 remaining scripts/source/tests |
| Real pack audit | PASS, version 0.3.0, 77 entries |
| Diff hygiene | PASS |

## Safety and Scope Boundary

- The workflow itself still starts for branch pushes and pull requests; no workflow-level `paths-ignore` can strand a required check in Pending.
- Job-level skipped full-matrix checks report successful skipped status, while failure of the scope/documentation job still fails the workflow.
- Action full-SHA pins, read-only permissions, optional live-smoke gate, release/readiness workflows, credentials, runtime product, tags, npm, and remotes were unchanged.
- No hosted workflow was dispatched, so this task makes no hosted-duration claim. Unrelated dirty and untracked work was preserved.

## Next Phase Readiness

The next ordinary documentation-only push will exercise the lightweight hosted route. The project remains positioned at Phase 05.
