# Roadmap: KCodeRag Nav Plugins

## Overview

Phase 1–3 已于 2026-08-23 根据 quick task 实现、当前代码和自动化测试完成回溯验证，并以
canonical plan/summary/verification/validation 收口。后续路线完成已部署项目可靠性、低误报
hook、真实宿主证据、GSD 运行时整理，最后进入生产安全与自动化发布。

## Phases

**Phase Numbering:**

- Integer phases (1–8): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: QA 优先的可重复插件包** - 从一份规范源生成并验证可立即使用的 QA 优先导航 MVP。 (completed 2026-08-23)
- [x] **Phase 2: 受管项目安装与环境生命周期** - 在不污染用户环境的前提下交付互斥的 QA/Dev 项目级安装、冲突保护与显式切换。 (completed 2026-08-23)
- [x] **Phase 3: 可预测的单环境图导航** - 让用户只查询当前安装环境，并在环境故障时获得明确、低打扰的 fallback 指引。 (completed 2026-08-23)
- [ ] **Phase 4: 已部署项目与安装来源可靠性** - 更新实际 Head 安装、稳定项目 hook 根路径，并为原生用户级误装提供安全诊断。
- [ ] **Phase 5: 低误报 Hook 与诚实路由** - 精确区分结构搜索和本地复核，并让 Lua 与索引能力提示符合实际。
- [ ] **Phase 6: 真实宿主兼容与发布证据** - 在 Codex、Claude Code 与 Cursor 真宿主上固化安装、工具注册和 hook 证据。
- [ ] **Phase 7: GSD 运行时与全局 Hook 整理** - 固化 Codex runtime 解析并缩窄全局 GSD hook 事件范围。
- [ ] **Phase 8: 生产安全与自动化发布** - 交付身份、HTTPS、凭据轮换、版本化制品和宿主兼容矩阵。

## Phase Details

### Phase 1: QA 优先的可重复插件包

**Goal**: 普通用户能从受控、可重复验证的自包含 QA 插件包获得装即用的图优先导航 MVP。
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: PKG-01, PKG-03, PKG-04, PKG-05, HOOK-01, HOOK-03, HOOK-04, HOOK-05, GEN-01, GEN-02, GEN-03, GEN-04, GEN-05, TEST-01, TEST-02
**Success Criteria** (what must be TRUE):

  1. 普通用户可按 QA 优先文档将自包含 QA 插件部署到目标仓库，并无需另行索取或配置凭据即可连接其 MCP 环境。
  2. 目标仓库中的 QA 安装会提供 hook、skill 和 MCP 配置；结构化 Grep、Glob 或 shell 搜索会获得图优先建议，而精确文本、日志、单文件及未提交改动搜索仍保持本地工具路径。
  3. QA hook 遇到无效输入或解析异常时不会阻止原始工具调用，已修复的命令解析形式继续有自动化回归保护。
  4. 维护者只维护一份 hook、skill 与共享测试规范源，即可生成保留各自名称、MCP 地址、Bearer 和权限命名空间的两个自包含环境包。
  5. 维护者可通过只读检查发现生成产物漂移，并可验证相同输入重复生成的安装产物内容一致、marketplace/manifest/hook/MCP 路径有效。

**Plans**: 1 plan (`01-01`, retrospective verification)

### Phase 2: 受管项目安装与环境生命周期

**Goal**: 用户可在目标项目内安全地选择一个 QA 或 Dev 环境，并通过显式卸载完成环境切换。
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: PKG-02, PKG-06, TEST-03, TEST-05, TEST-06
**Success Criteria** (what must be TRUE):

  1. 用户可通过显式参数在目标仓库中安装 Dev；Dev 无需依赖 QA 即可连接和使用其环境专属插件资产。
  2. 项目安装器拒绝 `both` 和未先卸载当前环境的跨环境安装，并且冲突失败不修改目标文件。
  3. 自动化验证覆盖仅 QA、仅 Dev、跨环境冲突、重复安装及先卸载再切换场景。
  4. 项目安装与卸载不会修改用户级 Codex 配置、插件缓存或无关项目文件，并同时保留 Codex 支持和现有 Claude Code 兼容路径。

**Plans**: 1 plan (`02-01`, retrospective verification)

