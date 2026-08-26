---
quick_id: 260826-uvk
status: complete
completed: 2026-08-26
commits: [8aadcef, 8402f05]
---

# Unified four-host update awareness

Implemented one offline-first update notice runtime for Codex, Claude Code, Cursor, and OpenCode. The foreground reads only bounded local state, schedules stale npm Registry refreshes in a detached worker, deduplicates notices, emits an exact `--host` update command, and never changes the project automatically.

## Host delivery

- Codex and Claude Code: the shared PreToolUse dispatcher reads the installed host and appends the cached notice to advisory context.
- Cursor: `update-notice.cjs cursor` emits native `postToolUse` `{ "additional_context": ... }`; the host lifecycle contract requires the exact project hook registration and deployed runtime.
- OpenCode: the project `tool.execute.after` plugin preserves the success marker, schedules refresh with Node, and displays a non-blocking warning toast.

## Assurance

- Secret-bearing host payload fields are discarded before cache/session handling.
- The foreground imports no network client; refresh remains detached, bounded, and fail-open.
- Deterministic QA generation, npm files policy, pack required assets, smoke evidence, README, generated docs, and the sibling authoritative experience guide include the notice runtime.
- Fresh verification after the shared dispatcher integration: `npm run build` and 37 focused capability/hook/OpenCode/docs tests passed.

## Integration boundary

Phase 04.1 Plan 06 currently owns the pending capability-aware host adapter implementations. The quick task adds explicit Cursor/OpenCode lifecycle assertions so that phase cannot complete unless `postToolUse`, the OpenCode plugin, and `update-notice.cjs` are actually projected. The pre-existing `capability_projection_required` host-suite failures are therefore not represented as passing evidence here.
