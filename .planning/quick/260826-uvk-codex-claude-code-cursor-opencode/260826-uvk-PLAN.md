---
quick_id: 260826-uvk
status: complete
description: 统一 Codex、Claude Code、Cursor、OpenCode 的自动更新检查与仅提示行为
---

# Unified update awareness

## Goal

Give all four supported hosts the same safe product behavior: a bounded background npm latest check, a cached at-most-once update notice, and an explicit host-scoped update command. No hook or plugin may update project files automatically or block the agent/tool result.

## Tasks

1. [x] Add a host-neutral notice runtime over the existing offline cache/background worker, including host-specific commands, stable session deduplication, fail-open host protocol rendering, and tests.
2. [x] Project the runtime through native host surfaces: keep Codex/Claude PreToolUse context, add Cursor postToolUse context, and add an OpenCode warning toast from its project plugin. Preserve the existing successful-MCP marker behavior.
3. [x] Update deterministic generation/package/docs contracts and verify build, focused hook/generator tests, generated-byte parity, and package inventory declarations. Phase 04.1 Plan 06 retains ownership of the currently pending adapter lifecycle implementation and must satisfy the checked-in Cursor/OpenCode projection tests.

## Safety boundaries

- Foreground hooks perform no network I/O.
- Registry failures, malformed payloads, missing Node, and notification failures are silent/fail-open.
- Notices never contain credentials, URLs, hook input, tool output, or raw session identifiers.
- A notice asks the user first and never invokes `install` or `update` itself.
- Existing Phase 04.1 capability work and unrelated dirty planning files are preserved.
