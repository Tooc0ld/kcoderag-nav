---
quick_id: 260903-jfn
phase: quick-260903-jfn
plan: "01"
type: execute
status: planned
mode: quick
wave: 1
depends_on: []
files_modified:
  - package.json
  - .github/workflows/ci.yml
  - tests/maintainer/ci-contract.test.cts
autonomous: true
requirements: []
must_haves:
  truths:
    - "The expensive five-host packaged readiness test is no longer serialized inside every ordinary CI matrix lane."
    - "Pushes retain four-platform packaged coverage through acceptance; pull requests and workflow_dispatch retain it through a parallel CI matrix."
    - "The unfiltered npm test and release workflow remain unchanged, while Windows/Linux Node 22/24 required lanes still run every non-packaged test."
    - "The partition is closed by one identical exact test-name pattern, so the expensive test is neither lost nor duplicated inside one CI workflow event."
  artifacts:
    - path: package.json
      provides: Explicit full, ordinary-CI, and packaged-only test commands
    - path: .github/workflows/ci.yml
      provides: Event-aware parallel test partition across four platform lanes
    - path: tests/maintainer/ci-contract.test.cts
      provides: Regression contract for coverage, triggers, matrices, and command ordering
  key_links:
    - from: package.json test:ci
      to: package.json test:ci:packaged
      via: Identical skip/include test-name pattern
    - from: .github/workflows/ci.yml push
      to: .github/workflows/acceptance.yml
      via: Existing all-branch push acceptance owns four-platform packaged execution
---

# Quick Task 260903-jfn: Optimize Windows CI duration without weakening platform coverage

## Goal

Remove the dominant serialized packaged-readiness cost from ordinary Windows CI while preserving exact Windows/Linux and Node 22/24 coverage for every event type.

## Task 1: Lock the intended CI partition in tests

**Files:** `tests/maintainer/ci-contract.test.cts`, `package.json`

**Action:** Extend the CI contract tests to require one exact shared test-name partition, four required non-packaged lanes, four PR/manual packaged lanes, push delegation to acceptance, immutable action pins, and unchanged full `npm test`/release semantics.

**Verify:** Build and run `dist-tests/maintainer/ci-contract.test.cjs`; confirm the new assertions fail before the workflow/scripts are changed and pass afterward.

**Done:** The contract proves the expensive test has one owner per event without creating a coverage gap.

## Task 2: Split the expensive test from the serialized matrix

**Files:** `package.json`, `.github/workflows/ci.yml`

**Action:** Add filtered ordinary-CI and packaged-only scripts. Run the filtered suite in every required lane. For pull requests and manual CI, run the packaged-only test in a separate four-platform matrix; for pushes, keep that job skipped because the existing acceptance workflow runs the exact four-platform package path.

**Verify:** Run both partition scripts locally, the CI contract tests, dependency audit, deterministic generation, and diff checks. Confirm the full `npm test` command is unchanged.

**Done:** Every CI event retains coverage, but the dominant test runs in parallel or is delegated instead of extending each serialized Windows lane.

## Task 3: Prove hosted behavior and record measured improvement

**Files:** `.planning/quick/260903-jfn-optimize-windows-ci-duration-without-wea/260903-jfn-SUMMARY.md`, `.planning/STATE.md`

**Action:** Commit and push the change, monitor CI and acceptance, compare Windows required-lane durations with baseline run `33714423731`, and record exact evidence. Update STATE without changing the Phase 05 5/6 boundary.

**Verify:** Hosted CI and acceptance succeed; Windows required lanes show the heavy test skipped and materially lower duration; branch and working tree remain clean and synchronized.

**Done:** The optimization is measured on GitHub-hosted Windows rather than inferred from local timing.
