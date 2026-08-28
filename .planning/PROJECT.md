# KCodeRag Nav

## What This Is

KCodeRag Nav 是面向 Codex、Claude Code、Cursor、OpenCode 与 ZCode 的 Node.js 项目级 capability
安装平台。公共 npm CLI `kcoderag-nav` 将编译后的 CJS 运行时、内置 capability、QA MCP 配置和
宿主资产部署到明确目标项目的原生目录；它不是 marketplace plugin，也不依赖 Python、Git
checkout、Git/SVN 项目标记或运行时 TypeScript 编译。

标准入口是 `npx kcoderag-nav@latest install`。未指定宿主时交互选择 Codex、Claude Code、
Cursor、OpenCode 或 ZCode；自动化使用 `--host codex|claude|cursor|opencode|zcode`，一次调用只管理一个宿主。
平台只提供两个内置 capability：`kcoderag-navigation` 与 `code-style-nudge`。install 将显式选择
加入已安装集合，同一项目中的五个宿主仍可各自拥有独立的 capability 集合。

Codex、Claude Code 与 ZCode 使用 advisory、fail-open 的 PreToolUse hook；Cursor 使用 always-on Rule
和共享 skill，OpenCode 使用项目 plugin；ZCode 同时使用项目 `.zcode/config.json` MCP 与 workspace Skill。
五个宿主以各自原生成功后事件记录 secret-free、fail-open 的 KCodeRag 调用 marker；ZCode 通过
项目 `PostToolUse` 记录并通过 `PreToolUse` 提供离线更新提示。只有冻结 PASS
receipt 对应的 Claude Code `2.1.241` 可以安装代码规范写前提示；其他四宿主保持 navigation-only。
安装器同时提供 `status`、`doctor`、`update` 与 `uninstall`，并以 capability-scoped 所有权、
全部变更命令的来源门禁、完整摘要硬停止和单宿主原子回滚保护项目与用户配置。

## Core Value

用户通过统一 npx CLI 即可在所选宿主和明确项目边界内组合可靠、低打扰的 QA 图优先导航与
证据支持的代码规范写前提示。

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
- ✓ Phase 03.1 曾具备旧 Python 安装迁移；该历史路径已经由 Phase 04.1 当前 schema 直接拒绝策略
  取代。当前 install/update/uninstall 保留写前漂移校验、窄所有权和单宿主原子回滚 — historical
  Phase 03.1 / superseded in Phase 04.1
- ✓ 更新检查前台零网络、后台查询 npm Registry latest、缓存 24 小时并全异常 fail-open — Phase 03.1
- ✓ Node generator、pre-commit、pack audit、loopback smoke 与 Windows/Linux Node 22/24 CI
  验证生成确定性、自包含和三宿主契约 — Phase 03.1
- ✓ Phase 04 曾交付 QA-only 与旧 Dev 严格迁移/卸载解码；该 legacy authority 已由 Phase 04.1
  删除。其最近受管状态、三宿主来源诊断与真实 Head 0.2.2 验收仍是历史证据 — historical Phase 04 /
  superseded in Phase 04.1
- ✓ OpenCode 项目级 adapter 支持 JSON/JSONC 生命周期，四宿主成功调用事件统一写入 secret-free
  marker；OpenCode `1.18.23` 真机与公开制品证据仍留给 Phase 6 — Quick 260826-dut
- ✓ ZCode 项目级 adapter 支持 `.zcode/config.json` MCP 与 `.zcode/skills/` lifecycle；早期基于错误
  宿主假设未投影 Hook 的边界已由 Quick 260827-nuo 取代 — Quick 260827-fch / superseded
- ✓ ZCode 项目 `hooks.events` 投影 advisory/fail-open `PreToolUse`、成功调用 `PostToolUse` marker 与
  离线更新提示，并保持代码规范能力 unsupported；packaged handler contract 已通过，但真宿主还要求用户批准
  workspace Hook — Quick 260827-nuo / Quick 260827-onf
- ✓ 两个内置 capability 使用 current schema v1、contributor-scoped 文件/section 与 composite
  digest 原子组合；旧环境状态无迁移、接管或清理权 — Phase 04.1
