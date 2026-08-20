---
quick_id: 260820-wwm
status: complete
completed: 2026-08-20
implementation_commit: 76fe0e1
fix_commit: 55291ad
---

# Quick Task 260820-wwm Summary

## Outcome

The repository now generates one self-contained private Cursor Plugin named `kcoderag-nav`.
It exposes one generic KCodeRag MCP server, defaults to the existing QA profile, and switches
to Dev only when the URL and bearer configuration are replaced together.

## Changes

- Added a root `.cursor-plugin/marketplace.json` and generated `kcoderag-cursor/` package.
- Added Cursor manifest variables, placeholder-only `mcp.json`, the shared navigation skill,
  and a compact always-on Rule; the incompatible Claude/Codex lookup hook is intentionally absent.
- Added deterministic `+cursor.<content-hash>` versions and generator drift/extra-file detection.
- Added regressions for one-server mutual exclusion, QA defaults, administrator-supplied credentials,
  secret-safe failures, package self-containment, LF checkout, and private installation docs.
- Documented private Team Marketplace project scope, Default Off distribution, local development,
  Dev switching, and the prohibition on installing KCodeRag into this distribution repository.
- Kept synthetic Codex/Claude host smoke generation compatible when its loopback MCP has no bearer.

## Verification

- `python -B scripts/generate_plugins.py --check` — exit 0
- `python -B -m unittest discover -s tests -p "test_*.py" -v` — 69 tests passed
- `python -B kcoderag-qa/hooks/test_grep_nudge.py` — 55/55 passed
- `python -B kcoderag-dev/hooks/test_grep_nudge.py` — 55/55 passed
- `cursor.cmd --version` — Cursor 3.8.11 available locally
- `git diff --check` — exit 0

## Commits

- `76fe0e1 feat: add private Cursor plugin distribution`
- `55291ad fix: keep synthetic host smoke generation compatible`

## Remaining discussion

- Move the bundled internal bearer default to administrator-supplied Team Marketplace variables
  before broadening distribution or publishing the repository.
- Decide whether Cursor Cloud Agents need a controlled network path to the internal MCP service;
  the generated package only establishes the plugin/configuration contract.
- Run a manual Customize/install smoke in an expendable project before team rollout; the current
  machine has the Cursor IDE but no headless Cursor plugin validator.
