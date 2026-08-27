---
quick_id: 260827-nuo
status: complete
description: "完善 ZCode 项目级 Hook：advisory PreToolUse、成功调用 marker、自动更新提示、所有权与卸载恢复、测试和文档"
created: 2026-08-27T09:10:24.775Z
---

# ZCode project Hook support

## Task 1: Lock the native contract with failing tests

- Extend the shared update and successful-call marker host matrices to include ZCode.
- Prove ZCode accepts its observed MCP tool-name forms without recording unrelated tools or payload contents.
- Replace the old negative adapter assertions with the native workspace schema: `hooks.enabled`, `hooks.events.PreToolUse`, and `hooks.events.PostToolUse` using portable process hooks.

## Task 2: Project the Hook runtime transactionally

- Reuse the bounded advisory dispatcher and update runtime with `host: zcode` and the workspace root supplied by ZCode.
- Merge managed Hook entries into `.zcode/config.json` without replacing unrelated events or claiming a user-owned enabled flag.
- Deploy only the required CommonJS runtime beneath `.zcode/kcoderag-nav/hooks`, record contributor-scoped sections, hard-stop unmanaged duplicates, and preserve exact uninstall restoration.
- Keep every Hook fail-open and advisory; never deny or block Grep, Glob, or Bash.

## Task 3: Correct product contracts and verify

- Remove the false "ZCode ignores project Hooks" claim from README, project planning contracts, maintainer documentation gates, and the authoritative sibling experience guide where applicable.
- Run build, focused Hook/ZCode tests, deterministic generation, pack audit, full local CI, and a clean packaged ZCode real-host acceptance.
- Commit production changes atomically, then write the quick summary and update `.planning/STATE.md` without staging unrelated dirty planning work.
