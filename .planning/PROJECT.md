# KCodeRag Nav Plugins

## What This Is

KCodeRag Nav Plugins 是 KCodeRag MCP 查询服务的代理导航插件分发仓库，面向 Codex，
并保留 Claude Code 兼容能力。仓库发布 `kcoderag-qa` 与 `kcoderag-dev` 两个可独立安装、
独立卸载、单独完整工作的插件，使代码代理在结构化代码检索时优先使用知识图谱，精确文本
和未提交改动仍使用本地搜索。

普通用户只需要安装 QA 插件；Dev 插件主要用于开发和测试。测试人员可以同时安装两者，
此时默认查询 QA，只有明确指定 Dev 或要求环境对比时才查询 Dev 或双查询。

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
- [ ] 双插件共存时默认使用 QA；明确指定 Dev 时仅用 Dev；明确比较时才双查询
- [ ] 同一次本地搜索在双插件共存时只注入一次 hook 提示
- [ ] hook、skill 和测试只维护一份规范源，通过生成式发布产出两个独立安装包
- [ ] 生成结果可重复，并能检测 Dev/QA 安装包的非预期行为漂移
- [ ] 安装、单环境运行、双环境共存、卸载和 hook 行为具有自动化验证
- [ ] 当前内部 QA/Dev 阶段保持装即用，插件安装包携带可直接连接的 Bearer 配置

### Out of Scope

- 安装 QA 时自动卸载 Dev，或安装 Dev 时自动卸载 QA — 两个插件必须能够共存测试
- 强制用户额外安装公共 core 插件 — 两个环境包必须单独完整工作
- 生产级凭据分发、用户级 OAuth、HTTPS 和令牌轮换 — 当前仅服务内部 QA/Dev，后续里程碑再治理
- 修改 KCodeRag MCP 服务、解析流水线、Neo4j 数据或接口实现 — 本仓库只负责插件分发和导航策略
- 让 Dev 成为普通用户的隐式回退 — 环境不可达必须明确报告，不能静默换环境

## Context

- 当前仓库使用 `kcoderag-dev/` 与 `kcoderag-qa/` 两棵近乎相同的目录树，hook、测试、
  skill、README 和注册配置容易发生漂移。
- Codex 会执行所有匹配的插件 hook；双装时两份相同 `PreToolUse` hook 会并发启动，
  因此不能依赖加载顺序或让一个 hook 阻止另一个启动。
- 两个插件仍需各自携带完整运行资产。共享源码应在仓库内生成两个自包含分发目录，而不是
  让安装后的插件依赖父目录、符号链接或另一个插件。
- 双装 hook 去重必须跨插件进程工作，并保持 fail-open；去重失败不得阻止原始搜索操作。
- hook 解析器已经补充 attached `-e`、attached `-g`、`findstr /C:`、`--`、
  positional `Get-ChildItem`、PowerShell/cmd wrapper、单文件抑制和输入长度边界等覆盖。
- 当前测试为标准库 Python 脚本，没有第三方包管理或构建系统；新增生成和 E2E 验证应尽量
  保持轻量、跨 Windows 与 Unix 可执行。

## Constraints

- **独立性**: 两个环境插件必须分别安装、卸载和运行 — Dev 不能只是依赖 QA 的附加包
- **默认环境**: 双装时 QA 优先 — 普通用户路径和验收环境保持一致
- **分发**: 安装产物必须自包含 — 插件缓存不会可靠保留仓库级共享父目录
- **Hook**: 仅提供 advisory context，任何异常都必须 fail-open — 不阻断 `grep`、`glob` 或 shell
- **兼容性**: 支持 Codex，并维持现有 Claude Code marketplace/hook 兼容能力
- **凭据**: 当前 QA/Dev 阶段允许装即用的内置 Bearer — 明确接受内部测试阶段风险
- **变更保护**: 仓库已有未提交修改，初始化和后续实现不得覆盖或回退无关工作

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 保留 QA 与 Dev 两个独立插件 | 两者需要分别安装、卸载和单独完整使用 | — Pending |
| QA 面向普通用户，Dev 面向开发测试 | 正常使用只需要 QA，双装是环境测试需求 | — Pending |
| 双装默认 QA，显式请求才使用 Dev 或双查询 | 防止无意命中开发数据，并使路由可预测 | — Pending |
| 不使用安装时自动卸载 | 自动卸载破坏双环境测试和可逆性 | — Pending |
| 一份规范源生成两个自包含安装包 | 同时满足独立安装和消除维护期重复 | — Pending |
| 双装 hook 在运行时跨进程去重 | Codex 会并发启动所有匹配 hook，加载顺序不可作为互斥机制 | — Pending |
| 当前继续内置 Bearer | 用户要求内部 QA/Dev 阶段装即用且暂不考虑安全治理 | — Pending |

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
*Last updated: 2026-08-20 after initialization*
