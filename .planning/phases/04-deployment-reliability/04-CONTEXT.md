# Phase 04: 已部署项目与安装来源可靠性 - Context

**Gathered:** 2026-08-25
**Status:** Ready for planning

<domain>
## Phase Boundary

将公共 `kcoderag-nav` 从 QA/Dev 双环境项目集成收敛为 QA-only，并为 Codex、Claude Code 与
Cursor 提供严格项目级的安装、旧来源迁移、用户级冲突诊断和稳定 Hook 根定位。Phase 结束前，
实现必须通过测试、审查、四通道 CI 与公开 npm 制品验证，直接发布不可变的 `0.2.0`，再使用
公开 exact 版本将 `I:\JX3_SVN\Head` 的旧项目级 QA 安全迁移为当前受管安装。

这一边界有意覆盖 Phase 03.1 的 Dev 安装决策。规划必须先同步修订 `.planning/PROJECT.md`、
`.planning/REQUIREMENTS.md`、`.planning/ROADMAP.md`、受管 AGENTS 内容、README 与 KCodeRag
权威体验指南，再删除公共 Dev CLI、生成资产和文档契约。旧 Dev 状态只保留一次性的可验证迁移/
卸载兼容能力，不再视为受支持环境。

本阶段不优化 grep/Hook 误报，不完成真实 MCP 工具注册或图查询证据，不整理 GSD 全局 Hook，
也不处理生产身份、HTTPS 或凭据轮换。

</domain>

<decisions>
## Implementation Decisions

### QA-only 产品与旧安装迁移

- **D-01:** 公共 npm 包、CLI、生成资产和用户文档彻底删除 Dev；QA 是唯一可安装环境。恢复 Dev 必须作为新的独立产品决策重新设计，而不是保留隐藏参数。— **Reversibility:** one-way — `0.2.0` 发布后，恢复 Dev 会再次改变公共 CLI、npm 制品、状态模式、生成树和用户迁移契约。
- **D-02:** 同一项目、同一宿主内所有权明确且无漂移的旧 Dev 安装，可在展示变更并获得明确确认后，以一个项目事务迁移为 QA；非交互自动化必须显式传 legacy Dev 迁移参数。状态或受管内容漂移时写前硬停止。
- **D-03:** 所选宿主中所有权明确的旧用户级 KCodeRag plugin，可在展示清理计划并获得明确确认后，通过宿主原生卸载能力移除，再继续项目 QA 安装；自动化必须显式授权。无受管状态的 raw MCP、手写 Hook 或所有权不明来源不得自动修改。
- **D-04:** QA-only 作为公开契约变化发布 `0.2.0`。实现、测试、审查、四通道 CI、pack 和公开制品门禁全部通过后直接发布并验证，不再增加人工发布授权检查点；本次讨论即为该发布路径的用户决定。— **Reversibility:** one-way — npm 版本与 Git tag 发布后必须保持不可变，只能通过后续版本修复前进。

### 项目根与 Hook 定位

- **D-05:** 已安装 Hook 从会话当前目录向父目录逐级查找所选宿主最近的 `kcoderag-nav/install-state.json`；最近的受管项目优先。CLI 的默认 `cwd` 和显式 `--target` 仍表示精确安装目标，不自动改写为 Git/SVN 根。
- **D-06:** 一旦找到最近项目的状态边界，即使状态损坏、版本不兼容或 launcher 缺失，也不得越过它使用外层项目安装；Hook 静默 fail-open，诊断交给 `status/doctor`。
- **D-07:** 安装状态只依赖项目内相对路径和受管摘要，不绑定旧绝对路径。项目整体复制、移动、改名或更换盘符后，只要内容完整，Hook 与 `status` 继续正常工作。
- **D-08:** 项目安装拒绝用户主目录、文件系统根目录以及 Codex、Claude Code、Cursor 的用户级配置、plugin 和 cache 根目录。其他明确目录在展示规范化绝对路径并确认后可作为项目，不强制要求 Git/SVN 或专用 marker。

### 用户级来源分类与写入门禁

