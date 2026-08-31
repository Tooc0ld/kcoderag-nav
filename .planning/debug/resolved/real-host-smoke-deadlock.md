---
status: resolved
trigger: "立即修复真实宿主 smoke；Claude 使用 KSCC 验证，密钥保持本机私密投射"
created: 2026-08-31
updated: 2026-09-01
---

# Debug Session: Real Host Smoke Deadlock

## Symptoms

- expected: Codex、KSCC 与 OpenCode 在自托管 Windows Runner 的隔离项目中真实连接 localhost MCP，调用一次 `search_code`，并产生结构化事件、marker 与 receipt。
- actual: 安装、status、MCP 配置、update、uninstall 成功，但三个可执行宿主均没有产生 localhost `initialize` receipt；Codex/OpenCode 为 `evidence_incomplete`，Claude 为 `auth_missing`。
- errors: `Available real-host smoke` 显示 failure；Codex 的项目 MCP inventory 为 0；Claude 官方登录态为 false。
- timeline: 2026-08-31 首次启用 `Automated host acceptance` 后稳定复现。
- reproduction: 在 `kcoderag-live` Runner 上运行 `npm run smoke:live`。

## Current Focus

- bug_class: concurrency/deadlock plus isolated host configuration
- hypothesis: 同进程 localhost Server 被同步 `spawnSync` 阻塞；Codex 隔离配置未加载；Claude 应使用受限 KSCC settings 投射而不是 OAuth 文件。
- test: 添加异步子进程访问同进程 loopback 的回归；验证 Codex isolated config 与 KSCC allowlist projection；重跑三个真实宿主。
- expecting: Codex、KSCC、OpenCode 可执行宿主获得 MCP receipt；Cursor/ZCode 保持诚实 NOT_RUN。
- candidate_causes:
  - synchronous child process blocks the loopback server event loop
  - Codex project config is unavailable in the disposable CODEX_HOME
  - Claude OAuth credential projection is the wrong authentication source for KSCC
- and_gate: no secret values in source, logs, receipts, summaries, or committed fixtures
- next_action: implement async live process runner and bounded host configuration projection with regressions
- reasoning_checkpoint: accepted
- tdd_checkpoint: accepted

## Evidence

- timestamp: 2026-08-31
  checked: fresh single-host smoke for Codex, Claude, and OpenCode on the self-hosted runner account.
  found: all three reproduce the remote verdict; install/status/tool registration/update/uninstall succeed while initialize/list/call/marker remain false.
  implication: failure begins at native host execution, after package installation and config rendering.
- timestamp: 2026-08-31
  checked: host subprocess event summaries and an isolated MCP inventory probe.
  found: Codex exits 0 after a policy-rejected Skill read and lists zero isolated MCP servers; OpenCode emits only text events; a synchronous OpenCode MCP-list probe hangs while the parent-owned loopback server cannot service it.
  implication: the synchronous host subprocess blocks the same Node event loop that owns the MCP fixture; Codex additionally needs an explicit isolated config projection.
- timestamp: 2026-08-31
  checked: Runner authentication metadata without reading or printing secret values.
  found: Codex is logged in; Claude OAuth is logged out; KSCC is installed and its user settings contain bounded `BASE_API`, `ksccModel`, and primary `KSCC_AUTH_TOKEN` fields.
  implication: Claude live verification must invoke KSCC with a sanitized settings projection, not rely on `.credentials.json`.

## Eliminated

- hypothesis: host CLIs are missing from the Runner PATH.
  evidence: Codex 0.151.0, KSCC/Claude 2.1.241, OpenCode 1.18.23, and Cursor 3.17.8 are installed; only ZCode is absent.
  timestamp: 2026-08-31
- hypothesis: package install or generated MCP configuration fails before native execution.
  evidence: every runnable host reports install, status, toolRegistration, update, qaOnly, and uninstall true.
  timestamp: 2026-08-31

## Resolution

- root_cause: `spawnSync` blocked the parent Node event loop that owned the loopback MCP server; the normal package branch also returned an un-awaited promise from inside `try/finally`, closing the server early. Windows proxy bypass covered `localhost` but not numeric `127.0.0.1`. Codex needed its freshly installed project MCP/hooks projected into isolated `CODEX_HOME`, tool approval, and compatibility with the 0.151 MCP tool-name normalization (`kcoderag-qa` -> `kcoderag_qa`). KSCC needed its bounded settings projection, native Windows home, and an explicit target-tool allowlist.
- fix: run real hosts asynchronously with bounded output/timeout and exact process-tree cleanup; await the acquired smoke before closing the stub; bind the stub on IPv4/IPv6 loopback and advertise `localhost`; isolate Codex config/hooks and approve only the live run; accept old/new MCP marker names; invoke Claude through KSCC with only `BASE_API`, `ksccModel`, and `KSCC_AUTH_TOKEN`, while isolating Claude config/cache but preserving native home; record per-host workflow details.
- verification: `npm run smoke:live` returns Codex PASS, Claude/KSCC PASS, OpenCode PASS, and honest `NOT_RUN / headless_host_unsupported` for Cursor and ZCode. Each PASS includes initialize, tools/list, tools/call, loopback receipt, success marker, update, and uninstall. Targeted smoke, hook, generator, host, and CI-contract tests pass.
- files_changed: [`.github/workflows/acceptance.yml`, `README.md`, `plugin-src/hooks/hooks.json`, `src/hooks/mcp-call-marker.cts`, `src/hosts/zcode.cts`, `src/smoke/host-smoke.cts`, `src/smoke/stub-mcp-server.cts`, generated QA hook assets, and related tests]
