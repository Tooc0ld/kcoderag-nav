---
quick_id: 260820-vuc
status: complete
description: Make QA and Dev installations mutually exclusive, remove dual-environment routing guidance, and align the nudge and tests
---

# Quick Task 260820-vuc

## Goal

Treat QA and Dev as mutually exclusive installation modes. Keep each generated package
self-contained, but remove all supported dual-install routing and hook coordination behavior.

## Tasks

1. Enforce exactly one requested environment in the project installer. Remove the `both`
   CLI choice, reject sequential cross-environment installation without writes, and retain
   safe uninstall support for legacy dual-install state.
2. Reduce the canonical routing policy to singleton QA or Dev, shorten the nudge to graph-first
   guidance with explicit local fallback, and remove cross-process marker deduplication.
3. Regenerate both packages, update user-facing documentation and planning decisions, and replace
   dual-install tests with mutual-exclusion, idempotence, fallback, and no-marker regressions.

## Verification

```text
python scripts/generate_plugins.py --write
python scripts/generate_plugins.py --check
python -m unittest discover -s tests -p "test_*.py" -v
python kcoderag-qa/hooks/test_grep_nudge.py
python kcoderag-dev/hooks/test_grep_nudge.py
git diff --check
```

## Boundary

The project installer can enforce mutual exclusion. Current official Codex plugin manifests do
not expose a conflict field, so direct user-level marketplace installs are documented as an
unsupported dual-install configuration rather than falsely claimed to be host-enforced.