- ✓ `kcoderag-navigation` 支持五宿主；`code-style-nudge` 仅 Claude Code `2.1.241` 的冻结 PASS
  receipt 可用，其他宿主零写拒绝且保留 navigation — Phase 04.1 / Quick 260827-fch
- ✓ install/update/uninstall 全部在 render/transaction 前执行 manual/active source gate；status/doctor
  只读，CLI 不提供来源清理或 marker 清理命令 — Phase 04.1

### Active

- [ ] 降低 fixed-string、多文件本地复核、窄目录和常见 Lua 全局处理器的 hook 误报，并按
  实际索引能力推荐检索模式 — Phase 5
- [ ] 在真实 Codex、Claude Code 与 Cursor 上用干净项目和公共 npx 包留下可复跑的生命周期、
  MCP、hook/Rule 证据，并关闭 live QA 旧 protocol/content-only 部署漂移 — Phase 6
- [ ] 在 OpenCode `1.18.23` 上完成公共制品的项目安装、MCP、`tool.execute.after` 与卸载真机证据 — Phase 6
- [ ] 在 ZCode 上完成公共制品的项目安装、MCP、Skill、Pre/Post Hook 与卸载真机证据，并冻结受支持版本；
  当前真机已证明 MCP/Skill，但工作区 Hook 未获 trust/admission，未出现动态提示或 marker — Phase 6
- [ ] 固化 GSD Codex runtime/isolation，并缩窄全局 GSD hook 事件范围 — Phase 7
- [ ] 引入生产级身份、HTTPS、凭据轮换与宿主兼容淘汰策略 — Phase 8

### Out of Scope

- 将 Dev 作为公共、隐藏或维护者专用的可安装环境；恢复 Dev 必须作为新的产品决策重新设计
- 迁移、接管或自动清理任何旧状态、raw MCP、手写 Hook、manual Rule/plugin 或所有权不明来源；
  这些来源只允许 secret-safe 诊断，用户在 CLI 外人工处理后重试
- 恢复旧环境 decoder、legacy authority、owned-source cleanup flag、自动 scanner 或第六个公共命令
- 修改 KCodeRag MCP 服务、解析流水线、Neo4j 数据或接口实现；本仓库只负责项目集成和导航策略
- Phase 05 的 Hook 精度、Phase 06 的真实 MCP 查询、Phase 07 的 GSD 全局 Hook、Phase 08 的
  身份/HTTPS/凭据轮换
- Codex、Claude Code、Cursor、OpenCode 或 ZCode marketplace/plugin 分发；用户入口统一为 npm/npx 项目集成

## Context

- 根 `package.json`、lockfile 和 `.cts` 源码是维护入口；`dist/**/*.cjs` 与自包含 QA/Cursor
  宿主资产是 npm 用户实际运行的产品，Node built-ins 之外没有生产依赖。
- CLI 默认管理当前目录，`--target` 可显式覆盖；二者都是精确目标，不向上推断 Git/SVN 根。
  安装拒绝文件系统根、用户主目录和宿主用户级 config/plugin/cache 根。
- Codex 管理 `.codex/` 与 `.agents/skills/`；Claude Code 管理 `.claude/settings.json`、
  `.claude/skills/` 与项目根 `.mcp.json`；Cursor 管理 `.cursor/rules/`、`.cursor/skills/` 与
  `.cursor/mcp.json`/`.cursor/hooks.json`；OpenCode 管理一个项目根 config、`.opencode/plugins/`
  与 `.opencode/skills/`；ZCode 管理 `.zcode/config.json`、`.zcode/skills/`、项目 Hook 运行时与自己的受管状态。
- Codex/Claude Hook 从会话 cwd 向上寻找最近的所选宿主 `kcoderag-nav/install-state.json`。
  最近状态即边界；只有 exact current schema、composite digest、capability contributor 清单和每个
  受管文件摘要都完整时才运行，任何损坏均静默 fail-open且不越界使用外层项目。
- 安装状态只记录项目相对路径、capability ownership 和摘要，因此完整项目复制、移动、改名或
  换盘后仍可工作。
