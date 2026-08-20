---
quick_id: 260821-0nj
status: complete
completed: 2026-08-21
implementation_commit: d147f66
---

# Quick Task 260821-0nj Summary

Documented Cursor's Team Marketplace update path in both the root README and the generated
Cursor package README. The guidance now distinguishes GitHub-backed Auto Refresh, administrator
manual Refresh, Default Off installation policy, and local copy or symlink synchronization.

## Delivered

- Explained the Cursor GitHub App and **Enable Auto Refresh** requirements.
- Recorded the at-most-once-per-10-minutes re-indexing cadence and manual **Refresh** fallback.
- Clarified that **Default Off** is independent from automatic marketplace updates.
- Documented the manual update and reload steps for `~/.cursor/plugins/local` installations.
- Added generation tests that lock the update guidance into both documentation surfaces.

## Verification

- `python -B scripts/generate_plugins.py --check`
- `python -B -m unittest discover -s tests -p "test_*.py" -v` — 69 tests passed
- `git diff --check`

Implementation commit: `d147f66`