- **D-09:** 用户级来源采用分级模型：可能实际生效的 plugin/raw MCP/Hook 是冲突；所有权明确的旧 plugin 或 marketplace 注册可进入确认式清理；仅有 cache、下载残留或已禁用记录时只在 `doctor` 中提示，不阻止项目安装。
- **D-10:** 一次命令只扫描和处理所选宿主的用户级来源。Codex、Claude Code 与 Cursor 的项目级 QA 安装可以共存，其他宿主的来源不阻止当前宿主命令。
- **D-11:** 无受管所有权的 raw MCP 或 Hook 导致写前硬停止。诊断只输出稳定错误码、宿主、scope 和安全配置路径，不读取、比较、记录或显示 URL、Header、Bearer 等配置值。
- **D-12:** `install` 和 `update` 每次都执行完整来源门禁；`uninstall` 在项目自身无漂移时仍允许执行，因为它减少有效来源；`status` 和 `doctor` 始终只读。

### status 与 doctor 诊断体验

- **D-13:** `status` 是快速项目健康检查，报告受管状态、版本、漂移和来源冲突摘要；`doctor` 在此基础上深入扫描所选宿主的用户级来源。`install/update` 不依赖用户预先运行 `doctor`，而是自行执行相同的完整写前门禁。
- **D-14:** `doctor` 的每个 finding 输出稳定错误码、严重级别、来源类型、project/user scope、安全路径和可复制的宿主原生清理命令；不显示配置值，也不提供 `doctor --fix`。
- **D-15:** 项目内容完整但存在会重复生效的用户级来源时，顶层状态为独立的 `source_conflict` 且 `ok: false`，不得降级为 `healthy` warning 或笼统的 `invalid`。
- **D-16:** 目标项目尚未安装时，`status` 可返回 `not_installed`；`doctor` 仍执行所选宿主的安装前来源诊断，并明确当前是否可安全安装 QA。

### Head 部署与公开验证

- **D-17:** `0.2.0` 发布成功后，Head 使用公开 npm exact 版本按 `doctor → 清理已确认旧来源 → update/migrate → status/doctor` 顺序迁移；不得使用 `latest` 或本地 `npm pack` 冒充公开安装证据。
- **D-18:** Head 迁移前发现任何受管状态或内容漂移时写前硬停止；不提供 `--force`，不通过自动卸载绕过所有权和摘要保护。人工恢复或清理后重新运行 exact 迁移。
- **D-19:** Phase 04 的 Head 验收必须证明 exact npm 制品身份、`status=healthy`、`doctor` 无活动重复来源、项目根和深层子目录使用同一项目 Hook，以及无关项目/用户配置未被修改；项目移动行为在临时副本自动化测试中验证。真实 MCP 工具注册和图查询留给 Phase 06。
- **D-20:** 若 `0.2.0` 已发布但 Head 迁移失败，项目事务恢复迁移前状态；npm 版本和 tag 保持不变，不回退 `latest`、不 unpublish。修复后发布 `0.2.1` 并使用新的 exact 版本继续迁移。

### Agent's Discretion

- 向上查找的内部 API、遍历上限、跨平台命令转义和 bootstrap 组织方式由研究与规划决定，但必须满足最近项目边界、移动可用和全异常 fail-open。
- legacy Dev 显式迁移参数、用户级旧 plugin 清理授权参数及 finding 的具体字段名可按现有 CLI 风格命名；`source_conflict` 顶层状态和只读边界不可更改。
- 各宿主原生 plugin 枚举/卸载的调用封装、超时和错误码可按宿主能力设计；不得手工篡改所有权不明的用户配置。
- human-readable 输出排版与 JSON 字段顺序可由规划决定，但 `--json` 必须只输出一个稳定、可解析且不含敏感值的 JSON 文档。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 产品边界与已锁定历史

