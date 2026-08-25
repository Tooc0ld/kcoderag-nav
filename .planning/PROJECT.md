# KCodeRag Nav

## What This Is

KCodeRag Nav 是 KCodeRag MCP 查询服务的 Node.js 项目集成，面向 Codex、Claude Code 与
Cursor。公共 npm CLI `kcoderag-nav` 将编译后的 CJS 运行时、导航 skill、QA MCP 配置和宿主资产
部署到明确的目标项目原生目录；它不是 marketplace plugin，也不依赖 Python、Git checkout、
Git/SVN 项目标记或运行时 TypeScript 编译。

标准入口是 `npx kcoderag-nav@latest install`。未指定宿主时交互选择 Codex、Claude Code 或
Cursor；自动化使用 `--host codex|claude|cursor`，一次调用只管理一个宿主。自 `0.2.0` 起，QA
是唯一可公开安装、更新和生成的环境；旧 QA/Dev 状态只是一次性迁移或卸载的精确解码输入，
不再构成 Dev 安装能力。同一项目中的三个宿主仍可各自拥有独立的项目级 QA 集成。

Codex 与 Claude Code 使用 advisory、fail-open 的 PreToolUse hook；Cursor 使用 always-on Rule
和共享 skill，不声称具备等价 hook 注入。安装器同时提供 `status`、`doctor`、`update` 与
`uninstall`，并以受管所有权、来源门禁、漂移硬停止和单宿主原子回滚保护项目与用户配置。

## Core Value

用户通过统一 npx CLI 即可在所选宿主和明确项目边界内获得可靠、低打扰、QA 图优先的导航体验。

## Requirements

### Validated

- ✓ 公共 `kcoderag-nav` npm CLI 提供 install/status/doctor/update/uninstall，并以根
  `package.json` 作为唯一版本源 — Phase 03.1
- ✓ TypeScript 维护源码构建为 Node.js 22+ 可直接执行的 CJS；发布包与已安装 hook 不需要
  Python、`ts-node` 或 TypeScript compiler — Phase 03.1
- ✓ Codex、Claude Code 与 Cursor adapter 分别管理宿主原生项目目录，一次命令只修改一个
  所选宿主 — Phase 03.1
- ✓ Phase 03.1 曾交付 QA 默认、Dev 显式且同 host 互斥的公共合同；该历史事实由 Phase 04
  `0.2.0` QA-only 合同明确取代，而不是重写 — Phase 03.1 / superseded in Phase 04
- ✓ Codex/Claude hook 保持 advisory/fail-open；Cursor 明确使用 Rule、skill 与 MCP 而不是
  模拟 PreToolUse hook — Phase 03.1
- ✓ install/update/uninstall 具备写前漂移校验、窄所有权、旧 Python 安装迁移与单宿主原子
  回滚；status/doctor 保持只读 — Phase 03.1
- ✓ 更新检查前台零网络、后台查询 npm Registry latest、缓存 24 小时并全异常 fail-open — Phase 03.1
- ✓ Node generator、pre-commit、pack audit、loopback smoke 与 Windows/Linux Node 22/24 CI
  验证生成确定性、自包含和三宿主契约 — Phase 03.1

### Active

- [ ] 将公共产品收敛为 QA-only，安全识别/迁移旧 Dev，稳定从项目任意子目录定位最近受管
  Hook，并以 selected-host、secret-safe 的 status/doctor 在写前治理用户级来源；发布并验证
  exact `0.2.0` 后迁移实际 Head 项目 — Phase 4 (`DEP-01`–`DEP-03`)
- [ ] 降低 fixed-string、多文件本地复核、窄目录和常见 Lua 全局处理器的 hook 误报，并按
  实际索引能力推荐检索模式 — Phase 5
- [ ] 在真实 Codex、Claude Code 与 Cursor 上用干净项目和公共 npx 包留下可复跑的生命周期、
  MCP、hook/Rule 证据 — Phase 6
- [ ] 固化 GSD Codex runtime/isolation，并缩窄全局 GSD hook 事件范围 — Phase 7
- [ ] 引入生产级身份、HTTPS、凭据轮换与宿主兼容淘汰策略 — Phase 8

### Out of Scope

- 将 Dev 作为公共、隐藏或维护者专用的可安装环境；恢复 Dev 必须作为新的产品决策重新设计
- 自动修改无受管所有权的 raw MCP、手写 Hook 或所有权不明来源；这些来源只允许诊断和人工清理
- 用一般 `--yes`、发布授权或 legacy Dev 迁移授权替代指纹绑定的用户级 owned-source 清理授权
- 修改 KCodeRag MCP 服务、解析流水线、Neo4j 数据或接口实现；本仓库只负责项目集成和导航策略
- Phase 05 的 Hook 精度、Phase 06 的真实 MCP 查询、Phase 07 的 GSD 全局 Hook、Phase 08 的
  身份/HTTPS/凭据轮换
- Codex、Claude Code 或 Cursor marketplace 分发；用户入口统一为 npm/npx 项目集成
- OpenCode adapter 与真实宿主验证；只保留可扩展 adapter 缝

## Context

- 根 `package.json`、lockfile 和 `.cts` 源码是维护入口；`dist/**/*.cjs` 与自包含 QA/Cursor
  宿主资产是 npm 用户实际运行的产品，Node built-ins 之外没有生产依赖。
- CLI 默认管理当前目录，`--target` 可显式覆盖；二者都是精确目标，不向上推断 Git/SVN 根。
  安装拒绝文件系统根、用户主目录和宿主用户级 config/plugin/cache 根。
