---
status: resolved
trigger: "Phase 06 exact-tree ci:local reports three Codex Windows launcher tests with empty stdout"
created: 2026-09-03
updated: 2026-09-03T02:44:48+08:00
---

# Phase 06 Codex Windows launcher empty stdout

## Symptoms

- Expected behavior: Installed and moved Codex Windows launcher commands emit strict advisory JSON context in all 17 launcher tests.
- Actual behavior: 14/17 launcher tests pass; three Codex Windows cases receive empty stdout.
- Errors: `dist-tests/hooks/launcher.test.cjs` fails installed Codex Windows root, moved-project Codex Windows root, and generic cmd.exe command assertions.
- Timeline: Reproduced after Phase 06 four-Skill convergence; the same three failures occur in the main working tree and the exact staged-tree verification worktree.
- Reproduction: Build, then run `node --test dist-tests/hooks/launcher.test.cjs`.

## Current Focus

hypothesis: RESOLVED — the launcher suite was non-hermetic because it inherited the real OS reminder cache; the suite-owned cache fix was self-verified and human-confirmed
bug_class: bohrbug
test: complete — build, focused launcher, adjacent hooks, and revert/reapply checks passed
expecting: no further debug action
next_action: archive this resolved session and preserve the unstaged fix for the Phase 06 executor
fault_tree:
  symptom: rendered Codex Windows command exits 0 with empty stdout
  or_branches:
    - code: compact embedded bootstrap rejects a valid current install state or throws before spawnSync
    - config: rendered Codex registration passes a wrong host/state/launcher token
    - environment: cmd.exe quoting or command-length parsing truncates only the rendered command
    - data: current Codex install-state shape is valid to the readable resolver but outside the compact validator contract
  and_gate_candidate: cmd.exe platform boundary plus a state/value-specific bootstrap defect could both be required
reasoning_checkpoint:
  hypothesis: The test harness inherits the real OS reminder cache, so a valid host-aware launcher event is suppressed when that external cache is already at the intentional 1024-claim cap.
  confirming_evidence:
    - The real default cache contains exactly 1024 claim files and no stale capacity lock.
    - The unchanged installed Codex command emitted 353 bytes of valid PreToolUse JSON when only LOCALAPPDATA changed to a fresh temporary root.
    - Direct no-host launcher controls bypass managed reminder claiming and continue to pass against the full cache.
  falsification_test: The hypothesis would be false if the same unchanged installed command remained empty with a fresh cache, or if the default cache were below capacity; neither was observed.
  fix_rationale: Give this test module its own temporary LOCALAPPDATA and XDG_CACHE_HOME so assertions exercise launcher behavior against deterministic empty state while preserving the product's bounded fail-open behavior at capacity.
  blind_spots: Only the Windows failure is currently reproduced; Linux behavior is covered structurally by setting XDG_CACHE_HOME but will not be executed on this Windows host. Full Phase 06 CI is outside this focused debug scope.
  candidate_causes:
    - code: tests/hooks/launcher.test.cts environment() forwards the process environment without isolating persistent reminder state.
    - environment: the developer machine's default reminder cache has reached MAX_NUDGE_MARKERS=1024.
    - config: the product cap and fail-open policy are intentional and should not be raised or bypassed in production.
  and_gate: yes — the three failures require both the non-hermetic test environment and an external cache at capacity; either a suite-owned fresh cache or a non-full machine cache avoids the symptom.
tdd_checkpoint: ""

## Evidence

- timestamp: 2026-09-03T00:00:00+08:00
  observation: Exact-tree ci:local reported 514/517 tests passing and the same three launcher failures reproduced in a fresh main-tree control run.
- timestamp: 2026-09-03T00:12:00+08:00
  checked: .planning/debug/knowledge-base.md lexical match for launcher, Codex, Windows, cmd.exe, and empty stdout
  found: No prior resolved entry matches this symptom; the only search hit was an unrelated generated Codex MCP artifact path.
  implication: No known-pattern hypothesis is promoted; investigate the current test and launcher construction directly.
- timestamp: 2026-09-03T00:22:00+08:00
  checked: Git index and launcher-related status before investigation
  found: Index tree is 3857caaeec6e1d87b32d0844d326bb6da925140d with binary patch hash a2b55c722c82c32e443d574f9b75e4665be16261; 92 staged paths exist, and project-root.cts, launcher.test.cts, and both run_hook.cmd files have no staged or unstaged product changes.
  implication: The investigation can preserve the Phase 06 index byte-for-byte and any eventual launcher fix must be a new unstaged change.
