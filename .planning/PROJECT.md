# KCodeRag Nav Plugins

## What This Is

KCodeRag Nav Plugins 是 KCodeRag MCP 查询服务的代理导航插件分发仓库，面向 Codex、
Claude Code 与 Cursor。仓库发布 `kcoderag-qa` 与 `kcoderag-dev` 两个可独立安装、独立卸载、
单独完整工作的 Codex/Claude 插件，并生成一个只配置单环境的 Cursor 私有插件，使代码代理
在结构化代码检索时优先使用知识图谱，精确文本和未提交改动仍使用本地搜索。

普通用户只需要安装 QA 插件；Dev 插件主要用于开发和测试。QA 与 Dev 互斥，切换环境时
必须先卸载当前环境，再安装另一个环境。
默认分发路径采用项目级安装器，将 Codex hook、skill 与 MCP 配置部署到目标仓库自己的
`.codex/` 和 `.agents/`；用户级 `codex plugin add` 仅作为显式可选路径。
Cursor 通过私有 Team Marketplace 的 project scope 或本地插件目录分发，默认 QA，Dev 通过
成对替换 URL 与 Bearer 配置切换。

## Core Value

用户安装任一环境插件后即可获得可靠、低打扰、环境选择明确的 KCodeRag 图优先导航体验。

## Requirements

### Validated

- ✓ Dev 与 QA 均已有独立的插件目录、MCP 注册、权限、说明和导航 skill — existing
- ✓ `PreToolUse` hook 对结构化 `Grep`、`Glob` 和常见 shell 搜索提供非阻塞提示 — existing
- ✓ hook 在错误输入、无关搜索和本地机械操作上保持 fail-open — existing
- ✓ Dev 与 QA 的 hook 解析器回归测试目前均为 53/53 通过 — existing
- ✓ Codex `.codex-plugin/plugin.json` 与本地 marketplace 分发路径已经建立 — existing

### Active

- [ ] `kcoderag-qa` 与 `kcoderag-dev` 均可独立安装、独立卸载并单独完整工作
- [ ] QA 是普通用户的默认选择，Dev 是开发和测试选择
- [ ] 项目安装器拒绝 QA 与 Dev 双装，以及未先卸载当前环境的跨环境安装
- [ ] 单环境 hook 不依赖跨进程 marker 或其他去重状态
- [ ] hook、skill 和测试只维护一份规范源，通过生成式发布产出两个独立安装包
- [ ] 生成结果可重复，并能检测 Dev/QA 安装包的非预期行为漂移
- [ ] 安装、单环境运行、互斥冲突、卸载和 hook 行为具有自动化验证
- [ ] 当前内部 QA/Dev 阶段保持装即用，插件安装包携带可直接连接的 Bearer 配置
- [ ] 默认项目安装只修改目标仓库的 `.codex/` 与 `.agents/`，不修改用户级 Codex 配置或插件缓存
- [ ] 项目安装默认选择 QA，Dev 必须通过显式参数选择，切换环境必须先卸载
- [ ] Cursor 只发布一个 `kcoderag-nav` 插件和一个 MCP server，默认 QA，Dev 通过成对配置切换
- [ ] Cursor 使用 project scope、Default Off 的私有 Team Marketplace，不在本分发仓库中安装
- [ ] Cursor 使用 always-on Rule 加共享 skill 提示导航，不移植不能注入 advisory context 的 hook

### Out of Scope

- QA 与 Dev 同时启用 — 两个环境改为互斥安装模式
- 安装 QA 时自动卸载 Dev，或安装 Dev 时自动卸载 QA — 切换必须由用户显式卸载，避免隐式删除
- 强制用户额外安装公共 core 插件 — 两个环境包必须单独完整工作
- 生产级凭据分发、用户级 OAuth、HTTPS 和令牌轮换 — 当前仅服务内部 QA/Dev，后续里程碑再治理
- 修改 KCodeRag MCP 服务、解析流水线、Neo4j 数据或接口实现 — 本仓库只负责插件分发和导航策略
- 让 Dev 成为普通用户的隐式回退 — 环境不可达必须明确报告，不能静默换环境
- 声称 `codex plugin add` 具有当前不存在的原生 project scope — 项目级行为由兼容安装器实现
- 提交公共 Cursor Marketplace — 当前包携带内部连接默认值，只允许受限私有分发

