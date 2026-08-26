---
quick_id: 260826-dut
status: complete
completed: 2026-08-26
implementation_commits:
  - "8e317b6"
  - "KCodeRag:5568e4c0"
---

# Quick Task 260826-dut Summary

Added project-only OpenCode support and a shared successful KCodeRag MCP-call marker for Codex,
Claude Code, Cursor, and OpenCode without widening the public QA-only product.

## Delivered

- Added OpenCode `install`, `status`, `doctor`, `update`, and `uninstall` lifecycle support for one
  root `opencode.json` or `opencode.jsonc`, a project skill, and a stable 1.x local plugin.
- Added secret-free, bounded, fail-open call markers through Codex/Claude `PostToolUse`, Cursor
  `afterMCPExecution`, and OpenCode `tool.execute.after`.
- Extended host dispatch, source-conflict checks, generation, pack inventory, required smoke, CI,
  release gates, and documentation from three hosts to four.
- Preserved JSONC comments, trailing commas, unrelated configuration, and project-only ownership;
  ambiguous OpenCode config names and user-level duplicate sources hard-stop before writes.
- Fixed uninstall status across all hosts so recursively empty managed-directory residue is treated
  as `not_installed`, while files, links, special entries, unreadable paths, and oversized trees
  remain `orphaned_managed_root`.
- Updated the authoritative KCodeRag QA guide in sibling commit `5568e4c0`; no guide copy was added
  to this repository.

## Verification

- `npm run ci:local`: PASS — 296 tests passed, one Windows symlink-privilege test skipped; exact
  generation, 54-entry npm tarball audit, and four-host required smoke all passed.
- Fresh completion gate: build PASS; 34 focused tests passed with the same one privilege skip;
  generation, pack, six-document policy, and `git diff --check` passed.
- OpenCode `1.18.23` real-host acceptance from a local npm tarball: install/status/doctor/update,
  project plugin and skill discovery, QA MCP connected, `list_indexes` called successfully, one
  83-byte allow-listed marker created, uninstall completed, and final status was `not_installed`.
- The default Alibaba model credential was expired and returned 401; the host acceptance used the
  explicit free `opencode/big-pickle` model without modifying the user's default model config.

## Evidence boundary

The implementation remains version `0.2.2` in the working release metadata and was not published.
The OpenCode evidence proves the current local tarball, not public `kcoderag-nav@0.2.2` or
`@latest`. A future production release must add four-host public exact/latest evidence without
rewriting historical publish-receipt schemas v1-v4.
