---
quick_id: 260821-flg
status: complete
completed: 2026-08-21
implementation_commit: "7064588, 4b7edf1, 454064c, b284819"
---

# Quick Task 260821-flg Summary

Added a free, checkout-backed Cursor local-plugin lifecycle so individual users can install
`kcoderag-nav` without Cursor Team, Dashboard access, or an organization marketplace.

## Delivered

- Added `scripts/manage_cursor_local_install.py` with `install`, `status`, `update`, and
  `uninstall` commands targeting Cursor's documented `~/.cursor/plugins/local/kcoderag-nav`.
- Defaulted to the generated self-contained Cursor package and bundled QA profile; the manager
  requires Python 3.10+ but no pip dependencies.
- Added ownership state and credential-safe status diagnostics. Unmanaged targets, symlinks,
  missing or changed files, extra paths, and invalid state are refused before destructive work.
- Made repeat installation idempotent, distinguished source updates from installed drift, staged
  replacements on the target volume, restored the old tree on failure, and preserved a recovery
  tree when rollback itself fails.
- Changed the root and generated Cursor READMEs from paid Team Marketplace-first onboarding to
  free clone/install/status/update/uninstall commands. Paid Team Marketplace remains optional.
- Updated project constraints and the authoritative KCodeRag QA guide with the free Cursor path,
  reload/verification steps, Dev pair-switching, Python requirement, and update behavior.
- Refreshed only the Cursor content version to `0.1.2+cursor.50574b25e5db7d6f`; QA and Dev
  versions were unchanged.
- Removed two historically tracked `__pycache__` files already covered by `.gitignore`; Python
  tests can no longer rewrite them and create a false generated-output drift.
- Left `D:/AIProgram/KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md` unstaged and uncommitted because that
  repository contains unrelated user-owned changes.

## Verification

- Plan structure: 3 tasks, 0 errors, 0 warnings.
- `python scripts/generate_plugins.py --check`: passed.
- Full unittest suite: 87 passed, 1 skipped locally because Windows directory symlink creation
  is unavailable without the relevant privilege; non-symlink ownership/path safety tests passed.
- QA hook regression: 55/55 passed.
- Dev hook regression: 55/55 passed.
- Native repository pre-commit and `git diff --check`: passed.
- KCodeRag guide contracts and added-line sensitive-value scan: passed; the guide is not staged.

Implementation/TDD commits: `ddf1da0`, `7064588`, `677ed1c`, `4b7edf1`, `378f1b6`,
`454064c`, `fbfcae6`, `b284819`.

Push: NOT_RUN.
