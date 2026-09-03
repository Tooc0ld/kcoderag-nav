---
quick_id: 260903-rds
status: passed
verified: 2026-09-03
implementation_commits: [bf0945c, 6aca223]
release_tag: v0.3.5
release_run: 33755101113
---

# Verification: public kcoderag-nav 0.3.5 release

## Must-haves

| Requirement | Result | Evidence |
|---|---|---|
| The failed `v0.3.4` release remains immutable and unpublished | PASS | Tag still peels to `f41e7f5`; run `33751756287` was cancelled after both Windows jobs reached the 25-minute timeout; its publish job was skipped. |
| Release CI avoids duplicate packaged smoke without losing required gates | PASS | `bf0945c` uses `npm run test:ci` in the four-platform matrix and retains one explicit `smoke:required`; workflow contract tests pass. |
| The repository release tool creates an exact forward `v0.3.5` release | PASS | Tag `v0.3.5` peels to release commit `6aca2235b46b5f9af8768dca2c1e0e2ebaa6979c`; release-owned version surfaces are `0.3.5`. |
| GitHub Actions publishes only after all release lanes pass | PASS | Run `33755101113` completed successfully: Windows/Ubuntu on Node 22/24 and `Verify and publish matching npm tag` all passed. |
| npm exact and latest point to the same immutable artifact | PASS | Registry queries return exact `0.3.5`, latest `0.3.5`, and matching non-empty integrity values. |
| The public artifact exposes the fifth update Skill | PASS | Public inventory contains 115 files and all canonical, QA, and Cursor `kcoderag-update` files. |
| Public package lifecycle succeeds across all five adapters | PASS | Real `npx kcoderag-nav@0.3.5` install/status/update/uninstall passed for Codex, Claude Code, Cursor, OpenCode, and ZCode; update Skill presence and uninstall restoration were verified for each. |
| The public latest command resolves to the published release | PASS | A separate Codex lifecycle using `npx kcoderag-nav@latest` installed version `0.3.5`, reported healthy status, and uninstalled cleanly. |

## Boundary

This verifies the published package, adapter lifecycles, and project-scoped assets. It does not convert synthetic/public CLI execution into Phase 05 true-host LIVE or authenticated MCP evidence.

## Verdict

PASS. `kcoderag-nav@0.3.5` is publicly available as `latest`, includes the fifth update Skill, and is verified through successful release CI plus real public `npx` lifecycles across all five supported hosts.