### Phase 3: 可预测的单环境图导航

**Goal**: 单环境用户的查询路由与 hook 提示始终明确、低打扰且不会在环境故障时静默改变目标。
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: ROUT-01, ROUT-02, ROUT-03, ROUT-04, HOOK-02, TEST-04
**Success Criteria** (what must be TRUE):

  1. 项目安装器只允许 QA 或 Dev 单环境状态，默认安装 QA，显式选择时安装 Dev。
  2. 导航只查询当前安装环境，不包含双环境比较或隐式环境选择。
  3. 目标环境不可达时，用户会看到明确的不可达结果，系统不会静默切换到另一个环境。
  4. 索引不可用或陈旧时，nudge 和 skill 允许明确退回本地搜索；导航 nudge 不创建跨环境所有权 marker，异步更新检查只使用有界、fail-open 的 cache/session marker。
  5. 自动化验证覆盖单环境路由、互斥冲突、不可达语义、本地 fallback、无跨环境所有权 marker 与有界更新状态。

**Plans**: 1 plan (`03-01`, retrospective verification)

### Phase 03.1: JavaScript 与 npx 安装运行时迁移 (INSERTED)

**Goal:** 用户可在 Node.js 22+ 环境中通过统一 npx CLI，将无 Python 运行时依赖的 KCodeRag Nav 项目集成安全地安装、诊断、更新或卸载到 Codex、Claude Code 与 Cursor。
**Requirements**: JS-01, JS-02, JS-03, JS-04, JS-05, JS-06, JS-07, JS-08
**Depends on:** Phase 3
**Plans:** 13/27 plans executed across 26 waves

Plans:
**Wave 1**

- [x] 03.1-29-PLAN.md — 在首次 npm install/build 前固定 root-only Node ignore policy

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03.1-01-PLAN.md — 人工接受 exact npm 图与包名契约，建立机器审计并跑通 Codex QA tracer

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03.1-02-PLAN.md — 提炼宿主无关路径、状态与原子事务核心

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 03.1-03-PLAN.md — 行为等价迁移 advisory hook 与双平台 fail-open launcher

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 03.1-22-PLAN.md — 实现 compiled docs 与 sibling evidence 检查器

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 03.1-08-PLAN.md — 实现前台零网络、后台有界的 npm latest 检查

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 03.1-26-PLAN.md — 接线 HostAdapter/五命令 CLI 与 compiled CLI tests

**Wave 8** *(blocked on Wave 7 completion)*

- [x] 03.1-07-PLAN.md — 完成 Codex 生命周期与旧 Python install-state 安全迁移

**Wave 9** *(blocked on Wave 8 completion)*

- [x] 03.1-09-PLAN.md — 实现按产品与 exact asset group 运行的确定性 Node generator

**Wave 10** *(blocked on Wave 9 completion)*

- [x] 03.1-10-PLAN.md — 只生成保证变化的 QA CJS 与 Node launcher 路径
- [x] 03.1-11-PLAN.md — 只生成保证变化的 Dev CJS 与 Node launcher 路径

**Wave 11** *(blocked on Wave 10 completion)*

- [x] 03.1-23-PLAN.md — 只读验证 byte-equal 资产并运行真实 repository generation gate

**Wave 12** *(blocked on Wave 11 completion)*

- [x] 03.1-04-PLAN.md — 完成 Claude/Cursor adapter、授权式 Cursor legacy 迁移与跨宿主隔离

**Wave 13** *(blocked on Wave 12 completion)*

- [ ] 03.1-05-PLAN.md — 迁移 index-byte-preserving pre-commit、真实 pack 审计与四 lane required CI

**Wave 14** *(blocked on Wave 13 completion)*

- [ ] 03.1-06-PLAN.md — 迁移诚实三态 host smoke 与 loopback MCP 收据

**Wave 15** *(blocked on Wave 14 completion)*

- [ ] 03.1-13-PLAN.md — 建立 release helper 与 matching-tag npm publish workflow

**Wave 16** *(blocked on Wave 15 completion)*

- [ ] 03.1-15-PLAN.md — 建立退役状态机并持久化不可跳过的 pre-parity receipt

**Wave 17** *(blocked on Wave 16 completion)*

