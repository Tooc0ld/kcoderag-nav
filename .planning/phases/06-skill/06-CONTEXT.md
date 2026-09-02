# Phase 6: 四 Skill 公共接口与宿主交付模式 - Context

**Gathered:** 2026-09-02
**Status:** Ready for planning
**Source:** PRD Express Path (`.planning/quick/260902-n3l-implement-the-agreed-four-public-skills-/260902-n3l-PLAN.md`)

<domain>
## Phase Boundary

把现有两个内部 capability 投影为四个可发现、可显式调用的公开 Skill，并把手动代码规范能力与自动写前提示的宿主支持门禁解耦。范围包含五宿主 adapter、受管生命周期、status/doctor、确定性生成与打包验证；不新增内部 capability，不扩大尚未由真实宿主证据证明的自动 Hook 行为，也不执行 npm publish。

</domain>

<decisions>
## Implementation Decisions

### 公开 Skill 接口

- **D-01:** 公开 Skill 固定为 `$kcoderag`、`$kcoderag-manage`、`$kcoderag-feedback`、`$kcoderag-code-style` 四个名称。
- **D-02:** 不保留 `code-lookup-discipline` 或 `code-style-correction` 的目录、frontmatter 名称或兼容 alias；更新仅按当前受管状态中的明确所有权安全重组旧路径。
- **D-03:** `$kcoderag` 只负责只读代码导航，覆盖自然语言 lookup 以及 search、context、calls、indexes、graph 路由，不承担 lifecycle mutation、代码修改或反馈提交。
- **D-04:** `$kcoderag-manage` 默认只执行或指导只读 `status`/`doctor`；只有用户明确要求更新时才执行 `update`。不得把 cleanup 或 uninstall 作为默认行为；卸载或其他破坏性动作仍需用户明确授权并服从 CLI 所有权门禁。
- **D-05:** `$kcoderag-feedback` 只通过 KCodeRag feedback 接口提交可由真实查询结果支持的评价；不得虚构用户意见，不得包含源码正文、凭据、URL、Header、Bearer、token 或配置正文。
- **D-06:** `$kcoderag-code-style` 接受自然语言写前问题，并支持 `$kcoderag-code-style review <文件或当前变更>`。它不定义 `apply` 子命令；用户要求实际编辑时仍由宿主普通编辑能力和既有授权边界处理。

### Capability 与宿主交付

- **D-07:** 内部 capability ID 和 handler 名保持不变且仍只有 `kcoderag-navigation` 与 `code-style-nudge`。`kcoderag-navigation` 交付前三个公开 Skill；`code-style-nudge` 交付手动 `$kcoderag-code-style` 及其 references，并在有证据时额外交付自动提示。
- **D-08:** 五宿主都可安装、发现和手动调用 `$kcoderag-code-style`。自动 native pre-write nudge 仍只对冻结 PASS receipt 对应的 Claude Code `2.1.241` 启用；Codex、Cursor、OpenCode、ZCode 与未证明版本只安装手动 Skill，不得声称等价自动 Hook。
- **D-09:** `status` 与 `doctor` 分别报告 `manualSkill` 和 `automaticNudge`。正面声明必须来自 schema-v1 受管状态、完整摘要和实际 contributor/section 所有权；缺失、损坏或漂移时报告 absent/unknown/drifted 等诚实状态，不根据宿主形状推断。

### Skill 结构与调用策略

- **D-10:** Codex 投影的四个 Skill 都带匹配的 `agents/openai.yaml`，至少包含 `display_name`、25–64 字符的 `short_description`、显式提及 `$skill-name` 的 `default_prompt`，并保持 `policy.allow_implicit_invocation: true`。可自动发现不代表自动授权 mutation；管理 Skill 仍在执行前检查用户是否明确要求 update/uninstall。
- **D-11:** `SKILL.md` 保持短而可判别；只有代码规范的 substantial mode-specific 规则继续放在现有 references 中并按 C++ 生命周期/协议、Lua 契约、变更卫生风险选择性读取。不要为简单 Skill 增加 README、占位目录或重复参考文档。