- `.planning/PROJECT.md` — 当前三宿主、QA/Dev、项目边界与后续阶段定义；本阶段必须同步为 QA-only。
- `.planning/REQUIREMENTS.md` — DEP-01 至 DEP-03 以及被 QA-only 决策覆盖的 PKG/ROUT/TEST 历史要求与 traceability。
- `.planning/ROADMAP.md` — 当前 Phase 04 目标、成功标准和 Phase 05–08 的不可吞并边界。
- `.planning/phases/03.1-javascript-npx/03.1-CONTEXT.md` — npx、CJS、host adapter、项目事务和旧 QA/Dev 公共契约；本文件明确覆盖其中的 Dev 支持决定。

### CLI、状态、事务与宿主边界

- `package.json` — 唯一版本源、npm bin、发布 allow-list 和 `0.2.0` 制品边界。
- `src/bin/kcoderag-nav.cts` — 公共 CLI 入口、当前工作目录和进程边界。
- `src/cli/commands.cts` — 五命令编排、host/environment 选择以及当前 `status/doctor` 共用路径。
- `src/core/contracts.cts` — 状态、错误、目标和 desired-state 公共契约。
- `src/core/project-target.cts` — 当前精确 target 与受管路径安全校验；需要增加全局位置拒绝和运行时根发现能力。
- `src/core/state.cts` — 当前 QA/Dev 安装状态、版本和摘要模式；需保留遗留 Dev 读取但停止生成新 Dev 状态。
- `src/core/transaction.cts` — 唯一项目写入边界、state-last commit 和完整回滚。
- `src/hosts/host-adapter.cts` — adapter 的 read/render/status 能力与当前未使用的 `doctor` 标志。
- `src/hosts/index.cts` — Codex、Claude Code、Cursor 单宿主注册边界。
- `src/hosts/codex.cts` — Codex 项目配置、Hook section、状态和旧安装迁移。
- `src/hosts/claude.cts` — Claude Code 项目 Hook/MCP/skill ownership 与状态。
- `src/hosts/cursor.cts` — Cursor Rule/skill/MCP 和现有授权式用户级 legacy 迁移参考。

### 生成、Hook、测试与发布

- `plugin-src/environments.json` — 当前 QA/Dev 环境清单；需收敛为 QA-only，且不得在日志或文档暴露配置值。
- `plugin-src/routing.json` — 当前环境路由配置；需移除 Dev 用户路由。
- `plugin-src/hooks/hooks.json` — 生成 hook 注册模板与宿主命令接口。
- `plugin-src/hooks/run_hook.cmd` — Windows 自相对 launcher；当前不能独自解决宿主从子目录解析项目相对命令的问题。
- `plugin-src/hooks/run_hook.sh` — POSIX 自相对 launcher 与 fail-open 边界。
- `src/generator/index.cts` — QA/Dev/Cursor 确定性生成和发布资产清单；需删除 Dev 产品输出。
- `tests/cli/commands.test.cts` — CLI、交互、JSON 和只读命令基线。
- `tests/core/transaction.test.cts` — 路径、漂移、原子回滚和 TOCTOU 防护基线。
- `tests/hooks/launcher.test.cts` — 当前从嵌套 cwd 直接执行 launcher 的测试；需覆盖真实安装配置中的根发现命令。
- `tests/hosts/codex.test.cts` — Codex install/status/update/uninstall 与 legacy migration 基线。
- `tests/hosts/claude.test.cts` — Claude Code adapter 生命周期基线。
- `tests/hosts/cursor.test.cts` — Cursor 用户级 legacy 清理、备份和补偿模式参考。
- `tests/hosts/cross-host.test.cts` — 单宿主命令与跨宿主项目共存约束。
- `src/smoke/host-smoke.cts` — exact npm 制品、三宿主项目生命周期和诚实 PASS/FAIL/NOT_RUN 门禁。
- `src/maintainer/release.cts` — 版本/tag/release helper 与受管发布路径。
- `src/maintainer/publish-receipt.cts` — 不可变 npm/CI/制品证据回执。
- `.github/workflows/ci.yml` — Windows/Linux、Node 22/24 必需测试矩阵。
- `.github/workflows/release.yml` — tag 触发的四通道发布与 npm publish 依赖关系。

### 用户文档

