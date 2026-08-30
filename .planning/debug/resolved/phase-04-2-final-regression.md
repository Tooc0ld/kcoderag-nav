---
status: resolved
trigger: "Phase 04.2 final regression has five failures after review fixes; validate isolation residue before assuming a product defect."
created: 2026-08-30
updated: 2026-08-30T10:51:32.6401391+08:00
---

# Debug Session: Phase 04.2 Final Regression

## Symptoms

- expected: The final Phase 04.2 regression gate passes the complete `npm test` suite after the clean code-review report, while the canonical MCP endpoint remains `/mcp` without a trailing slash.
- actual: The suite reports 421/426 passing and five failures. Pack audit and smoke failures surface `PackAuditError: files_policy_invalid`; two readiness-workflow failures surface generic `readiness_workflow_failed` instead of their expected safe failure codes.
- errors: Three failures originate while `repositorySnapshot()` normalizes Git status paths. Two child-process readiness cases lose the expected `artifact_auth_invalid` or `artifact_upload_failed` classification.
- timeline: Observed after review-fix commits `4ff02e8` and `a90949a`, and clean re-review commit `2eba5ba`, during the final Phase 04.2 regression gate.
- reproduction: Run the full `npm test` suite from `D:\AIProgram\kcoderag-nav` with the review-fix branch and master pointing at the same HEAD. Inspect the untracked `.planning/phases/04.2-public-debranding/.review-fix-recovery-pending.json` and any worktree or environment residue before changing product code.

## Current Focus

- bug_class: Bohrbug; deterministic repository-shape/environment residue
- hypothesis: VERIFIED — the registered nested review-fix worktree was emitted by `git ls-files --cached --others --exclude-standard -z` as a slash-terminated directory; file-only `normalizeRelative()` rejected it, and readiness package-upload surfaced the same upstream pack failure generically.
- test: COMPLETE — focused 28/28, full 426/426, endpoint/generation checks, controlled revert-and-reconfirm, and final exact repository preservation all passed.
- expecting: SATISFIED — canonical/generated MCP endpoint pathname is exactly `/mcp`, master/HEAD and all 35 pre-existing dirty paths are preserved, and no review/debug worktree residue remains.
- candidate_causes:
  - review-fix recovery marker or worktree metadata is still active
  - inherited Git environment redirects status or child processes
  - repositorySnapshot rejects a legitimate porcelain path shape introduced by the review-fix marker
  - readiness child-process setup inherits repository state that masks the intended safe error
- and_gate: Preserve all pre-existing user dirty files, clean only review-fix-owned temporary state when exact ownership is proven, and keep every canonical/generated MCP endpoint at `/mcp` with no trailing slash.
- next_action: none — session archived, durable knowledge-base entry committed, and semantic indexing explicitly skipped because MemPalace is disabled/unavailable
- reasoning_checkpoint:
    hypothesis: "The five failures require the leftover nested review-fix worktree plus repositorySnapshot's file-only path invariant: Git reports the nested worktree as a slash-terminated directory, normalizeRelative rejects it, and readiness catches that upstream pack error generically."
    confirming_evidence:
      - "`git ls-files --cached --others --exclude-standard -z` directly emits only `.claude/worktrees/rf-04.2-30630-001/` with a trailing slash among invalid normalized entries."
      - "Both current and Git-sanitized focused runs fail at normalizeRelative; readiness package-upload creates the candidate package before artifact auth/upload."
      - "The exact marker, registered worktree, branch, and HEAD agree; the sole apparent modification has empty diff metadata and a blob identical to review-fix and master."
    falsification_test: "If exact worktree removal does not remove the slash-terminated ls-files entry, or if the same focused tests still fail, this hypothesis is false and cleanup must be reverted/reinvestigated."
    fix_rationale: "Remove the stale review-owned execution artifact that supplies the invalid directory entry; do not weaken normalizeRelative or tree-digest policy, because those intentionally admit only ordinary repository files."
    blind_spots: "The fifth full-suite failure and the canonical `/mcp` invariant have not yet been rechecked after cleanup; the full guardrail and a controlled re-add/remove reconfirmation remain required."
    candidate_causes:
      - "environment: GSD review-fix recovery left a registered nested Git worktree inside the authoritative repository after integration"
      - "code: repositorySnapshot intentionally applies a file-only normalizer/digest to every ls-files entry and cannot accept a nested-repository directory entry"
      - "config: inherited Git redirection was tested and eliminated"
      - "data: ordinary user-owned dirty file paths normalize successfully and are not causal"
    and_gate: "yes — neither condition alone fails: the strict snapshot works with ordinary files, and a leftover worktree outside this repository would not enter ls-files; the nested residue and strict file-only snapshot must co-occur."
- tdd_checkpoint: not requested

