---
quick_id: 260827-nuo
status: complete
completed: 2026-08-27
implementation_commit: 8d380f6
sibling_guide_commit: 97049019
---

# ZCode project Hook support summary

## Outcome

Corrected the earlier ZCode host assumption and added native workspace Hook support. A ZCode
navigation install now composes project MCP and Skill assets with an advisory, fail-open
`PreToolUse` process Hook, a secret-free `PostToolUse` successful-call marker, and the shared
offline update notice. Local Grep, Glob, and Bash remain available because the Hook never emits a
deny or permission decision. JX3 remains explicitly unsupported.

The adapter preserves unrelated workspace Hook events, claims `hooks.enabled` only when the
installer changed it, tracks contributor-scoped Hook sections and runtime files, and hard-stops an
unmanaged Hook that targets the managed runtime before any write.

## Changes

- Extended the dispatcher, marker, update cache, and update notice host matrices to include ZCode.
- Projected eight self-contained CommonJS Hook files below `.zcode/kcoderag-nav/hooks/` and merged
  managed `PreToolUse`/`PostToolUse` entries into `.zcode/config.json`.
- Upgraded required smoke evidence from ZCode `skill_mcp` to an executed `pretooluse_hook`
  contract at the project root and a Unicode deep directory.
- Updated canonical README/template/generated assets, documentation gates, project contracts, and
  the sibling authoritative `MCP_QA_EXPERIENCE_GUIDE.md`.

## Verification

- `npm run ci:local` — PASS: build, dependency audit, 338/338 tests, generation check, pack audit,
  and five-host required smoke.
- `pack:audit` — PASS with 74 exact archive entries.
- Packaged ZCode install in
  `D:/AIProgram/zcode-hook-acceptance-20260827-173849` — install/status/doctor all healthy.
- Structural acceptance — Hooks enabled, one managed advisory PreToolUse, one managed PostToolUse,
  normalized MCP endpoint, Skill present, and eight runtime files.
- Installed-process acceptance from a Unicode deep directory — `PreToolUse` returned bounded
  `additionalContext` with no permission decision; `PostToolUse` emitted no stdout and created one
  hashed 80-byte marker.

## Evidence boundary

The locally installed ZCode executable reports `3.9.2.6069`. The packaged project and installed
Hook processes were exercised directly, but a native desktop conversation has not yet invoked a
real KCodeRag query in this acceptance project. Public npm exact/latest and authenticated native
MCP evidence remain Phase 06 work; this quick task does not upgrade JX3 support.