- `README.md` — 公共 npm 安装、命令、环境和迁移说明；需改为 QA-only 项目流程。
- `../KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md` — 唯一权威体验指南；必须同步 QA-only、项目边界、doctor/status、旧来源清理与 exact 更新流程，本仓库不得保留副本。

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `HostAdapter`、`DesiredState` 与 `applyTransaction` 已将宿主读取/渲染和项目写入分离，可复用为 QA-only desired state、legacy Dev 到 QA 的单项目事务以及只读来源观察。
- Codex/Claude/Cursor adapter 已具备受管文件、structured section、摘要漂移与状态报告，可在不读取 MCP 值的前提下增加来源 finding。
- Cursor 已有显式授权、精确所有权、备份和补偿的用户级 legacy 清理模式，可作为其他宿主“仅清理已确认 plugin”的设计参考，但不能放宽 raw 配置边界。
- release helper、publish receipt、pack audit 和 exact/latest smoke 已能为 `0.2.0` 建立不可变 tag、四通道 CI 与公开 npm 制品证据。

### Established Patterns

- CLI 一次只选择一个宿主；跨宿主项目安装正常共存，QA-only 不改变这一边界。
- Adapter 只 read/render/status，项目文件只能经 transaction 写入；用户级原生 plugin 卸载必须作为独立、明确授权的迁移步骤处理，不能偷偷并入项目 transaction。
- Hook stdout 只能是有效宿主协议响应或空；根查找、状态损坏、Node 缺失和启动失败全部静默退出成功。
- `status/doctor --json` 只能产生一个无诊断噪音的 JSON 值；任何 issue 只能包含稳定代码和安全路径。

### Integration Points

- 当前 Codex 项目 Hook 命令写入 `.codex/hooks.json`，使用相对项目路径；launcher 本身自相对，但宿主在嵌套 cwd 下可能在到达 launcher 前就解析失败。需要一个从 cwd 向上寻找最近受管状态的可执行 bootstrap 契约。
- 当前 `commands.cts` 向 adapter 传递 `doctor: true`，但 adapter 尚未使用该字段；Phase 04 在这里接入快速 status 与深入 doctor 的分流。
- 当前 package/generator/state/CLI 仍传播 `EnvironmentId` 和 Dev 产品。规划需区分“删除新 Dev 能力”与“保留只读 legacy Dev 识别/迁移”两条路径。
- 用户级来源扫描应位于宿主 adapter 或独立 provider 边界，并向 install/update、status/doctor 提供同一份结构化 finding；不得通过打印或快照敏感配置实现诊断。

</code_context>

<specifics>
## Specific Ideas

- 当前 `I:\JX3_SVN\Head` 的 Codex QA 状态为 `update_available`，issue 为 `legacy_migration_available`；它是 Phase 04 的实际迁移目标。
- 当前用户级 Codex 存在名为 `kcoderag-nav` 的旧 marketplace 注册，指向已退役 marketplace manifest 的仓库根，并导致 `codex plugin list` 失败；它应作为“所有权明确、可确认清理”的真实 fixture，而不是 raw 配置自动删除的先例。
- 目标体验是普通用户只运行 `npx kcoderag-nav@latest install --host <host>` 即获得项目级 QA；Dev 不出现在帮助、交互选择、安装状态或用户文档中。
- Head 部署只接受公开 exact `kcoderag-nav@0.2.0`，并留下制品身份、健康状态、来源清洁和嵌套目录 Hook 证据。

</specifics>

<deferred>
## Deferred Ideas

- Hook fixed-string、多文件、本地复核、Lua 全局处理器和索引能力提示精度继续属于 Phase 05。
- 真实 Codex/Claude Code/Cursor 的 MCP 工具注册、图查询和完整宿主证据继续属于 Phase 06。
- GSD runtime/isolation 与全局 context-monitor 事件缩窄继续属于 Phase 07。
- 个人/组织身份、HTTPS、凭据轮换和生产安全继续属于 Phase 08。

</deferred>

---

*Phase: 04-deployment-reliability*
*Context gathered: 2026-08-25*