## Evidence

- timestamp: 2026-08-30
  checked: authoritative worktree, branch, and HEAD
  found: `D:/AIProgram/kcoderag-nav` is the `master` worktree at `2eba5babb8dbddea632dd1cd4b435cbc1cd05922`; `master` includes the reported clean review, while the review-fix branch remains at `a90949a`.
  implication: the regression is being observed from the intended authoritative checkout, not from the stale review-fix branch.
- timestamp: 2026-08-30
  checked: registered worktrees and recovery-marker structure
  found: Git still registers `.claude/worktrees/rf-04.2-30630-001` on `gsd-reviewfix/04.2-30630-001`, and the untracked recovery marker contains only recovery metadata fields (`worktree_path`, `branch`, `reviewfix_branch`, `padded_phase`, `started_at`).
  implication: exact review-fix-owned temporary state exists and is a testable environment/repository-shape cause; no cleanup is authorized until its values and cleanliness are validated.
- timestamp: 2026-08-30
  checked: inherited Git environment names
  found: only `GIT_PAGER` is set; no `GIT_DIR`, `GIT_WORK_TREE`, index override, or object-directory override is inherited.
  implication: direct repository redirection by inherited Git variables is unlikely; a sanitized comparison will falsify it.
- timestamp: 2026-08-30
  checked: user-owned dirty state
  found: the authoritative checkout contains many pre-existing modified/untracked planning artifacts in addition to the review-fix worktree and marker.
  implication: broad cleanup is unsafe; any cleanup must target only exact review-fix-owned paths after verification.
- timestamp: 2026-08-30
  checked: recovery marker path representation
  found: `worktree_path` is already an absolute `D:/AIProgram/kcoderag-nav/.claude/worktrees/rf-04.2-30630-001` path; an initial diagnostic incorrectly joined it to the repository root and therefore did not inspect the worktree.
  implication: that diagnostic is invalid evidence about worktree existence or cleanliness and must be rerun with absolute-path handling before cleanup.
- timestamp: 2026-08-30
  checked: recovery ownership against live Git metadata
  found: the marker resolves inside the authoritative project, exists, is registered on exactly `gsd-reviewfix/04.2-30630-001` at `a90949a`, and the marker names the same branch; the nested worktree has one modified path, `kcoderag-qa/opencode/kcoderag-nav.js`.
  implication: the marker and worktree are exact review-fix temporary state, but forced removal is not yet safe because one uncommitted file must first be classified.
- timestamp: 2026-08-30
  checked: focused pack-audit and readiness-workflow tests in current and Git-sanitized processes
  found: both runs deterministically fail the same four tests; two fail in `repositorySnapshot()` with `files_policy_invalid`, and the two readiness child cases return only `readiness_workflow_failed`. Both runs pass 24/28.
  implication: inherited Git variables are not causal. The readiness errors are consistent with a shared package snapshot failure occurring before their intended artifact-auth/upload error branches.
- timestamp: 2026-08-30
  checked: NUL-delimited `git ls-files --cached --others --exclude-standard -z` entry shapes
  found: the only invalid normalized entry is exactly `.claude/worktrees/rf-04.2-30630-001/`; it ends with `/`, producing the empty segment rejected by `normalizeRelative()`.
  implication: this directly reproduces the throw site at `src/maintainer/pack-audit.cts:417` and confirms the nested review worktree as the trigger.
- timestamp: 2026-08-30
  checked: readiness package-upload error path
  found: `packageAndUpload()` creates/audits the candidate package before artifact auth/upload; `main()` maps unexpected `PackAuditError` to `readiness_workflow_failed`.
  implication: the two readiness assertion failures are downstream manifestations of the same snapshot error, not independent error-mapping defects.
- timestamp: 2026-08-30
  checked: apparent dirty file in review-fix worktree
  found: `git diff --numstat` and `git diff --check` report no content diff, and the working filtered blob `7645f071...` exactly matches both the review-fix commit and authoritative `master` blob.
  implication: the modified status is a line-ending/index artifact with no unique bytes to preserve; exact worktree removal will not discard user content.
- timestamp: 2026-08-30
  checked: first guarded cleanup attempt
  found: PowerShell stopped on Git's known LF-to-CRLF warning before `git worktree remove` executed; the worktree remains registered and present.
  implication: no mutation occurred; retry must tolerate only this native warning while retaining explicit path, branch, HEAD, diff, staged, and untracked safety checks.
- timestamp: 2026-08-30
  checked: guarded exact worktree cleanup
  found: after all ownership/content predicates passed, Git removed only `D:/AIProgram/kcoderag-nav/.claude/worktrees/rf-04.2-30630-001`; `master` remains at `2eba5ba` and `gsd-reviewfix/04.2-30630-001` remains preserved.
  implication: the causal nested repository is gone without losing branch history or touching unrelated dirty files.
