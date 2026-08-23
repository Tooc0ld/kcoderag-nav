---
gsd_state_version: 1.0
current_phase: 03.1
current_phase_name: JavaScript 与 npx 安装运行时迁移
status: executing
stopped_at: Completed 03.1-03-PLAN.md
last_updated: "2026-08-23T14:21:58.604Z"
last_activity: 2026-08-23
last_activity_desc: Phase 03.1 execution started
state_head: a9e1fe8e2dcb0b2e81656bfa17ef128d482cd1e6
progress:
  total_phases: 9
  completed_phases: 3
  total_plans: 30
  completed_plans: 7
  percent: 23
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-20)

**Core value:** 用户安装任一环境插件后即可获得可靠、低打扰、环境选择明确的 KCodeRag 图优先导航体验。
**Current focus:** Phase 03.1 — JavaScript 与 npx 安装运行时迁移

## Current Position

Phase: 03.1 (JavaScript 与 npx 安装运行时迁移) — EXECUTING
Plan: 5 of 27
Status: Ready to execute
Last activity: 2026-08-23 — Phase 03.1 execution started

Progress: [██░░░░░░░░] 23%

## Performance Metrics

**Velocity:**

- Total plans completed: 3
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 1 | - | - |
| 2 | 1 | - | - |
| 3 | 1 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 03.1 P29 | 2 min | 2 tasks | 1 files |
| Phase 03.1 P01 | 19min | 3 tasks | 9 files |
| Phase 03.1 P02 | 12min | 2 tasks | 6 files |
| Phase 03.1 P03 | 12min | 2 tasks | 7 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table. Recent decisions affecting current work:

- [Phase 1]: 一份规范源生成两个自包含环境包；只读检查负责发现产物漂移。
- [Phase 2]: 默认项目级安装仅管理目标仓库的 `.codex/` 与 `.agents/`；QA 默认，QA/Dev 互斥，切换前必须显式卸载。
- [Phase 3]: 单环境只查询已安装环境；环境不可达时明确报告，索引不可用或陈旧时允许本地 fallback；导航 nudge 不创建跨环境所有权 marker，异步更新检查可使用有界、fail-open 的 cache/session marker。
- [Cursor]: 只发布一个可配置环境的 `kcoderag-nav`，使用单 MCP server、共享 skill 与 always-on Rule；默认通过免费 local 目录安装器分发，付费 Team Marketplace 仅为可选路径。
- [Reconciliation]: Phase 1–3 已根据 quick task 实现、当前代码与自动化测试回溯生成 canonical plan/summary/verification/validation，并于 2026-08-23 正式完成；后续强化项留在 Phase 4–8。
- [Phase 4]: 先更新真实 Head QA、修复子目录 hook 根路径，再扩展 user-level doctor；不得用自动卸载掩盖错误来源。
- [Phase 5]: fixed-string、本地复核、窄目录与常见 Lua 全局处理器应静默；semantic/hybrid 只能按实际索引能力推荐。
- [Phase 6]: loopback CI 不等于真实宿主 PASS；Codex、Claude Code 与 Cursor 必须分别留下可复跑证据。
- [Phase 7]: KCodeRag hook 与全局 GSD hook 分属不同所有者；GSD runtime 修复需要持久化或上游化。
- [Phase 8]: 内部内置凭据风险继续被接受到生产安全阶段，不提前声称已解决。
- [Phase 03.1]: Node dependency and build outputs use only exact root-anchored ignore rules. — This keeps npm/build artifacts out of Git without hiding nested paths, product packages, source, tests, planning, or unrelated work.
- [Phase 03.1]: Accepted the exact audited TypeScript 6.0.3, @types/node 22.20.1, and undici-types 6.21.0 graph; any graph, integrity, ownership, or lifecycle drift requires re-audit.
- [Phase 03.1]: Confirmed the public unscoped kcoderag-nav package and npx kcoderag-nav@latest install command.
- [Phase 03.1]: Codex QA installation uses full preflight/staging, state-last replacement, and complete rollback with secret-safe output.
- [Phase 03.1]: Clean CI builds compiled CJS before audit/tests and discovers compiled tests with an explicit glob.
- [Phase 03.1]: Host adapters declare managed roots and create validated desired state; only applyTransaction mutates installation files.
- [Phase 03.1]: Rollback failure retains a private project-local recovery tree while diagnostics expose only its safe relative path.
- [Phase 03.1]: Phase 03.1 Plan 03 preserves the Python hook heuristic exactly in TypeScript/CJS; precision policy remains deferred to Phase 5.
- [Phase 03.1]: Windows combines the Node 22 probe and hook invocation in one process so cmd.exe cannot consume redirected hook stdin before main runs.
- [Phase 03.1]: Legacy Python generation defers only within the ordered CJS launcher migration and still hard-gates unrelated canonical or partial-staging changes.