- Codex 管理 `.codex/` 与 `.agents/skills/`；Claude Code 管理 `.claude/settings.json`、
  `.claude/skills/` 与项目根 `.mcp.json`；Cursor 管理 `.cursor/rules/`、`.cursor/skills/` 与
  `.cursor/mcp.json`。
- Codex/Claude Hook 从会话 cwd 向上寻找最近的所选宿主 `kcoderag-nav/install-state.json`。
  最近状态即边界；状态损坏、版本不兼容或 launcher 缺失时静默 fail-open，不越界使用外层项目。
- 安装状态只记录项目相对路径和摘要，因此完整项目复制、移动、改名或换盘后仍可工作。
- `status` 快速报告项目健康与来源冲突摘要；`doctor` 深入扫描所选宿主的用户级来源。
  install/update 自行执行同一完整来源门禁，uninstall 仅受项目自身漂移约束。
- 真实三宿主 MCP/UI 证据仍留在 Phase 6；Phase 04 只接受自动化合同、公开制品和 Head 部署证据。

## Constraints

- **运行时**: 用户路径最低 Node.js 22；维护源码编译为 CJS，不允许 Python 或运行时 TypeScript 编译
- **分发**: 用户安装、更新与卸载统一通过 `npx kcoderag-nav@latest`；`0.2.0` 起公开产品 QA-only
- **宿主边界**: 一次命令只管理和扫描 Codex、Claude Code 或 Cursor 中的一个；跨宿主项目 QA 可共存
- **旧状态**: Dev 仅能由精确 schema、完整所有权和摘要校验的 legacy 解码器读取，用于显式迁移/卸载
- **项目边界**: 默认只修改明确目标内由 adapter 声明的文件/section，不污染用户配置、无关项目或其他宿主
- **所有权**: update/uninstall 遇到漂移、symlink、特殊文件或模糊所有权必须写前硬停止并保持原子回滚
- **来源清理**: 只允许对冻结来源计划的精确 fingerprint 单独授权并调用宿主原生卸载；raw/manual/ambiguous 来源不得自动修改
- **Hook**: Codex/Claude 仅提供 advisory context，向上查找和运行异常全部 fail-open，不阻断本地工具
- **Cursor**: 使用 Rule、skill 与 MCP，不声称具备等价的 PreToolUse hook 行为
- **诊断**: `status`/`doctor` 只读且 JSON 单文档；只输出稳定码、scope、source type 和安全路径，不读取或显示凭据值
- **发布**: `0.2.0` 仅在实现、测试、审查、四通道 CI、pack/public artifact 全通过后自动发布；发布后不可变，失败只以 `0.2.1` 修复前进
- **体验指南所有权**: `MCP_QA_EXPERIENCE_GUIDE.md` 由 KCodeRag 服务仓库独占维护，本仓库不保留副本
- **凭据**: 当前内部 QA 阶段允许装即用的内置 Bearer；生产身份与轮换留给 Phase 08
- **OpenCode**: 仅保留 adapter 扩展能力；实现与真实宿主验证延后
- **变更保护**: 不覆盖或回退工作区中的无关未提交工作

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| **D-01 / D-02**：`0.2.0` 公共 CLI、npm 制品、生成资产和用户文档 QA-only；Dev 仅为严格 legacy 解码输入 | 普通用户只有一条明确安装路径，同时保留无漂移旧状态的一次性迁移/卸载能力 | Locked for Phase 04 |
| **D-03**：owned user source 清理必须有独立、精确 fingerprint 绑定的明确授权；自动化使用独立 exact authority | 防止一般确认、发布决定或 Dev 迁移许可被扩大为用户级删除权 | Locked for Phase 04 |
| **D-04**：全部门禁通过后直接发布 `0.2.0`，无需再次人工发布审批 | 本次讨论已给出不可逆发布决定，同时保留机器门禁 | Authorized |
| **D-05–D-08**：Hook 采用最近状态向上查找、损坏边界不穿透、相对状态可移动，安装目标拒绝全局危险根但不要求 VCS | 同时解决深层 cwd、嵌套项目、项目移动和 project-only 安全 | Locked for Phase 04 |
| **D-09–D-12**：selected-host 来源分级；active 来源阻断写入、owned legacy 可确认清理、残留仅 doctor 提示；uninstall 仍可减少来源 | 写前阻止重复生效，同时不让无关宿主或无害 cache 阻断用户 | Locked for Phase 04 |
| **D-13–D-16**：status 快速、doctor 深扫；`source_conflict` 为独立不健康状态，未安装项目仍可运行 doctor | 诊断可预测、只读、适用于安装前且不依赖用户先跑 doctor | Locked for Phase 04 |
| **D-17–D-19**：公开 exact `0.2.0` 按 doctor→授权清理→update/migrate→status/doctor 部署 Head，并验证根/深层 Hook 与无关配置不变 | 本地 pack 或 latest 不能冒充真实公开安装证据 | Locked acceptance |
| **D-20**：发布后 Head 迁移失败保持 npm/tag/latest 不变并回滚项目事务，以 `0.2.1` 修复前进 | 维护不可变发布身份，避免 unpublish/dist-tag 回退造成更大漂移 | Locked recovery |

## Evolution

This document evolves at phase transitions and milestone boundaries. Phase 1–3/03.1 的 QA/Dev 记录
保持历史事实；Phase 04 明确以 `0.2.0` QA-only 合同覆盖其当前产品效力。

---
*Last updated: 2026-08-25 for the Phase 04 QA-only deployment contract*
