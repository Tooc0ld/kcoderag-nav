---
quick_id: 260821-kqa
status: complete
completed: 2026-08-21
implementation_commits:
  - "0f5204f"
  - "a9e4bda"
  - "1602284"
  - "df1ab3f"
---

# Quick Task 260821-kqa Summary

Fixed Codex bundled MCP compatibility, added project-installer duplicate-source protection,
and released the independently generated QA, Dev, and Cursor packages as 0.1.4.

## Delivered

- Changed Codex `.codex.mcp.json` generation from the legacy `mcp_servers` wrapper to the
  official direct server map while preserving Claude Code's root `.mcp.json` format.
- Added a credential-safe, read-only scan of user-level Codex MCP and enabled marketplace
  plugin section names before project install/update.
- Hard-stopped duplicate same-environment sources with `duplicate_same_environment` and
  cross-source QA/Dev coexistence with `environment_conflict` before any project write.
- Kept same-owner project reinstall idempotent, disabled user plugins non-blocking, and
  project uninstall available as a cleanup path.
- Extended project `status` with stable external-source diagnostics without returning MCP
  values, headers, or credentials.
- Released QA `0.1.4+codex.f487228683225493`, Dev
  `0.1.4+codex.3943279af981df3d`, and Cursor
  `0.1.4+cursor.b142549ea49d4c96` from the deterministic generator.
- Incrementally updated the authority guide at
  `D:/AIProgram/KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md`. That repository's existing local work
  remains uncommitted and was not pushed by this quick task.

## Verification

- `python scripts/generate_plugins.py --check`: passed.
- Full unittest suite: 91 passed, 1 local Windows symlink-privilege skip.
- QA hook regression: 55/55 passed.
- Dev hook regression: 55/55 passed.
- Repository pre-commit and `git diff --check`: passed.
- GitHub Actions CI run 32458104954: succeeded on Ubuntu and Windows with Python 3.10 and
  3.13.
- Optional authenticated Codex/Claude host smoke: not run; the workflow job was skipped as
  designed because this was not an authenticated self-hosted dispatch.

Primary release commit: `1602284`.