- timestamp: 2026-08-30
  checked: exact recovery-marker cleanup
  found: the obsolete `.review-fix-recovery-pending.json` marker was removed after its referenced worktree was removed; no other planning artifact was deleted.
  implication: review-fix temporary state is internally consistent again and unrelated user-owned dirty state remains out of scope.
- timestamp: 2026-08-30
  checked: post-cleanup repository shape and preservation baseline
  found: only the authoritative `master` worktree remains; HEAD and `master` are both `2eba5babb8dbddea632dd1cd4b435cbc1cd05922`, the review-fix branch remains at `a90949aff1dbbd3bb29353c95c531046cd2d0e14`, `git ls-files -z` has zero invalid entries, and the 35-path porcelain status has SHA-256 `1caac967b0ab9cecc59e70ef7c6e12156eec5152a92f4c065922280fbe68e4b5`.
  implication: cleanup removed the causal nested entry while preserving branch history and establishing an exact dirty-state oracle for the remaining verification.
- timestamp: 2026-08-30
  checked: 28 focused pack-audit and readiness-workflow regressions after cleanup
  found: `node --test dist-tests/maintainer/pack-audit.test.cjs dist-tests/maintainer/readiness-workflow.test.cjs` exited 0 with 28 tests, 28 pass, 0 fail, 0 cancelled, and 0 skipped; both readiness child-process classification cases passed.
  implication: removing the nested review-owned worktree eliminated both the direct pack snapshot failures and the downstream generic readiness fallbacks without a product-code change.
- timestamp: 2026-08-30
  checked: complete Node test suite after focused verification
  found: `npm test` exited 0 with 426 tests, 426 pass, 0 fail, 0 cancelled, and 0 skipped in 372054 ms.
  implication: the environment-only cleanup restores the full Phase 04.2 regression gate and does not regress adjacent CLI, transaction, host, generator, hook, release, readiness, or smoke behavior.
- timestamp: 2026-08-30
  checked: canonical and generated HTTP(S) MCP endpoint pathname inventory
  found: a secret-safe scan found exactly four endpoint literals (one canonical template and three generated projections); every parsed pathname is exactly `/mcp`, the expected file inventory matches, and trailing-slash violations are zero. The only raw `/mcp/` text outside endpoint values is the intentional terminal-slash detection in the source/compiled normalizer.
  implication: the canonical and generated product endpoints satisfy the specified no-trailing-slash contract without exposing origins, headers, Bearer values, or configuration bodies.
- timestamp: 2026-08-30
  checked: deterministic generated-product canonicality
  found: `npm run generate:check` exited 0 with `ok:true`, `changedPaths:[]`, `writtenPaths:[]`, and no diagnostics across all selected QA/Cursor product paths.
  implication: the endpoint-bearing generated assets and all sibling generated products remain byte-canonical and the check introduced no writes.
- timestamp: 2026-08-30
  checked: repository and user-owned dirty-state preservation after all primary tests
  found: `master` and HEAD remain `2eba5babb8dbddea632dd1cd4b435cbc1cd05922`, exactly one worktree is registered, invalid ls-files entries remain zero, the obsolete marker/worktree remain absent, and the 35-entry raw porcelain SHA-256 is still `1caac967b0ab9cecc59e70ef7c6e12156eec5152a92f4c065922280fbe68e4b5`.
  implication: focused tests, the full suite, endpoint scanning, and generation checking preserved master and every pre-existing user-owned dirty path exactly.
- timestamp: 2026-08-30
  checked: controlled guardrail reintroduction setup
  found: Git created only the detached no-checkout worktree `.claude/worktrees/gsd-debug-reconfirm` at preserved commit `a90949aff1dbbd3bb29353c95c531046cd2d0e14`.
  implication: the causal nested-repository condition is temporarily restored without changing product files, master, or any branch ref.
- timestamp: 2026-08-30
  checked: ls-files shape with the controlled reconfirmation worktree present
  found: the only invalid normalized entry is exactly `.claude/worktrees/gsd-debug-reconfirm/`, including its terminal slash.
  implication: the controlled setup recreates the same minimal repository-shape trigger as the removed review-fix worktree.
- timestamp: 2026-08-30
  checked: targeted pack-audit reproduction with the nested worktree restored
  found: the single selected test exited 1 with 0 pass/1 fail and the original `PackAuditError: files_policy_invalid` stack in `repositorySnapshot()`.
  implication: the bug returns solely when the causal nested-worktree condition is reintroduced, satisfying the first half of revert-and-reconfirm.
