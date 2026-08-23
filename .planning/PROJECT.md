# KCodeRag Nav

## What This Is

KCodeRag Nav 是 KCodeRag MCP 查询服务的 Node.js 项目集成，面向 Codex、Claude Code 与
Cursor。公共 npm CLI `kcoderag-nav` 负责将编译后的 CJS 运行时、导航 skill、MCP 配置以及
宿主适配资产安装到目标项目的原生目录；它不是 marketplace plugin，也不依赖用户机器上的
Python、Git checkout 或运行时 TypeScript 编译。

标准入口是 `npx kcoderag-nav@latest install`。未指定宿主时交互选择 Codex、Claude Code 或
Cursor；自动化使用 `--host codex|claude|cursor`，一次调用只管理一个宿主。普通用户默认 QA，
Dev 仅供开发和测试并需显式选择；QA/Dev 在同一宿主内互斥且切换前必须显式卸载，三个宿主
之间的受管安装可以在同一项目中共存。

Codex 与 Claude Code 使用 advisory、fail-open 的 PreToolUse hook；Cursor 使用 always-on Rule
和共享 skill，不声称具备等价 hook 注入。安装器同时提供 status、doctor、update 与 uninstall，
并以受管所有权、漂移硬停止和单宿主原子回滚保护项目中的无关配置。

## Core Value

用户通过统一 npx CLI 即可为所选宿主获得可靠、低打扰、环境选择明确的 KCodeRag 图优先导航体验。

## Requirements

### Validated

- ✓ 公共 `kcoderag-nav` npm CLI 提供 install/status/doctor/update/uninstall，并以根
  `package.json` 作为唯一版本源 — Phase 03.1
- ✓ TypeScript 维护源码构建为 Node.js 22+ 可直接执行的 CJS；发布包与已安装 hook 不需要
  Python、`ts-node` 或 TypeScript compiler — Phase 03.1
- ✓ Codex、Claude Code 与 Cursor adapter 分别管理宿主原生项目目录，一次命令只修改一个
  所选宿主 — Phase 03.1
- ✓ QA 为默认环境，Dev 必须显式选择；QA/Dev 同 host 互斥，跨 host 安装可以共存 — Phase 03.1
- ✓ Codex/Claude hook 保持 advisory/fail-open；Cursor 明确使用 Rule、skill 与 MCP 而不是
  模拟 PreToolUse hook — Phase 03.1
- ✓ install/update/uninstall 具备写前漂移校验、窄所有权、旧 Python 安装迁移与单宿主原子
  回滚；status/doctor 保持只读 — Phase 03.1
- ✓ 更新检查前台零网络、后台查询 npm Registry latest、缓存 24 小时并全异常 fail-open — Phase 03.1
- ✓ Node generator、pre-commit、pack audit、loopback smoke 与 Windows/Linux Node 22/24 CI
  验证生成确定性、自包含和三宿主契约 — Phase 03.1

### Active

- [ ] 更新实际 Head 项目的受管 QA，稳定从嵌套目录启动的 hook 根路径，并在写前诊断用户级
  重复来源 — Phase 4
- [ ] 降低 fixed-string、多文件本地复核、窄目录和常见 Lua 全局处理器的 hook 误报，并按
  实际索引能力推荐检索模式 — Phase 5
- [ ] 在真实 Codex、Claude Code 与 Cursor 上用干净项目和公共 npx 包留下可复跑的生命周期、
  MCP、hook/Rule 证据 — Phase 6
- [ ] 固化 GSD Codex runtime/isolation，并缩窄全局 GSD hook 事件范围 — Phase 7
- [ ] 引入生产级身份、HTTPS、凭据轮换与可重复的公开 npm 发布证据 — Phase 8

### Out of Scope

- 同一宿主内同时启用 QA 与 Dev — 两个环境采用 host-local 互斥安装模式
- 安装 QA 时自动卸载 Dev，或安装 Dev 时自动卸载 QA — 切换必须由用户显式卸载，避免隐式删除
- 生产级凭据分发、用户级 OAuth、HTTPS 和令牌轮换 — 当前仅服务内部 QA/Dev，后续里程碑再治理
- 修改 KCodeRag MCP 服务、解析流水线、Neo4j 数据或接口实现 — 本仓库只负责插件分发和导航策略
- 让 Dev 成为普通用户的隐式回退 — 环境不可达必须明确报告，不能静默换环境
- Codex、Claude Code 或 Cursor marketplace 分发 — 当前用户入口统一为 npm/npx 项目集成
- OpenCode adapter 与真实宿主验证 — host adapter 保留扩展缝，但本阶段不交付 OpenCode

## Context