## Context

- 当前仓库使用 `kcoderag-dev/` 与 `kcoderag-qa/` 两棵近乎相同的目录树，hook、测试、
  skill、README 和注册配置容易发生漂移。
- 两个插件仍需各自携带完整运行资产。共享源码应在仓库内生成两个自包含分发目录，而不是
  让安装后的插件依赖父目录、符号链接或另一个插件。
- 当前 Codex CLI 不提供插件 `--scope project`；仓库 marketplace 只限定发现来源，安装缓存和
  启用状态仍属于用户环境，因此默认项目级体验必须通过受管本地配置实现。
- 当前 Codex/ChatGPT plugin manifest 没有插件冲突字段；项目安装器可严格互斥，用户级
  marketplace 路径只能把双装标为不支持并要求用户先卸载或禁用另一环境。
- hook 解析器已经补充 attached `-e`、attached `-g`、`findstr /C:`、`--`、
  positional `Get-ChildItem`、PowerShell/cmd wrapper、单文件抑制和输入长度边界等覆盖。
- 当前测试为标准库 Python 脚本，没有第三方包管理或构建系统；新增生成和 E2E 验证应尽量
  保持轻量、跨 Windows 与 Unix 可执行。
- Cursor `preToolUse` 不能在执行前注入 advisory context；Cursor 包因此使用 always-on Rule，
  并通过单一通用 MCP server 从配置层保证 QA/Dev 不会同时启用。

## Constraints

- **独立性**: 两个环境插件必须分别安装、卸载和运行 — Dev 不能只是依赖 QA 的附加包
- **环境互斥**: QA 与 Dev 不能同时安装 — 默认 QA，Dev 仅通过显式选择安装
- **分发**: 安装产物必须自包含 — 插件缓存不会可靠保留仓库级共享父目录
- **项目边界**: 默认安装与卸载只能修改目标仓库内由安装器管理的文件 — 不污染用户配置或无关项目文件
- **Hook**: 仅提供 advisory context，任何异常都必须 fail-open — 不阻断 `grep`、`glob` 或 shell
- **兼容性**: 支持 Codex、Claude Code 与 Cursor；Cursor 使用 Rule，不声称 hook 行为等价
- **凭据**: 当前 QA/Dev 阶段允许装即用的内置 Bearer — 明确接受内部测试阶段风险
- **变更保护**: 仓库已有未提交修改，初始化和后续实现不得覆盖或回退无关工作

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 保留 QA 与 Dev 两个独立插件 | 两者需要分别安装、卸载和单独完整使用 | — Pending |
| QA 面向普通用户，Dev 面向开发测试 | 正常使用只需要 QA，Dev 仅在明确测试时安装 | — Pending |
| QA 与 Dev 互斥安装 | 删除双环境路由、并发 hook 与上下文歧义 | — Pending |
| 切换前显式卸载，不自动替换 | 避免安装命令隐式删除用户已选环境 | — Pending |
| 一份规范源生成两个自包含安装包 | 同时满足独立安装和消除维护期重复 | — Pending |
| 单环境 hook 不维护跨进程去重 marker | 互斥安装后不再需要双 hook 协调，并消除额外 IO 与静默 claim 失败 | — Pending |
| 当前继续内置 Bearer | 用户要求内部 QA/Dev 阶段装即用且暂不考虑安全治理 | — Pending |
| 默认使用项目级兼容安装器 | Codex 当前没有原生插件 project scope，但用户要求默认仅作用于当前仓库 | — Pending |
| 用户级 plugin add 仅作为显式可选路径 | 保留原生插件浏览器能力，同时避免普通安装默认全局生效 | — Pending |
| Cursor 只发布一个可配置环境的插件 | Cursor 正常使用不应双装 QA/Dev，单 server 从结构上消除双环境路由 | — Pending |
| Cursor 私有分发使用 project scope 和 Default Off | 避免在无关项目或本分发仓库中默认启用 KCodeRag | — Pending |
| Cursor 以 Rule 替代查找 hook | `preToolUse` 无法追加 advisory context，Rule 能提供非阻塞导航提示 | — Pending |

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
*Last updated: 2026-08-20 after adding private Cursor distribution*
