---
status: resolved
trigger: "Publishing the current Phase 04.2 candidate is blocked because ordinary CI fails all four hosted lanes with host_version_unsupported while exact candidate readiness succeeds."
created: 2026-08-31
updated: 2026-08-31
---

# Debug Session: Release CI Host Version

## Symptoms

- expected: The exact candidate that passed hosted readiness also passes the release workflow's four required contract lanes and can publish `kcoderag-nav@0.3.0`.
- actual: Exact candidate readiness run `33351299161` succeeds, but ordinary CI runs `33351299196` and `33353177653` fail `npm test` on all Node 22/24 Windows/Linux lanes.
- errors: Six compiled CLI tests fail with `host_version_unsupported` for Claude code-style capability scenarios; the release workflow contains the same `npm test` gate and would fail before publish.
- timeline: Observed on 2026-08-31 after candidate `e316ca34953c9240845ce91a5fc3beecf6a6060c` was pushed to both `master` and `readiness/04.2-candidate`.
- reproduction: Run the complete test suite in an environment where the real Claude executable/version is not available, or inspect the failed hosted CI logs for the exact candidate.

## Current Focus

- bug_class: environment-dependent-test
- hypothesis: CONFIRMED — six public CLI success tests relied on ambient Claude version detection, and the release-only required smoke command also lacked the candidate artifact lease required by its own fail-closed API.
- test: Remove the real Claude command from PATH for the CLI regression, then execute the exact release smoke command against a locally created candidate lease.
- expecting: Public CLI tests pass without an installed host, while `smoke:required` produces one audited candidate package and returns five-host PASS instead of `NOT_RUN`.
- candidate_causes:
  - tests: success-path CLI tests do not provide a hermetic supported Claude version.
  - runtime: compiled CLI correctly rejects unavailable/unsupported host versions according to the frozen receipt policy.
- and_gate: yes — the failure requires both a code-style capability success path and a runner without the exact supported Claude version.
- next_action: Commit the resolved fix, promote the new exact candidate, wait for hosted readiness and ordinary CI, then create and push `v0.3.0`.
- reasoning_checkpoint:
    hypothesis: Ambient host detection made ordinary CI non-hermetic, while the release smoke entrypoint called a lease-required API without constructing the lease.
    confirming_evidence:
      - Restricting PATH reproduced the exact same six `host_version_unsupported` failures as all four hosted CI lanes.
      - A test-only preload supplying Claude 2.1.241 changed that exact regression from 20/26 to 26/26 without weakening runtime support checks.
      - Before the smoke entrypoint fix, `npm run smoke:required` returned `NOT_RUN/package_unavailable`; afterward it returned PASS for all five hosts from one 77-member candidate tgz.
      - The full suite passes 430/430 and every locally reproducible release gate passes after the final code change.
    falsification_test: Either restricted-PATH CLI tests still fail, or required smoke returns NOT_RUN/FAIL without registry acquisition.
    fix_rationale: Keep production support refusal strict; make success tests hermetic and make the maintainer-only required smoke CLI create the artifact lease its API requires.
    blind_spots: Hosted Node 22/24 Windows/Linux verification and npm publication remain external evidence collected after this local fix commit.
    candidate_causes:
      - tests: ambient real-host dependency in public CLI success paths
      - maintainer CLI: missing current-checkout candidate lease for required smoke
    and_gate: no — either defect independently blocks the release workflow.
- tdd_checkpoint:

## Evidence

- timestamp: 2026-08-31
  checked: Remote refs, package version, tag namespace, npm registry, readiness and CI runs.
  found: Remote `master` and candidate both point to `e316ca34953c9240845ce91a5fc3beecf6a6060c`; `v0.3.0` and npm `0.3.0` do not exist; readiness succeeds but ordinary CI fails all four required lanes.
  implication: The candidate identity is unambiguous and unpublished, but release must not be triggered until the shared test gate is repaired.

- timestamp: 2026-08-31
  checked: Failed CI job metadata and logs.
  found: Every required lane fails only at `Run complete Node test suite`; six CLI success-path tests receive `host_version_unsupported` instead of exit code 0.
  implication: This is deterministic cross-platform test/environment behavior, not a hosted Windows tail or transient runner failure.

- timestamp: 2026-08-31
  checked: Restricted-PATH compiled CLI regression before and after the test fixture change.
  found: The exact command changed from 20/26 with six host-version failures to 26/26 with no real Claude command available.
  implication: The success tests are now hermetic while product host-version enforcement remains unchanged.

- timestamp: 2026-08-31
  checked: Exact `npm run smoke:required` release gate before and after candidate-lease construction.
  found: The command changed from exit 1 `NOT_RUN/package_unavailable` to exit 0 PASS for Codex, Claude, Cursor, OpenCode, and ZCode against one 77-member candidate archive.
  implication: The release workflow's required smoke step is now executable and fail-closed on the current checkout.

- timestamp: 2026-08-31
  checked: Final local release-equivalent verification after the last code change.
  found: Build succeeds; full suite passes 430/430; dependency audit, 17/17 launcher tests, deterministic generation, docs, retirement audit, five-host required smoke, and 77-entry pack audit all pass.
  implication: The repair is ready for hosted candidate promotion and release execution.

## Eliminated

- hypothesis: The candidate or master points to the wrong commit.
  evidence: Both remote refs resolve to the exact same full SHA that passed readiness.
  timestamp: 2026-08-31

- hypothesis: Version `0.3.0` is already immutable on GitHub or npm.
  evidence: No remote `v0.3.0` tag exists and `npm view kcoderag-nav@0.3.0` returns not found.
  timestamp: 2026-08-31

## Resolution

- root_cause: Six public CLI success tests inherited the developer machine's real Claude executable instead of controlling the exact supported version, so hostless CI runners rejected code-style capability setup. Independently, the release workflow's `smoke:required` command invoked `runHostSmoke` without the candidate artifact lease that required-contract mode deliberately demands, guaranteeing `NOT_RUN` before publication.
- fix: Added a test-only Node preload that answers only the exact `claude --version` probe with frozen version 2.1.241; updated the required smoke CLI to create and dispose one current-checkout candidate lease; added a fast injected regression proving lease creation and forwarding.
- verification: Restricted-PATH CLI tests pass 26/26; full suite passes 430/430; required packaged smoke passes all five hosts; every locally reproducible release gate passes, including pack audit with 77 entries.
- files_changed: [.planning/debug/release-ci-host-version.md, src/smoke/host-smoke.cts, tests/cli/commands.test.cts, tests/smoke/host-smoke.test.cts]