### Pending Todos

- 更新 `I:\JX3_SVN\Head` 的项目级 QA，并在新 Codex 任务中确认状态健康。
- 在 Phase 5 规划前用 `list_indexes` 复核 QA 当前 semantic/hybrid 实际能力。

### Blockers/Concerns

- Phase 1–3 是基于当前代码、quick history 与测试的回溯完成记录；实现提交仍保留在 quick task 历史中。
- Head 当前项目级 QA 为 `update_available`，差异位于受管 `grep_nudge.py`；全局 QA/Dev 重复来源未检出。
- Head hook launcher 当前仍使用相对 `.codex/...` 路径，从嵌套子目录启动的稳定性尚未保证。
- required CI 只证明 loopback/offline 契约；authenticated real-host smoke 尚未运行。
- GSD runtime 本地补丁当前解析正确，但 GSD 更新可能覆盖，且全局 context monitor 仍注册过宽。
- 当前内置 Bearer 仅接受于内部 QA/Dev 阶段；不得在日志、测试输出或文档中泄露其值。
- Cursor 扩大到公开分发前应移除内置 Bearer 默认值；当前免费 local 安装仅面向内部 QA/Dev，Cloud Agent 仍需单独确认内部网络可达性。

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260820-nhw | QA/Dev 规范源、生成式独立产物、项目级安装生命周期、QA 优先路由、hook 去重与 E2E | 2026-08-20 | fd40d70 | [260820-nhw-kcoderag-nav-qa-dev-qa-dev-qa-hook-e2e](./quick/260820-nhw-kcoderag-nav-qa-dev-qa-dev-qa-hook-e2e/) |
| 260820-p1v | 将 QA/Dev 项目级插件迁移到 kcoderag-nav，并让 KCodeRag 仅保留 QA/Dev MCP 配置 | 2026-08-20 | local-only | [260820-p1v-qa-dev-kcoderag-nav-kcoderag-qa-dev-mcp](./quick/260820-p1v-qa-dev-kcoderag-nav-kcoderag-qa-dev-mcp/) |
| 260820-t66 | Fix installer ownership and cross-host versioning | 2026-08-20 | 0b478fc | [260820-t66-fix-installer-ownership-and-cross-host-v](./quick/260820-t66-fix-installer-ownership-and-cross-host-v/) |
| 260820-thb | Python 3.10+ fail-open runtime、只读 status、stub MCP 双宿主 smoke CI 与 QA 指南 | 2026-08-20 | 4104675 | [260820-thb-python-3-10-hook-fail-open-claude-code-c](./quick/260820-thb-python-3-10-hook-fail-open-claude-code-c/) |
| 260820-umj | 修复管道和复合命令的 scope 误判，补回归测试，并适度缩短 nudge | 2026-08-20 | 9c97596 | [260820-umj-scope-nudge](./quick/260820-umj-scope-nudge/) |
| 260820-vuc | QA/Dev 互斥安装，移除双环境 routing 与跨进程 hook 去重 | 2026-08-20 | 1119e67 | [260820-vuc-make-qa-and-dev-installations-mutually-e](./quick/260820-vuc-make-qa-and-dev-installations-mutually-e/) |
| 260820-wwm | 单环境 Cursor 私有插件、共享 skill、always-on Rule 与 Team Marketplace 分发 | 2026-08-20 | 76fe0e1, 55291ad | [260820-wwm-add-private-cursor-plugin-distribution-w](./quick/260820-wwm-add-private-cursor-plugin-distribution-w/) |
| 260820-w7c | QA/Dev 首次 PreToolUse 延迟更新感知、确定性版本与显式更新命令 | 2026-08-20 | 8cf74e0 | [260820-w7c-add-lazy-first-pretooluse-update-detecti](./quick/260820-w7c-add-lazy-first-pretooluse-update-detecti/) |
| 260821-07f | 将 QA/Dev/Cursor 插件基础版本升至 0.1.2 并发布本地累积改动 | 2026-08-21 | 8774487 | [260821-07f-bump-plugin-base-version-from-0-1-1-to-0](./quick/260821-07f-bump-plugin-base-version-from-0-1-1-to-0/) |
| 260821-0nj | 记录 Cursor Team Marketplace Auto Refresh、手动 Refresh 与本地同步更新路径 | 2026-08-21 | d147f66 | [260821-0nj-document-cursor-team-marketplace-auto-re](./quick/260821-0nj-document-cursor-team-marketplace-auto-re/) |
| 260821-0r6 | 将 Cursor 更新说明同步到 QA 体验指南，并建立同次更新约束 | 2026-08-21 | d711b1a | [260821-0r6-synchronize-cursor-update-guidance-into-](./quick/260821-0r6-synchronize-cursor-update-guidance-into-/) |
| 260821-dlq | 将首次 PreToolUse 更新检查改为后台异步刷新 | 2026-08-21 | 1b30aae, be7994c | [260821-dlq-make-the-kcoderag-first-pretooluse-updat](./quick/260821-dlq-make-the-kcoderag-first-pretooluse-updat/) |
| 260821-ebz | 安全地在 pre-commit 生成 QA/Dev/Cursor 包并拒绝错配暂存 | 2026-08-21 | bbe8810, 57ac336 | [260821-ebz-add-a-safe-repository-pre-commit-hook-th](./quick/260821-ebz-add-a-safe-repository-pre-commit-hook-th/) |
| 260821-eku | 删除本仓库指南副本，并在 KCodeRag 权威指南补齐 Cursor 接入与当前更新流程 | 2026-08-21 | e05aaa5 | [260821-eku-document-the-complete-cursor-onboarding-](./quick/260821-eku-document-the-complete-cursor-onboarding-/) |
| 260821-flg | 为免费 Cursor 用户增加 local 插件 install/status/update/uninstall，并更新权威指南 | 2026-08-21 | b284819 | [260821-flg-add-a-free-cursor-local-plugin-installer](./quick/260821-flg-add-a-free-cursor-local-plugin-installer/) |
| 260821-g07 | 将 QA/Dev/Cursor 基础版本升级到 0.1.3，验证并推送累计本地改动 | 2026-08-21 | 71f6778 | [260821-g07-bump-plugin-base-version-to-0-1-3-regene](./quick/260821-g07-bump-plugin-base-version-to-0-1-3-regene/) |
| 260821-kqa | 修复 Codex bundled MCP direct map，硬停止重复来源，并发布 QA/Dev/Cursor 0.1.4 | 2026-08-21 | 1602284 | [260821-kqa-fix-codex-bundled-mcp-compatibility-with](./quick/260821-kqa-fix-codex-bundled-mcp-compatibility-with/) |

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Security | 个人/组织身份、HTTPS 与凭据轮换 | Scheduled in Phase 8 (SEC-01 to SEC-03) | 2026-08-23 |
| Release | CI 发布自动化与宿主版本兼容矩阵 | Scheduled in Phase 8 (REL-01 to REL-02) | 2026-08-23 |

### Roadmap Evolution

- Phase 03.1 inserted after Phase 3: JavaScript 与 npx 安装运行时迁移 (URGENT)
- Phase 4 added: 已部署项目与安装来源可靠性。
- Phase 5 added: 低误报 Hook 与诚实路由。
- Phase 6 added: 真实宿主兼容与发布证据。
- Phase 7 added: GSD 运行时与全局 Hook 整理。
- Phase 8 added: 生产安全与自动化发布。
- Phase 1–3 completed retrospectively with canonical plan, summary, verification, and validation artifacts on 2026-08-23.

## Session Continuity

Last session: 2026-08-23T14:21:58.449Z
Stopped at: Completed 03.1-03-PLAN.md
Resume file: None