- `status` 快速报告项目健康与来源冲突摘要；`doctor` 深入扫描所选宿主的用户级来源。
  install/update/uninstall 自行执行同一完整来源门禁；任何 manual/active/ambiguous 来源都在首次
  写入前硬停止。
- Phase 04 已完成真实 Head 三宿主项目状态与 Hook/Rule 边界验收；干净宿主、authenticated MCP
  工具注册/UI 和 live QA protocol 结构证据仍留在 Phase 6。

## Constraints

- **运行时**: 用户路径最低 Node.js 22；维护源码编译为 CJS，不允许 Python 或运行时 TypeScript 编译
- **分发**: 用户安装、更新与卸载统一通过 `npx kcoderag-nav@latest`；只提供两个包内内置 capability
- **宿主边界**: 一次命令只管理和扫描 Codex、Claude Code、Cursor、OpenCode 或 ZCode 中的一个；跨宿主项目 QA 可共存
- **状态**: 只接受 current capability-scoped schema v1、完整 contributor/section inventory 和 composite digest；旧 schema 是无迁移入口的无效输入
- **项目边界**: 默认只修改明确目标内由 adapter 声明的文件/section，不污染用户配置、无关项目或其他宿主
- **所有权**: update/uninstall 遇到漂移、symlink、特殊文件或模糊所有权必须写前硬停止并保持原子回滚
- **来源**: install/update/uninstall 全部对 raw/manual/ambiguous/旧来源写前硬停止；CLI 不提供迁移、接管或自动清理权
- **生命周期**: install 使用 `installed ∪ selected`；update 默认全部已安装能力并可筛选；uninstall 必须显式选择 capability 或 `--all`
- **支持证据**: navigation 独立支持五宿主；统一 smoke 的 `runtimeContract.layer: packaged` 只证明实际 tgz
  安装后的处理器合同，不证明真宿主接纳；ZCode 真机 MCP/Skill 已工作但 Hook trust/admission 尚未通过，
  版本仍待 Phase 6 冻结；代码规范能力仅冻结 Claude Code `2.1.241` PASS row，其他宿主均 unsupported
- **代码规范 marker**: 重置一次性提示只能在关闭所有相关宿主会话后人工删除 OS cache 的 `kcoderag-nav/nudges`；status/doctor 只读，清理错误 fail-open
- **Hook**: Codex/Claude/ZCode 仅提供 advisory context，定位和运行异常全部 fail-open，不阻断本地工具
- **Cursor**: 使用 Rule、skill 与 MCP，不声称具备等价的 PreToolUse hook 行为
- **成功调用记录**: Codex/Claude/ZCode 使用 `PostToolUse`，Cursor 使用 `afterMCPExecution`，OpenCode
  使用 `tool.execute.after`；全部 secret-free、有界且 fail-open
- **诊断**: `status`/`doctor` 只读且 JSON 单文档；只输出稳定码、scope、source type 和安全路径，不读取或显示凭据值
- **发布**: `0.2.0` 仅在实现、测试、审查、四通道 CI、pack/public artifact 全通过后自动发布；发布后不可变，真实缺陷只以前进版本修复，本阶段接受版本为 `0.2.2`
- **体验指南所有权**: Phase 04.2 起由本仓库独占维护 `docs/MCP_QA_EXPERIENCE_GUIDE.md`；兄弟 KCodeRag 仓库中的旧指南只作为一次性只读迁入来源，后续不再修改、同步或绑定其摘要
- **凭据**: 当前内部 QA 阶段允许装即用的内置 Bearer；生产身份与轮换留给 Phase 08
- **OpenCode**: 仅项目级安装；同时存在 `opencode.json`/`opencode.jsonc` 时硬停止；真机基线为 `1.18.23`
- **ZCode**: 仅项目级安装；管理 `.zcode/config.json` 中 `mcp.servers`/`hooks.events`、`.zcode/skills/`
  与项目 Hook 运行时；首次加载必须由用户批准 workspace Hook，CLI 不预授权 user trust；PreToolUse 仅
  advisory，PostToolUse 仅记录成功 marker，不声称代码规范 pre-write；
  真机基线待 Phase 6
- **变更保护**: 不覆盖或回退工作区中的无关未提交工作

## Key Decisions

