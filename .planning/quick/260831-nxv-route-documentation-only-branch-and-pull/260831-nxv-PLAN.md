---
quick_id: 260831-nxv
phase: quick-260831-nxv
plan: "01"
type: execute
status: planned
mode: quick
wave: 1
depends_on: []
files_modified:
  - src/maintainer/ci-change-scope.cts
  - src/maintainer/pack-audit.cts
  - tests/maintainer/ci-change-scope.test.cts
  - tests/maintainer/ci-contract.test.cts
  - package.json
  - .github/workflows/ci.yml
  - .planning/quick/260831-nxv-route-documentation-only-branch-and-pull/260831-nxv-SUMMARY.md
  - .planning/STATE.md
autonomous: true
requirements: [TEST-10]
must_haves:
  truths:
    - "README.md, docs/**, and .planning/**-only changes run bounded documentation and package checks instead of the four-platform full regression matrix."
    - "Any source, workflow, package, generated product, plugin asset, mixed, empty, malformed, oversized, or unclassifiable change set fails safe to full CI."
    - "The CI workflow itself always starts, so path filtering cannot leave a required workflow Pending; the full matrix is skipped by a successful job condition for documentation-only changes."
    - "Manual workflow dispatch always selects full CI, and optional authenticated smoke retains its explicit manual gate."
---

<objective>
Stop documentation-only branch pushes and pull requests from running the expensive Windows/Linux by Node 22/24 test matrix while preserving required-check behavior and all product-affecting gates.

Output: a tested secret-safe Node change classifier, a lightweight documentation/package lane inside the always-triggered CI workflow, conditional full matrix execution, and static workflow contracts.
</objective>

<tasks>

<task type="auto">
  <name>Task 1: Add a fail-safe documentation change classifier</name>
  <files>src/maintainer/ci-change-scope.cts, src/maintainer/pack-audit.cts, tests/maintainer/ci-change-scope.test.cts, package.json</files>
  <action>Implement a Node-only maintainer CLI that reads bounded GitHub push or pull-request metadata, computes a bounded Git diff, and emits only scope plus count through GITHUB_OUTPUT. The closed documentation set is root README.md, docs/**, and .planning/**. New-branch, manual, invalid, empty, oversized, failed-diff, mixed, and all other paths resolve to full. Declare the compiled classifier as non-publishable and add focused tests and a package script.</action>
  <verify>`npm run build`; `npm run test:ci-change-scope`; `npm run test:pack`; `npm run pack:audit`</verify>
  <done>Classification is deterministic, secret-safe, independently tested, and excluded from the public package.</done>
</task>

<task type="auto">
  <name>Task 2: Route documentation-only events through lightweight checks</name>
  <files>.github/workflows/ci.yml, tests/maintainer/ci-contract.test.cts</files>
  <action>Add an Ubuntu change-scope job with full-history immutable checkout, Node 24, clean install, build, classifier output, and documentation-only docs/guide/pack checks. Make the existing required matrix depend on it and use a job-level if condition for full scope; preserve all four full lanes and every existing gate. Keep the workflow trigger itself unfiltered so required checks never remain Pending. Update contracts for topology, outputs, action pins, lightweight commands, fail-safe manual behavior, and the unchanged full matrix.</action>
  <verify>`npm run test:ci-contract`; `npm test`; `npm run docs:check`; `npm run generate:check`; `git diff --check`</verify>
  <done>Documentation-only changes avoid full tests, product changes retain them, skipped matrix jobs report successful skipped status, and the workflow retains minimal read-only authority.</done>
</task>

</tasks>

<scope_boundary>
Do not alter readiness or release candidate semantics, hosted workflows, branch protection, Action pins, credentials, npm publication, tags, remotes, or product runtime. Preserve unrelated dirty and untracked work.
</scope_boundary>

<success_criteria>
- Focused classifier tests cover positive, mixed, product Markdown, invalid, event, and diff-failure cases.
- Static CI contracts prove one lightweight producer and the unchanged exact four-lane full matrix behind its `scope == full` condition.
- Full local regression and pack/docs/generation gates pass after the last implementation edit.
- No hosted workflow is dispatched; hosted latency remains unclaimed until the next ordinary push.
</success_criteria>