- timestamp: 2026-09-03T00:22:00+08:00
  checked: complete launcher test, src/core/project-root.cts, plugin launcher, and pre-tool dispatcher paths
  found: Direct run_hook.cmd tests use the same dispatcher and are passing controls; the three failures invoke renderProjectHookCommands, whose compact base64 bootstrap validates every state/file digest and swallows all failures before spawning run_hook.cmd. The readable findNearestProjectHook assertion succeeds before the failing rendered command.
  implication: Work backwards from the embedded bootstrap/command boundary rather than changing dispatcher output logic or the launcher body.
- timestamp: 2026-09-03T00:22:00+08:00
  checked: spectrum-based fault localization prerequisites
  found: The focused Node test suite has passing and failing tests but no per-test coverage spectrum configured for this run.
  implication: SBFL is skipped; deterministic reproduction and differential/observability-first localization are the Bohrbug route.
- timestamp: 2026-09-03T00:28:00+08:00
  checked: node --test dist-tests/hooks/launcher.test.cjs on the untouched current build
  found: Reproduced exactly 14 passing and 3 failing tests in 2.9 seconds. Each failure exits successfully with empty stderr and empty stdout at the first Codex rendered-command assertion; direct Windows launcher, concurrency, invalid-input, and POSIX controls all pass.
  implication: The failure is deterministic and isolated to the rendered project-command path. Because the combined Codex/Claude tests abort at the first Codex assertion, current output does not establish whether Claude would independently pass.
- timestamp: 2026-09-03T00:35:00+08:00
  checked: one installed Codex fixture across direct launcher, decoded bootstrap, full commandWindows, and generic command
  found: State contained 21 managed files and 4 sections; command lengths were 5950 and 5876 bytes. All four invocations exited 0 with zero stdout/stderr, including direct run_hook.cmd with the codex argument.
  implication: H1 and command-boundary hypotheses are eliminated. The key differential from the passing standalone launcher control is the codex host argument, which enables managedRoot-aware reminder gating in pre-tool-dispatcher/grep-nudge.
- timestamp: 2026-09-03T00:41:00+08:00
  checked: complete src/hooks/once-marker.cts context-epoch and claim-capacity behavior
  found: source resume creates epoch 0 if absent, but claimKey suppresses all new reminders once the shared default cache contains MAX_NUDGE_MARKERS (1024) .claim files. launcher.test.cts randomizes session IDs yet does not redirect LOCALAPPDATA/cacheRoot.
  implication: A full machine-global test cache explains why only host-aware installed commands are empty while the no-host standalone launcher control still emits.
- timestamp: 2026-09-03T00:47:00+08:00
  checked: default OS cache metadata and a fresh-LOCALAPPDATA counterfactual using the unchanged installed Codex command
  found: The default cache contains exactly 1024 .claim files and 830 epoch files with no stale capacity lock. Redirecting LOCALAPPDATA to an empty temporary directory made the same command exit 0 with 353 bytes of valid PreToolUse JSON and one new claim.
  implication: H3 is causally confirmed. Product capacity/fail-open behavior is operating as designed; the test must isolate its cache rather than depend on or mutate machine-global reminder state.
- timestamp: 2026-09-03T01:06:00+08:00
  checked: npm run build after the test-harness fix
  found: Both production and test TypeScript compilations completed successfully with exit code 0.
  implication: The hermetic-cache change typechecks and is ready for focused behavioral verification.
- timestamp: 2026-09-03T01:14:00+08:00
  checked: node --test dist-tests/hooks/launcher.test.cjs after the fix
  found: All 17 tests passed with exit code 0 in 6.6 seconds, including installed Codex Windows root, moved Codex Windows root, and the Codex generic cmd.exe command.
  implication: The target regression is green against the same saturated machine cache; revert-and-reconfirm is the remaining causal check.
- timestamp: 2026-09-03T01:23:00+08:00
  checked: focused launcher suite after manually removing only the unstaged cache-isolation hunk and rebuilding
  found: The exact original result returned — 14 passed and the same three Codex Windows empty-stdout assertions failed, with no other failures.
  implication: The harness change is causally necessary on the reproduced saturated-cache environment; reapplication must restore all 17 passes.
- timestamp: 2026-09-03T01:35:00+08:00
  checked: npm run build and focused launcher suite after reapplying the exact cache-isolation hunk
  found: Build passed and all 17 focused launcher tests passed again with exit code 0 in 6.8 seconds.
  implication: Revert-and-reconfirm is complete: bug_returned_on_revert=true and fixed_on_reapply=true.
- timestamp: 2026-09-03T01:38:00+08:00
  checked: npm run test:capability-hooks adjacent dispatcher, code-style, once-marker, and cleanup suites
  found: All 22 adjacent tests passed with exit code 0.
  implication: The test-harness isolation does not regress reminder capacity, dispatch, code-style, or cleanup behavior.