- timestamp: 2026-08-30
  checked: controlled reconfirmation worktree removal
  found: the exact resolved target contained only its `.git` worktree metadata, remained detached at `a90949aff1dbbd3bb29353c95c531046cd2d0e14`, and `git worktree remove --force` removed that target successfully.
  implication: the guardrail setup was reversed without deleting product files, user-owned dirty paths, or branch history.
- timestamp: 2026-08-30
  checked: targeted pack-audit after reapplying the environment cleanup
  found: the identical single selected test exited 0 with 1 pass/0 fail after the temporary nested worktree was removed.
  implication: this cleanup is both necessary and sufficient for the reproduced failure, completing revert-and-reconfirm.
- timestamp: 2026-08-30
  checked: final repository preservation after revert-and-reconfirm
  found: `master` and HEAD remain `2eba5babb8dbddea632dd1cd4b435cbc1cd05922`, exactly one worktree is registered, invalid ls-files entries are zero, the raw 35-entry porcelain SHA-256 remains `1caac967b0ab9cecc59e70ef7c6e12156eec5152a92f4c065922280fbe68e4b5`, and all old/temporary review worktree paths are absent.
  implication: every automated guardrail completed without altering master, branch history, product code, or pre-existing user-owned dirty paths.
- timestamp: 2026-08-30
  checked: durable archive and semantic-index availability
  found: the resolved session was archived and the prevention entry appended under `commit_docs:true`; project configuration has `mempalace.enabled:false` and no `mempalace` CLI is installed.
  implication: the plain-text knowledge base is the durable fallback and semantic indexing is explicitly skipped rather than silently assumed.

## Eliminated

- hypothesis: inherited `GIT_*` redirection changes the repository or child-process behavior
  evidence: the focused test set produces byte-equivalent failure classifications after all inherited `GIT_*` variables are removed; only non-redirecting `GIT_PAGER` existed.
  timestamp: 2026-08-30

## Resolution

- root_cause: "AND-gate: the review-fix workflow left its registered worktree inside `.claude/worktrees/` after integration; Git exposes that nested repository as a slash-terminated directory entry, which the intentionally file-only `repositorySnapshot()` normalization rejects before pack/readiness logic can proceed."
- fix: "Removed the exact validated review-fix worktree and its obsolete recovery marker; preserved the review-fix branch and made no product-code change."
- verification:
    target_test: { result: pass, command: "node --test dist-tests/maintainer/pack-audit.test.cjs dist-tests/maintainer/readiness-workflow.test.cjs", outcome: "28/28 pass" }
    mutation_check: { result: skipped, reason_if_skipped: "No product-code fix site exists; the fix removed external review-workflow residue." }
    no_op_deletion: { result: pass, deletion_justified_by_rca: true, reason: "Only the exact review-workflow-owned nested worktree and obsolete marker were removed; no product behavior, assertion, or branch was deleted." }
    adjacent_tests: { result: pass, suites_run: ["npm test (426/426 pass)"] }
    revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true, reproduction: "single pack-audit test failed with files_policy_invalid when a detached nested worktree was reintroduced and passed after its exact removal" }
    endpoint_contract: { result: pass, outcome: "1 canonical and 3 generated endpoint literals all have pathname /mcp; 0 trailing-slash violations" }
    generation_check: { result: pass, outcome: "generate:check ok with no changed or written paths" }
    repository_preservation: { result: pass, outcome: "master/HEAD unchanged; 1 worktree; 0 invalid ls-files entries; 35-path raw porcelain hash unchanged" }
    guardrail_verdict: accepted
- files_changed: [".planning/phases/04.2-public-debranding/.review-fix-recovery-pending.json (removed review-owned residue)"]
- oracle_type: specified

## Prevention

- causal_branches:
  - environment: the review-fix execution worktree remained registered inside the authoritative repository after its branch was integrated, so ordinary repository inventory treated the nested repository as an untracked directory boundary.
  - code-policy: `repositorySnapshot()` intentionally accepts ordinary files only and applies strict relative-file normalization to every `git ls-files -z` entry; it correctly rejects a slash-terminated nested-repository entry rather than weakening pack provenance.
  - process: the review handoff preserved branch history but had no post-integration gate requiring its nested worktree and recovery marker to be retired before final regression.
- and_gate: the failure requires both conditions — strict file-only snapshot policy alone passes for ordinary files, while an external worktree outside the authoritative repository never enters its ls-files inventory.
- why_not_caught: no post-review integration gate existed for repository-local worktree residue; the existing final pack/readiness regression gate did catch the condition, but only after the clean code review had completed.
- recurrence_guard: the existing repository-preservation test `audits a real temporary npm tgz and preserves repository status and tree` in `dist-tests/maintainer/pack-audit.test.cjs` continues to fail on this repository shape, and the new knowledge-base pattern requires checking `git worktree list --porcelain` plus slash-terminated `git ls-files -z` entries before proposing product-code changes.