### Current Phase 04.1 decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| **04.1 D-01–D-07**：只管理两个内置 capability；install 使用 `installed ∪ selected`，update 更新已安装集合，uninstall 必须选择 capability 或 `--all` | 让能力独立组合，同时保持一次一个宿主、一次完整原子事务 | Validated in Phase 04.1 |
| **04.1 D-15**：代码规范提示前验证 current schema、composite digest 与全部受管文件摘要 | 损坏能力不能消耗一次性 marker，也不能用内置简版规则掩盖漂移 | Validated in Phase 04.1 |
| **04.1 D-19/D-20**：marker 位于 OS cache 的 `kcoderag-nav/nudges`，仅稳定会话创建一次；人工复位前关闭全部相关宿主会话 | 不污染项目，避免删除后仍运行的会话立刻重建 marker；所有缓存错误 fail-open | Validated in Phase 04.1 |
| **04.1 D-21–D-24**：代码规范支持只来自 exact digest-bound PASS receipt；未证明宿主返回 `host_version_unsupported` 且零写 | 不把 Rule、Skill、toast 或 after-event 伪装成 model-visible native pre-write | Validated in Phase 04.1 |
| **04.1 manual-source boundary**：全部变更命令对 manual/active/ambiguous/旧来源硬停止，无 migration/adoption/cleanup authority | 任何写入前先消除重复来源和模糊所有权，不扩大 CLI 删除权限 | Validated in Phase 04.1 |

### Historical milestone decisions (superseded where noted)

以下记录保留当时已经执行的不可变发布与部署事实，不是当前 CLI 的可执行迁移、清理或旧状态授权。

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| **D-01 / D-02**：`0.2.0` 起公共 CLI、npm 制品、生成资产和用户文档 QA-only；当时 Dev 仍为严格 legacy 解码输入 | 这是 Phase 04 当时的一次性迁移/卸载设计，Phase 04.1 已删除相应 authority | Historical Phase 04; superseded |
| **D-03**：当时 owned user source 清理必须有独立、精确 fingerprint 绑定的明确授权 | 该能力曾防止一般确认扩大删除权；Phase 04.1 已删除自动清理入口 | Historical Phase 04; superseded |
| **D-04**：全部门禁通过后直接发布 `0.2.0`，无需再次人工发布审批 | 本次讨论已给出不可逆发布决定，同时保留机器门禁 | Released; fix-forward accepted at 0.2.2 |
| **D-05–D-08**：Hook 采用最近状态向上查找、损坏边界不穿透、相对状态可移动，安装目标拒绝全局危险根但不要求 VCS | 同时解决深层 cwd、嵌套项目、项目移动和 project-only 安全 | Validated in Phase 04 |
| **D-09–D-12**：selected-host 来源分级；当时 active 来源阻断 install/update、owned legacy 可确认清理、uninstall 可减少来源 | Phase 04.1 改为所有变更命令统一硬停止且无清理 authority | Historical Phase 04; superseded |
| **D-13–D-16**：status 快速、doctor 深扫；`source_conflict` 为独立不健康状态，未安装项目仍可运行 doctor | 诊断可预测、只读、适用于安装前且不依赖用户先跑 doctor | Validated in Phase 04 |
| **D-17–D-19**：当时公开 exact 制品按 doctor→授权清理→update/migrate→status/doctor 部署 Head，并验证根/深层 Hook 与三宿主健康 | 保留 exact 0.2.2 的历史证据；流程不是当前操作说明 | Historical evidence at exact 0.2.2 |
| **D-20**：当时 Head 迁移失败保持 npm/tag/latest 不变并回滚项目事务，只以前进版本修复 | 维护不可变发布身份；当前 CLI 已无迁移入口 | Historical release policy |

## Evolution

This document evolves at phase transitions and milestone boundaries. Phase 1–3/03.1 与 Phase 04 的
QA/Dev migration、owned cleanup 和 exact Head 部署记录只保留为明确 historical facts；Phase 04.1
以两个内置 capability、current schema v1、全 mutation source gate 和 receipt-bound support 取代其
当前产品效力，不重写已经发生的不可变发布证据。

---
*Last updated: 2026-08-27 after Phase 04.1 capability-platform completion*