- timestamp: 2026-09-03T01:44:00+08:00
  checked: final unstaged diff, whitespace check, mutation-tool availability, suite-cache cleanup, real-cache preservation, and staged-index fingerprint
  found: Diff check passed; the only launcher fix is the test-owned cache root/after cleanup/environment injection. No Stryker package or config exists. No suite cache directory remained, the real cache stayed at 1024 claims, and the index remains tree 3857caaeec6e1d87b32d0844d326bb6da925140d with patch hash a2b55c722c82c32e443d574f9b75e4665be16261 and 92 staged paths.
  implication: The fix is minimal, non-deleting, leaves production behavior and user cache untouched, and preserves the Phase 06 index byte-for-byte.
- timestamp: 2026-09-03T02:44:48+08:00
  checked: human verification checkpoint response
  found: The Phase 06 executor confirmed the test-only hermetic cache fix is correctly scoped and matches the root cause.
  implication: End-to-end verification is complete and the debug session can be archived without staging or committing the fix.

## Eliminated

- hypothesis: H1 — the compact embedded bootstrap rejects the valid Codex state before spawning run_hook.cmd
  evidence: A disposable installed fixture produced empty stdout even when run_hook.cmd was called directly with the codex argument, before the embedded bootstrap was involved. The direct launcher, direct decoded bootstrap, full commandWindows, and generic command all exited 0 with empty streams.
  timestamp: 2026-09-03T00:35:00+08:00

- hypothesis: cmd.exe command length or outer quoting truncates the rendered command
  evidence: The rendered commandWindows is 5950 bytes and the generic command is 5876 bytes, both well below the guarded 8192-byte boundary; more decisively, direct invocation of the installed run_hook.cmd with host codex is already empty.
  timestamp: 2026-09-03T00:35:00+08:00

- hypothesis: H2 — contextEpochForSession requires a preceding SessionStart marker
  evidence: The complete implementation explicitly creates generation 0 for source resume when no epoch state exists; PreToolUse uses this resume path. Missing SessionStart therefore does not by itself suppress a fresh stable session.
  timestamp: 2026-09-03T00:41:00+08:00

## Resolution

root_cause: The launcher test harness inherits the machine-global reminder cache instead of a suite-owned temporary cache; when that cache reaches the intentional 1024-claim cap, host-aware installed launcher invocations suppress new reminders and return empty stdout.
fix: tests/hooks/launcher.test.cts now creates one suite-owned temporary cache, passes it as LOCALAPPDATA and XDG_CACHE_HOME to every launcher child, and removes it in a module after hook; production code is unchanged.
verification:
  target_test: { result: pass, command: "node --test dist-tests/hooks/launcher.test.cjs", result_summary: "17/17 passed" }
  mutation_check: { result: skipped, reason_if_skipped: "No Stryker dependency or configuration exists", mutant_killed: false }
  no_op_deletion: { result: pass, deletion_justified_by_rca: false, evidence: "Additive test cache isolation and teardown; no product logic or assertions removed" }
  adjacent_tests: { result: pass, suites_run: ["npm run build", "npm run test:capability-hooks (22/22 passed)"] }
  revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true, evidence: "14/17 with the same three failures after inverse patch; 17/17 after exact reapplication" }
  environment_check: { result: pass, evidence: "Real cache remained saturated at 1024 claims while isolated focused suite passed; temporary suite cache removed" }
  index_integrity: { result: pass, evidence: "Before/after tree and cached patch hashes identical; 92 staged paths unchanged" }
  human_verification: { result: pass, evidence: "Phase 06 executor confirmed the test-only hermetic cache fix is scoped and matches the root cause" }
  guardrail_verdict: accepted
files_changed: [tests/hooks/launcher.test.cts]
oracle_type: specified — the launcher contract explicitly requires eligible host-aware events to emit strict advisory JSON while product capacity behavior remains fail-open.

## Prevention

- **Blameless causal branches:** Code/test branch — `environment()` inherited machine-global cache paths, so the suite did not own all state affecting its assertions. Environment branch — the legitimate global reminder cache had reached the intentional 1024-claim cap. Config/product branch — capacity suppression is deliberately fail-open, so empty stdout is correct at that boundary. The failure required the code/test and environment conditions together.
- **Why not caught:** The launcher tests randomized session identifiers but had no hermetic persistent-cache boundary; normal runs on machines below the claim cap could not expose the external-state dependency, while typecheck and lint cannot detect it.
- **Recurrence guard:** `tests/hooks/launcher.test.cts` now creates a suite-owned temporary cache, injects it through both `LOCALAPPDATA` and `XDG_CACHE_HOME`, and removes it in a module `after` hook. The focused suite passes 17/17 against a still-saturated real cache, and adjacent hook tests pass 22/22.