- [ ] 03.1-30-PLAN.md — 在最后一次 Python parity 后精确清理五个 owned cache roots

**Wave 18** *(blocked on Wave 17 completion)*

- [ ] 03.1-16-PLAN.md — 复验 receipt 后退役规范源与 QA Python runtime

**Wave 19** *(blocked on Wave 18 completion)*

- [ ] 03.1-24-PLAN.md — 退役 Dev Python 与 GitHub-raw update index并验证 post-source

**Wave 20** *(blocked on Wave 19 completion)*

- [ ] 03.1-17-PLAN.md — 分组退役 Python maintainer scripts

**Wave 21** *(blocked on Wave 20 completion)*

- [ ] 03.1-18-PLAN.md — 退役安装/生成/hook/update Python tests

**Wave 22** *(blocked on Wave 21 completion)*

- [ ] 03.1-25-PLAN.md — 退役剩余 Python tests/stub并验证 post-tests

**Wave 23** *(blocked on Wave 22 completion)*

- [ ] 03.1-20-PLAN.md — 先清理 marketplace 并协调 PROJECT/AGENTS/后续路线

**Wave 24** *(blocked on Wave 23 completion)*

- [ ] 03.1-19-PLAN.md — 在项目说明协调后更新 README 并运行唯一最终扫描

**Wave 25** *(blocked on Wave 24 completion)*

- [ ] 03.1-21-PLAN.md — 用 baseline/receipt 隔离提交 KCodeRag 权威指南

**Wave 26** *(blocked on Wave 25 completion)*

- [ ] 03.1-14-PLAN.md — 最终人工授权 exact seven-path bump 并以 receipt 验证首次公共 npm 发布

### Phase 4: 已部署项目与安装来源可靠性

**Goal:** 已部署项目能从根目录或子目录稳定加载当前 QA，并在任何项目写入前诊断用户级重复来源和环境冲突。
**Mode:** mvp
**Requirements**: DEP-01, DEP-02, DEP-03
**Depends on:** Phase 3
**Success Criteria** (what must be TRUE):

  1. `I:\JX3_SVN\Head` 的受管 QA 安装更新到当前发布版本，`status --json` 返回 `healthy`，且全局 QA/Dev 不重复生效。
  2. 从项目根目录和任意嵌套子目录启动 Codex 时，项目 hook 都能定位同一受管 launcher；路径策略和项目移动后的恢复方法有自动化测试与文档。
  3. 项目 install/update 在用户级 raw MCP、启用的 marketplace plugin 或 QA/Dev 跨来源冲突时保持写前硬停止，诊断不读取或输出凭据值。
  4. 为绕过项目安装器的原生 `codex plugin add` 用户提供只读 user-level doctor/status，明确给出清理来源，但不自动卸载或删除配置。

**Plans**: TBD

### Phase 5: 低误报 Hook 与诚实路由

**Goal:** hook 只在宽范围结构查找时提醒；精确文本、本地复核、常见 Lua 全局处理器和不可用索引都有低打扰且真实的路由。
**Mode:** mvp
**Requirements**: HOOK-06, HOOK-07, HOOK-08, ROUT-05
**Depends on:** Phase 4
**Success Criteria** (what must be TRUE):

  1. `-F/--fixed-strings` 配合多个明确文件、单文件及生成/日志文本核对保持静默；宽范围唯一 C++ 符号和限定 Lua 方法仍获得图优先建议。
  2. 深层窄目录和 `OnEvent`、`Update`、`OnLButtonClick` 等常见 Lua 全局处理器在明确 Lua scope 下保持限定本地搜索，不把用户引向已知同名碰撞。
  3. 已调用 KCodeRag 后的本地精确复核不会在同一轮反复收到结构提醒；若采用 PostToolUse 状态，其状态必须有界、环境无关且全异常 fail-open。
  4. nudge、skill 和权威指南默认推荐 `keyword`、`context`、`get_call_chain`；`semantic`/`hybrid` 仅在 `list_indexes` 证明确实可用时推荐，否则说明降级而不夸大能力。
  5. QA/Dev 共享回归同时覆盖 Codex Bash 与 Claude Grep/Glob，所有 advisory 保持非阻断和短超时。

**Plans**: TBD