- 根 `package.json`、lockfile 和 `.cts` 源码是维护入口；`dist/**/*.cjs` 与自包含宿主资产是
  npm 用户实际运行的产品，Node built-ins 之外没有生产依赖。
- CLI 默认管理当前目录，`--target` 可显式覆盖；它不向上寻找 Git/SVN 根，也不修改用户级
  插件缓存或另一个宿主的安装。
- Codex 管理 `.codex/` 与 `.agents/skills/`；Claude Code 管理 `.claude/settings.json`、
  `.claude/skills/` 与项目根 `.mcp.json`；Cursor 管理 `.cursor/rules/`、`.cursor/skills/` 与
  `.cursor/mcp.json`。
- 生成资产仍保留 QA/Dev/Cursor compatibility manifest，但根 marketplace catalog 已退役；
  manifest 只服务自包含资产与版本一致性，不是用户安装入口。
- Hook 保留复合 shell、Grep/Glob/Bash、输入长度和本地机械搜索例外等行为基线；精度优化留在
  Phase 5。Cursor 因宿主能力差异使用 Rule，不伪造 hook 事件。
- 真实三宿主 UI/runtime 证据仍留在 Phase 6；本阶段 required smoke 是打包后 loopback 契约，
  不把 stub 结果冒充 authenticated host PASS。

## Constraints

- **运行时**: 用户路径最低 Node.js 22；维护源码编译为 CJS，不允许 Python 或运行时 TypeScript 编译
- **分发**: 用户安装、更新与卸载统一通过 `npx kcoderag-nav@latest`，根 marketplace catalog 不得恢复
- **宿主边界**: 一次命令只管理 Codex、Claude Code 或 Cursor 中的一个；跨宿主安装可以共存
- **环境互斥**: QA/Dev 仅在同一宿主内互斥 — 默认 QA，Dev 需显式选择，切换前显式卸载
- **项目边界**: 默认只修改目标项目内由 adapter 声明的文件/section，不污染用户配置、无关项目或其他宿主
- **所有权**: update/uninstall 遇到漂移、symlink、特殊文件或模糊所有权必须写前硬停止并保持原子回滚
- **Hook**: Codex/Claude 仅提供 advisory context，所有异常 fail-open，不阻断 `grep`、`glob` 或 shell
- **Cursor**: 使用 Rule、skill 与 MCP，不声称具备等价的 PreToolUse hook 行为
- **体验指南所有权**: `MCP_QA_EXPERIENCE_GUIDE.md` 由 KCodeRag 服务仓库独占维护，本仓库不保留副本；影响安装、卸载、更新、发布、宿主兼容、路由或 hook 的变更需同步到该权威文档
- **凭据**: 当前 QA/Dev 阶段允许装即用的内置 Bearer — 明确接受内部测试阶段风险
- **OpenCode**: 仅保留 adapter 扩展能力；实现与真实宿主验证延后
- **变更保护**: 仓库已有未提交修改，初始化和后续实现不得覆盖或回退无关工作

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 公共 `kcoderag-nav` npm CLI 是唯一用户入口 | 一个命令向三个宿主原生项目目录部署，避免 clone/Python/marketplace 分叉 | ✓ Phase 03.1 |
| TypeScript 维护、CJS 运行、Node.js 22+ | 用户机器无需编译器或 Python，Windows/Linux 使用同一运行时契约 | ✓ Phase 03.1 |
| 一次调用只管理一个宿主 | 防止一个命令意外改动同项目中的其他代理配置 | ✓ Phase 03.1 |
| QA 默认、Dev 显式且同 host 互斥 | 普通使用保持明确环境，切换不会隐式删除 | ✓ Phase 03.1 |
| 跨 host 安装允许共存 | Codex、Claude Code 与 Cursor 各自拥有窄且独立的项目边界 | ✓ Phase 03.1 |
| Adapter 只 render，transaction 统一写入 | 写前验证、state-last commit 与完整 rollback 保持宿主无关 | ✓ Phase 03.1 |
| Cursor 以 Rule 替代查找 hook | Cursor 不支持等价 advisory 注入，Rule/skill/MCP 是诚实能力边界 | ✓ Phase 03.1 |
| 更新检查前台零网络、后台查 npm latest | 第一次工具调用不受网络延迟影响，缓存和异常全部 fail-open | ✓ Phase 03.1 |
| 当前继续内置 Bearer | 内部 QA/Dev 阶段接受装即用风险，生产身份治理留到 Phase 8 | Accepted risk |
| OpenCode 延后 | 先稳定三宿主公共契约，后续只需增加 adapter 和真实宿主证据 | Deferred |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition**:
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone**:
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-24 after the Node.js/npx project-integration migration*
