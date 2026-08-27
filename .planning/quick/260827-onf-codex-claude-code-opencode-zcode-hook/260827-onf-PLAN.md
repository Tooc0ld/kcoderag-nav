---
quick_id: 260827-onf
status: complete
description: "完善 Codex、Claude Code、OpenCode、ZCode 的统一打包安装、Hook 事件与自更新验证框架"
created: 2026-08-27T09:44:54.704Z
mode: validate
must_haves:
  truths:
    - "Required smoke 从真实 tgz 安装后验证每个宿主的原生项目资产，而不是只读源码模板。"
    - "Codex、Claude Code、OpenCode、ZCode 从真实 tgz 安装的 Hook/事件处理器会被执行，成功 marker、fail-open 与更新提示均有 packaged 层证据。"
    - "后台更新刷新只通过注入的本地 fake spawn 验证，不访问 npm Registry，也不自动安装新版本。"
    - "收据只包含布尔值、枚举与摘要，不包含 MCP URL、Header、Bearer、Hook 输入或命令输出正文。"
  artifacts:
    - "src/smoke/host-smoke.cts"
    - "tests/smoke/host-smoke.test.cts"
  key_links:
    - "HostSmokeResult.runtimeContract -> required-contract PASS decision"
    - "installed host config -> packaged Hook/event invocation -> marker/update evidence"
    - "installed update-check.cjs -> injected spawn -> detached refresh receipt"
---

# Unified packaged host runtime acceptance

## Task 1: Add a failing closed receipt contract

**Files:** `tests/smoke/host-smoke.test.cts`

**Action:** Extend the required smoke expectations with one secret-safe runtime contract per host.
The contract must distinguish the packaged layer, advisory command Hooks, Cursor events, and the OpenCode project plugin,
while requiring installed assets, native event execution, successful-call marker, cached newer-version
notice, detached refresh scheduling, and fail-open behavior. Assert exact keys and fingerprints so a
static file-presence check cannot pass.

**Verify:** Build or the focused smoke test fails against the current harness because the new receipt
is absent.

**Done:** The RED failure names the missing runtime evidence rather than an unrelated fixture error.

## Task 2: Execute installed runtime contracts uniformly

**Files:** `src/smoke/host-smoke.cts`, `tests/smoke/host-smoke.test.cts`

**Action:** After installation, parse each host's actual project registration and execute the installed
event path. Codex/Claude/ZCode run their registered PreToolUse and PostToolUse handlers; Cursor runs
`postToolUse` and `afterMCPExecution`; OpenCode imports a sibling `.mjs` copy of the installed project
plugin and calls `tool.execute.after`. Seed an isolated fresh cache with a synthetic higher version,
assert host-native notice delivery, create a hashed success marker, execute malformed input to prove
fail-open, and call the installed `update-check.cjs` with an injected fake spawn to prove one detached
refresh without network access. Restore environment and temporary plugin bytes in every path.

**Verify:** Focused tests pass for all five hosts and required smoke emits a complete runtime contract
for at least Codex, Claude Code, OpenCode, and ZCode.

**Done:** Any missing registration, wrong host name, non-advisory decision, absent marker, silent update
notice, real-network attempt, or malformed-input failure makes that host FAIL.

## Task 3: Run release-proportional verification and record the contract

**Files:** `README.md`, `.planning/PROJECT.md`, quick summary/verification/state artifacts as needed.

**Action:** Document that “automatic update” means fail-open update awareness plus an explicit user-
approved `npx ... update`, never unattended self-install. Run build, focused smoke tests, generation,
pack audit, full `ci:local`, and inspect receipts for secret-safe exact shapes.

**Verify:** `npm run ci:local` and `npm run docs:check` pass after the last code change.

**Done:** The framework provides one comparable packaged install/Hook/update matrix across the requested hosts,
with Cursor retained under its honest non-PreToolUse event contract. Native host admission remains an independent
optional-live/manual UAT gate and a packaged PASS cannot satisfy it.
