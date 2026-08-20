---
quick_id: 260820-vuc
status: complete
completed: 2026-08-20
implementation_commit: 1119e67
---

# Quick Task 260820-vuc Summary

## Outcome

QA and Dev remain independently generated, installable packages, but the supported project
installation state now contains exactly one environment. The installer rejects `both` and rejects
cross-environment installation until the current environment is explicitly uninstalled.

## Changes

- Reduced the canonical route table to singleton QA and Dev rules and regenerated both packages.
- Replaced dual-environment nudge text with a 196-character graph-first hint that explicitly permits
  local fallback when the selected index is unavailable or stale.
- Removed cross-process marker deduplication and its filesystem IO from the hook.
- Updated installer, smoke harness, docs, skills, and tests for mutually exclusive environments.
- Documented the host boundary: direct user-level plugin installs cannot be made mutually exclusive
  through the current manifest schema, so simultaneous enablement is unsupported there.

## Verification

- `python -B scripts/generate_plugins.py --check` — exit 0
- `python -B -m unittest discover -s tests -p "test_*.py" -v` — 48 tests passed
- `python -B kcoderag-qa/hooks/test_grep_nudge.py` — 55/55 passed
- `python -B kcoderag-dev/hooks/test_grep_nudge.py` — 55/55 passed
- `git diff --check` — exit 0

## Commit

- `1119e67 feat(260820-vuc): make QA and Dev mutually exclusive`