### 生命周期与验证

- **D-12:** fresh install、update、capability-selective uninstall 与 `--all` 必须继续走现有 adapter/compose/transaction 所有权边界；重命名不得 broad-delete，漂移、symlink、特殊文件或模糊来源仍写前硬停止并完整回滚。
- **D-13:** 生成产物、npm pack inventory、五宿主 smoke、文档和完整 CI 必须同时证明“四公开 Skill、两内部 capability、五宿主手动 style、仅 exact Claude 自动 nudge”。生成第二次必须由 `generate:check` 等现有有效门禁证明无漂移。

### the agent's Discretion

- 在不改变上述公共行为与状态语义的前提下，决定 delivery decision 的 TypeScript 类型形状、helper 名称、测试 fixture 组织和计划切分细节。
- 决定 `manualSkill`/`automaticNudge` 的稳定枚举字符串，但必须能区分已安装可用、不可用/未安装、无法证明或漂移，并保持 JSON 与人类输出一致。
- 决定三个导航族 Skill 是由同一 provider 的多个 contributor 还是共享 helper 渲染，但不得形成第三个 capability 或重复公共目录。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 产品与受管生命周期

- `.planning/PROJECT.md` — 当前两 capability、五宿主、状态、来源门禁、secret-safe 与发布边界。
- `.planning/ROADMAP.md` — Phase 6 目标、依赖关系和成功标准。
- `AGENTS.md` — Windows shell、架构、生成、事务与 dirty-worktree 约束。
- `src/core/state.cts` — schema-v1 受管所有权与摘要模型。
- `src/core/transaction.cts` — 唯一文件系统 commit 边界与回滚语义。

### Capability、宿主与生成

- `src/capabilities/registry.cts` — 两个内部 capability 的冻结 registry。
- `src/capabilities/navigation.cts` — navigation provider 当前 contributor。
- `src/capabilities/code-style-nudge.cts` — code-style provider 当前 Skill/reference/hook 资产。
- `src/hosts/host-version-support.cts` — 当前唯一宿主版本与冻结 receipt 支持策略源。
- `src/hosts/host-adapter.cts` — adapter 读/渲染契约。
- `src/generator/index.cts` — canonical templates 到生成产物的确定性路由。

### 现有 Skill 与行为规范

- `plugin-src/skills/code-lookup-discipline/SKILL.md` — 待替换的导航 Skill 行为来源。
- `plugin-src/capabilities/code-style-nudge/skill/SKILL.md` — 待重命名的代码规范入口。
- `plugin-src/capabilities/code-style-nudge/skill/references/` — 保留并按风险路由的代码规范参考。
- `docs/MCP_QA_EXPERIENCE_GUIDE.md` — 本仓库独占维护的用户体验指南；仅做 scoped patch，保留现有未提交内容。

</canonical_refs>

<specifics>
## Specific Ideas

- Hook 提示只建议加载 `$kcoderag-code-style`，不得声称短提醒已经执行完整规范检查。
- style-only 与 navigation+style 组合都要在五宿主 fixture 中覆盖；Codex 等非 receipt 宿主的 style-only 安装必须健康且没有 native pre-write section。
- exhaustive old-name search 必须覆盖 maintainer pre-commit、session-start、旧 Skill tests、生成目录、adapter 与 package inventory。

</specifics>

<deferred>
## Deferred Ideas

- 为 Codex、Cursor、OpenCode 或 ZCode 启用自动写前 nudge，直到对应真实宿主版本获得独立冻结 PASS receipt。
- 新增第三个 code-style capability 或恢复旧 Skill alias。
- npm publish、dist-tag 调整、生产身份/HTTPS/token 轮换。

</deferred>

---

*Phase: 06-skill*
*Context gathered: 2026-09-02 via PRD Express Path*