### Phase 6: 真实宿主兼容与发布证据

**Goal:** 用户安装到实际 Codex、Claude Code 或 Cursor 后，可用可审计证据确认 MCP 工具名、hook/Rule 和更新路径真实工作。
**Mode:** mvp
**Requirements**: TEST-07, TEST-08, TEST-09
**Depends on:** Phase 5
**Success Criteria** (what must be TRUE):

  1. 干净 `CODEX_HOME` 上真实执行 marketplace/plugin 安装，验证 direct server map 注册 `kcoderag-qa` 工具并观察 hook advisory；不依赖开发者现有全局配置。
  2. Claude Code 以 project scope 真实安装 QA，验证工具注册名、Grep/Glob/Bash hook 出参、更新及卸载。
  3. Cursor 免费 local 插件真实完成 install、Reload Window、MCP/Rule/skill 可见性、update 和 uninstall。
  4. required CI 明确区分 loopback stub 契约与 authenticated host smoke；具备 runner 时可复跑 Windows/Linux launcher 和受支持宿主版本，不把 skipped 记作 PASS。
  5. 宿主证据、日志和制品扫描不泄露 URL header 或凭据值。

**Plans**: TBD

### Phase 7: GSD 运行时与全局 Hook 整理

**Goal:** Codex 中的 GSD 始终选择正确 runtime/isolation，且全局 GSD hook 只在真正需要的生命周期事件启动对应逻辑。
**Mode:** mvp
**Requirements**: GSD-01, GSD-02
**Depends on:** Phase 6
**Success Criteria** (what must be TRUE):

  1. 默认 Codex 安装从 `.gsd-runtime` 解析为 `codex/orchestrator-worktree`，显式 `GSD_RUNTIME=claude` 仍解析为 `claude/harness-worktree`。
  2. runtime 修复具有上游 issue/patch 或可在 GSD 更新后自动验证并安全重放的持久方案，不依赖不可见的一次性本地编辑。
  3. `gsd-context-monitor` 仅在 PostToolUse 注入上下文；PreCompact/Stop 只做必要状态落盘，其他事件不启动无效 Node 进程。
  4. `gsd-check-update` 保持独立的 SessionStart 职责，KCodeRag 的异步更新检查不与 GSD 全局 hook 混为同一所有者。

**Plans**: TBD

### Phase 8: 生产安全与自动化发布

**Goal:** 在不破坏内部 QA 装即用主路径的前提下，建立生产级身份、加密传输、可轮换凭据和可重复发布证据。
**Mode:** mvp
**Requirements**: SEC-01, SEC-02, SEC-03, REL-01, REL-02
**Depends on:** Phase 7
**Success Criteria** (what must be TRUE):

  1. 用户通过个人或组织身份取得短期凭据，公开或长期分发包不再包含共享 Bearer。
  2. MCP 使用 HTTPS 并验证服务身份，凭据可独立轮换而无需重新发布整个插件代码树。
  3. CI 从规范源生成、验证并发布版本化制品，发布与 GitHub `master` marketplace 安装路径的关系有清晰说明。
  4. 支持的 Codex、Claude Code、Python 与 Windows/Linux 组合具有自动兼容矩阵和明确淘汰策略。
  5. Cursor 免费本地插件、Codex 项目安装器和 Claude project-scope 仍保留低门槛安装与显式更新路径。

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 03.1 → 4 → 5 → 6 → 7 → 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. QA 优先的可重复插件包 | 1/1 | Complete    | 2026-08-23 |
| 2. 受管项目安装与环境生命周期 | 1/1 | Complete    | 2026-08-23 |
| 3. 可预测的单环境图导航 | 1/1 | Complete    | 2026-08-23 |
| 03.1. JavaScript 与 npx 安装运行时迁移 | 13/27 | In Progress|  |
| 4. 已部署项目与安装来源可靠性 | 0/TBD | Not planned | - |
| 5. 低误报 Hook 与诚实路由 | 0/TBD | Not planned | - |
| 6. 真实宿主兼容与发布证据 | 0/TBD | Not planned | - |
| 7. GSD 运行时与全局 Hook 整理 | 0/TBD | Not planned | - |
| 8. 生产安全与自动化发布 | 0/TBD | Not planned | - |
