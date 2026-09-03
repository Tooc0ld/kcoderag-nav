---
quick_id: 260903-dng
phase: quick-260903-dng
plan: "01"
type: execute
status: planned
mode: quick-full
wave: 1
depends_on: []
files_modified:
  - .planning/config.json
  - .planning/debug/
  - .planning/phases/
  - .planning/quick/
  - .planning/STATE.md
  - package.json
  - package-lock.json
  - kcoderag-qa/.claude-plugin/plugin.json
  - kcoderag-qa/.codex-plugin/plugin.json
  - kcoderag-cursor/.cursor-plugin/plugin.json
  - tests/maintainer/readiness-workflow.test.cts
autonomous: true
requirements: []
estimate:
  tasks: 3
  confidence: high
must_haves:
  truths:
    - "All valid tracked and untracked project work is preserved in commits; only verified cache, empty placeholder, and superseded planning artifacts are removed."
    - "The immutable v0.3.2/v0.3.3 release lineage and completed Phase 06 lineage are both ancestors of the final master branch."
    - "The integrated tree passes full local CI, deterministic generation, pack audit, and required five-host smoke before master changes."
    - "Remote master is updated without force-push, immutable release tags remain unchanged, and only branches proven merged or explicitly superseded are deleted."
    - "Phase 05 plan 05-06 remains honestly incomplete after consolidation."
  artifacts:
    - path: .planning/quick/260903-dng-integrate-release-v0-3-3-and-completed-p/260903-dng-SUMMARY.md
      provides: Branch-integration and cleanup evidence
    - path: .planning/quick/260903-dng-integrate-release-v0-3-3-and-completed-p/260903-dng-VERIFICATION.md
      provides: Fresh merge-readiness and remote-state verification
  key_links:
    - from: release/v0.3.3
      to: codex/centralize-qa-guide
      via: A non-rewriting merge preserving both published release commits and Phase 06 commits
    - from: codex/centralize-qa-guide
      to: master
      via: Reviewed PR or ancestry-safe fast-forward after all gates pass
---

# Quick Task 260903-dng: Consolidate release and Phase 06 history

## Goal

Safely consolidate the published `v0.3.3` release lineage and the completed Phase 06 lineage onto the repository's actual default branch, `master`, while preserving legitimate local work and removing only proven-obsolete branches, worktrees, and cache artifacts.

## Task 1: Reconcile the dirty workspace and obsolete recovery history

**Files:** `.planning/config.json`, `.planning/debug/`, `.planning/phases/`, `.planning/quick/`, `docs/MCP_QA_EXPERIENCE_GUIDE.md`

**Action:** Commit the legitimate GSD configuration and durable planning/debug artifacts; normalize the guide's whitespace-only drift; delete only the local dispatch sentinel, research cache, empty `.gitkeep` files, and the superseded incomplete `260902-n3l` quick plan. Verify the recovery branch's raw-filename fix is superseded by the current exact-one-file authenticated implementation, then retain that conclusion in the summary before deleting the branch later.

**Verify:** `git diff --check`; explicit staged-path review; all remaining untracked paths are either this quick task's artifacts or intentionally retained durable project records.

**Done:** The primary worktree is clean and every removed item is either regenerable cache/placeholder data or documented as superseded.

## Task 2: Integrate the immutable release lineage and revalidate the product

**Files:** release-owned package/manifests/readiness test plus the Phase 06 tree

**Action:** Merge `release/v0.3.3` into `codex/centralize-qa-guide` without rewriting tags or history. Confirm `v0.3.2`, `v0.3.3`, `origin/master`, and all Phase 06 commits are ancestors of the result. Run deterministic generation and apply generated changes only if the check requires them.

**Verify:** `npm run ci:local`; `npm run smoke:required`; `git diff --check`; ancestry checks for both release and Phase 06 tips.

**Done:** The integrated feature branch is clean, contains both histories, and all required gates pass on the exact integrated tree.

## Task 3: Ship to master and clean merged branch/worktree refs

**Files:** `.planning/STATE.md`, quick SUMMARY/VERIFICATION artifacts, Git refs/worktrees

**Action:** Push the integrated branch, use the repository's authenticated GitHub flow to merge it into `master` without force-push, then verify the remote master OID. Remove only clean temporary worktrees and local/remote branches whose tips are ancestors of remote master; keep immutable tags. Delete the reviewed recovery branch only after recording why its implementation is superseded.

**Verify:** remote `master` contains both integration parents; `git ls-remote` matches local master; branch/worktree inventory contains no obsolete merged worktree or candidate branch; Phase 05 still reports only `05-06` incomplete.

**Done:** The working checkout is on clean `master`, remote master matches it, release tags remain, and no safely removable merged branches/worktrees remain.
