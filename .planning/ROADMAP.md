# Roadmap: KCodeRag Nav

## Overview

Phase 1–3 已于 2026-08-23 根据 quick task 实现、当前代码和自动化测试完成回溯验证，并以
canonical plan/summary/verification/validation 收口。Phase 04 以 `0.2.0` 明确取代旧的公共 Dev
合同，将产品收敛为 QA-only，并完成项目根定位、来源诊断、公开发布和 Head 部署；后续路线再完成
低误报 hook、真实宿主 MCP 证据、GSD 运行时整理与生产安全。

## Phases

**Phase Numbering:**

- Integer phases (1–8): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: QA 优先的可重复插件包** - 从一份规范源生成并验证可立即使用的 QA 优先导航 MVP。 (completed 2026-08-23)
- [x] **Phase 2: 受管项目安装与环境生命周期** - 在不污染用户环境的前提下交付互斥的 QA/Dev 项目级安装、冲突保护与显式切换。 (completed 2026-08-23)
- [x] **Phase 3: 可预测的单环境图导航** - 让用户只查询当前安装环境，并在环境故障时获得明确、低打扰的 fallback 指引。 (completed 2026-08-23)
- [x] **Phase 4: 已部署项目与安装来源可靠性** - 交付 QA-only `0.2.0`、稳定最近项目 Hook 根、selected-host 来源诊断，并用公开 exact 制品迁移实际 Head。 (completed 2026-08-26)
- [x] **Phase 04.1: 多能力安装平台与代码规范提示** - 将导航 CLI 重构为可独立管理导航与写前规范提示的多能力项目安装平台。 (completed 2026-08-27)
- [x] **Phase 04.2: 公开版本去品牌化** - 从 `0.3.0` 起以中性名称发布代码规范能力，并以源码与 npm 制品零命中门禁防止品牌词回归。 (completed 2026-08-30)
- [ ] **Phase 5: 统一 Hook 策略与真实宿主验证** - 统一低打扰提示与节流策略，并以五宿主原生事件证明 exact package 的真实行为。

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
**Plans:** 31/31 plans complete

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

- [x] 03.1-05-PLAN.md — 迁移 index-byte-preserving pre-commit、真实 pack 审计与四 lane required CI

**Wave 14** *(blocked on Wave 13 completion)*

- [x] 03.1-06-PLAN.md — 迁移诚实三态 host smoke 与 loopback MCP 收据

**Wave 15** *(blocked on Wave 14 completion)*

- [x] 03.1-13-PLAN.md — 建立 release helper 与 matching-tag npm publish workflow

**Wave 16** *(blocked on Wave 15 completion)*

- [x] 03.1-15-PLAN.md — 建立退役状态机并持久化不可跳过的 pre-parity receipt

**Wave 17** *(blocked on Wave 16 completion)*

- [x] 03.1-30-PLAN.md — 在最后一次 Python parity 后精确清理五个 owned cache roots

**Wave 18** *(blocked on Wave 17 completion)*

- [x] 03.1-16-PLAN.md — 复验 receipt 后退役规范源与 QA Python runtime

**Wave 19** *(blocked on Wave 18 completion)*

- [x] 03.1-24-PLAN.md — 退役 Dev Python 与 GitHub-raw update index并验证 post-source

**Wave 20** *(blocked on Wave 19 completion)*

- [x] 03.1-17-PLAN.md — 分组退役 Python maintainer scripts

**Wave 21** *(blocked on Wave 20 completion)*

- [x] 03.1-18-PLAN.md — 退役安装/生成/hook/update Python tests

**Wave 22** *(blocked on Wave 21 completion)*

- [x] 03.1-25-PLAN.md — 退役剩余 Python tests/stub并验证 post-tests

**Wave 23** *(blocked on Wave 22 completion)*

- [x] 03.1-20-PLAN.md — 先清理 marketplace 并协调 PROJECT/AGENTS/后续路线

**Wave 24** *(blocked on Wave 23 completion)*

- [x] 03.1-19-PLAN.md — 在项目说明协调后更新 README 并运行唯一最终扫描

**Wave 25** *(blocked on Wave 24 completion)*

- [x] 03.1-21-PLAN.md — 用 baseline/receipt 隔离提交 KCodeRag 权威指南

**Wave 26** *(blocked on Wave 25 completion)*

- [x] 03.1-14-PLAN.md — 最终人工授权 exact seven-path bump 并以 receipt 验证首次公共 npm 发布

### Phase 4: 已部署项目与安装来源可靠性

**Goal:** 公共 `kcoderag-nav` 自 `0.2.0` 起只安装 QA；已部署项目能从根目录、子目录或移动后位置稳定加载最近受管 QA，并在任何 install/update 写入前以 selected-host、secret-safe 方式诊断和治理用户级来源，最终通过不可变 fix-forward 用公开 exact `0.2.2` 迁移并验收实际 Head。
**Mode:** mvp
**Requirements**: DEP-01, DEP-02, DEP-03
**Depends on:** Phase 03.1
**Success Criteria** (what must be TRUE):

  1. **D-01/D-02:** 公共 CLI、npm allow-list、生成树和用户文档只提供 QA；Dev 仅能作为完整所有权、无漂移的 legacy 状态被显式迁移或卸载，新安装没有 Dev flag、prompt 或 product。
  2. **D-05–D-08:** Codex/Claude Hook 从 cwd 向上选择最近状态边界；root/deep/Unicode/nested/moved 行为可复跑，损坏最近边界静默 fail-open 且不穿透；危险全局 target 被拒绝而普通非 VCS 目录可用。
  3. **D-03/D-09–D-16:** status 快速、doctor 深扫且二者只读；selected-host active source 产生 `source_conflict`/`ok:false` 并阻断 install/update。owned source 清理权限独立且绑定冻结 fingerprint，raw/manual/ambiguous 来源只允许人工清理，任何输出均不含连接或凭据值。
  4. **D-04:** 实现、测试、审查、pack、四通道 CI 和公开制品门禁全部通过后直接发布不可变 `0.2.0`；真实验收发现的缺陷只通过 `0.2.1`/`0.2.2` 前进修复，不设置回退或 unpublish 路径。
  5. **D-17–D-19:** 内部 Head 验收项目使用公开 exact `kcoderag-nav@0.2.2` 完成 Codex、Claude Code、Cursor QA-only 部署；最终三宿主 healthy、无活动重复来源，Codex/Claude 根/Unicode 深层/空格深层 Hook 指向同一项目。
  6. **D-20:** 公开版本后的真实迁移失败保持项目事务恢复原状，npm/tag/latest 不回退或 unpublish；0.2.0 的解析问题和 0.2.1 的 Windows 并发 launcher 问题均以 0.2.2 修复前进并重新验收。
  7. README 与 KCodeRag 权威指南在删除公共 Dev 代码/资产前先同步 QA-only 合同；Phase 05 Hook 精度、Phase 06 真实 MCP 查询、Phase 07 GSD Hook、Phase 08 身份/HTTPS/轮换和 OpenCode 实现保持未交付。

**Plans:** 19/19 plans complete

- [x] 04-01-PLAN.md
- [x] 04-02-PLAN.md
- [x] 04-03-PLAN.md
- [x] 04-04-PLAN.md
- [x] 04-05-PLAN.md
- [x] 04-06-PLAN.md
- [x] 04-07-PLAN.md
- [x] 04-08-PLAN.md
- [x] 04-09-PLAN.md
- [x] 04-10-PLAN.md
- [x] 04-11-PLAN.md
- [x] 04-12-PLAN.md
- [x] 04-13-PLAN.md
- [x] 04-14-PLAN.md
- [x] 04-15-PLAN.md
- [x] 04-16-PLAN.md
- [x] 04-17-PLAN.md
- [x] 04-18-PLAN.md
- [x] 04-19-PLAN.md

**Wave 1**

- [x] `04-01-PLAN.md` — 建立 QA-only canonical contract 并同步 managed AGENTS

**Wave 2** *(blocked on Wave 1)*

- [x] `04-14-PLAN.md` — 先同步根 README 与唯一权威 KCodeRag 体验指南

**Wave 3** *(blocked on Wave 2)*

- [x] `04-02-PLAN.md` — 收敛公共 CLI/current state 为 QA-only 并拒绝危险全局 target

**Wave 4** *(blocked on Wave 3)*

- [x] `04-03-PLAN.md` — 为三宿主实现明确授权、无漂移的 legacy Dev→QA 迁移
- [x] `04-07-PLAN.md` — 将 canonical generator/routing 产品图收敛为 QA 与 Cursor

**Wave 5** *(blocked on Wave 4)*

- [x] `04-04-PLAN.md` — 实现最近状态 Hook 根发现和 rootless Codex/Claude bootstrap
- [x] `04-09-PLAN.md` — 再生并关闭 Cursor QA 非文档产品

**Wave 6** *(blocked on Wave 5)*

- [x] `04-05-PLAN.md` — 建立 immutable source findings、status/doctor 分流与 Codex cleanup plan
- [x] `04-08-PLAN.md` — 再生完整 QA Hook runtime 与双平台 launcher

**Wave 7** *(blocked on Wave 6)*

- [x] `04-06-PLAN.md` — 完成 Claude/Cursor selected-host diagnosis 与安全 cleanup 边界
- [x] `04-17-PLAN.md` — 再生 QA registration、opaque MCP metadata 与导航资产

**Wave 8** *(blocked on Wave 7)*

- [x] `04-10-PLAN.md` — 从 npm allow-list 与宿主发现 manifest 移除 Dev

**Wave 9** *(blocked on Wave 8)*

- [x] `04-18-PLAN.md` — 删除 Dev executable/registration/guidance，保留 exact legacy decoder

**Wave 10** *(blocked on Wave 9)*

- [x] `04-11-PLAN.md` — 关闭 QA/Cursor pack inventory、pre-release 与 Head acceptance validator

**Wave 11** *(blocked on Wave 10)*

- [x] `04-12-PLAN.md` — 只读推导并验证 exact five-path `0.2.0` release state

**Wave 12** *(blocked on Wave 11)*

- [x] `04-13-PLAN.md` — 扩展 real-package smoke、pre-commit 与 ordinary/release CI gates

**Wave 13** *(blocked on Wave 12)*

- [x] `04-19-PLAN.md` — 生成最终 QA/Cursor 文档并审计权威 sibling guide

**Wave 14** *(blocked on Wave 13)*

- [x] `04-15-PLAN.md` — 冻结 subject，创建 `0.2.0` direct-child commit/tag 并经四通道发布

**Wave 15** *(blocked on Wave 14)*

- [x] `04-16-PLAN.md` — 以不可变 fix-forward 的公开 exact `0.2.2` 完成三宿主 Head 验收并记录偏差

### Phase 04.1: 多能力安装平台与代码规范提示 (INSERTED)

**Goal:** As a 使用受支持 AI 编码宿主的开发者, I want to 按项目选择并管理导航与代码规范提示能力, so that 我能在保持能力隔离和低打扰的前提下，于写代码前获得所需规范提示.
**Mode:** mvp
**Requirements**: PLAT-01, PLAT-02, PLAT-03, LEG-01, STYLE-01, TEST-10
**Depends on:** Phase 4
**Success Criteria** (what must be TRUE):

  1. 五个 CLI 命令可按单宿主管理显式选择的能力集合；状态、文件和配置 section 的所有权按 capability 记录，卸载一个能力不会破坏其他能力或用户配置。
  2. KCodeRag QA 导航通过统一 capability contract 接入；共享 Hook dispatcher 有界组合各能力提示，单个能力异常不会阻断宿主操作。
  3. `code-style-nudge` 仅在首次相关 C/C++、头文件或 Lua 写入前提醒加载 `$code-style-correction`；不运行 SVN、Python 扫描器或网络请求，也不宣称已经完成规范审核。
  4. 对旧手工 MCP、marketplace/plugin、Python Hook 和多来源冲突只进行 secret-safe 检测，并在写入前硬停止；用户人工清理后可以重试。
  5. 自动化覆盖能力组合、独立更新与卸载、共享配置合成、事务回滚和 legacy 硬停止；公共包继续保持 Node.js 22+、零生产依赖、零 Python 运行时。

**Plans:** 13/13 plans complete

Plans:
**Wave 1**

- [x] 04.1-01-PLAN.md
- [x] 04.1-02-PLAN.md
- [x] 04.1-03-PLAN.md

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 04.1-04-PLAN.md
- [x] 04.1-05-PLAN.md

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 04.1-06-PLAN.md

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 04.1-07-PLAN.md

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 04.1-08-PLAN.md

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 04.1-09-PLAN.md
- [x] 04.1-10-PLAN.md

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 04.1-11-PLAN.md

**Wave 8** *(blocked on Wave 7 completion)*

- [x] 04.1-12-PLAN.md

**Wave 9** *(blocked on Wave 8 completion)*

- [x] 04.1-13-PLAN.md

### Phase 04.2: 公开版本去品牌化 (INSERTED)

**Goal:** As a 公共 kcoderag-nav 维护者, I want to 从 0.3.0 起使用不含游戏或公司品牌词的中性代码规范能力, so that 公共源码和 npm 制品保留相同行为与规则而不暴露品牌身份.
**Mode:** mvp
**Requirements**: BRAND-01, BRAND-02, BRAND-03, BRAND-04
**Depends on:** Phase 04.1
**Success Criteria** (what must be TRUE):

  1. 内置能力、Skill、Hook、源码文件、生成目录和用户提示统一使用 `code-style-nudge` 与 `$code-style-correction` 等中性名称，不保留旧 capability ID、Skill 名或兼容别名。
  2. 当前 Git HEAD 的全部跟踪文件通过大小写、Unicode 和常见分隔变体的品牌词零命中门禁；历史 Git 提交不重写，旧 tag、release 和 npm 版本不修改或撤回。
  3. `npm pack --dry-run` 的文件名与最终内容（包括编译 CJS、模板和生成资产）通过同一零命中门禁；门禁自身不以原始品牌词制造自命中。
  4. R01–R19、S01–S08、E01–E15 规则内容、首次相关写入提示、fail-open、能力组合、事务回滚和宿主版本证据保持行为等价。
  5. 根版本前进到 `0.3.0`，完整 CI、确定性生成、pack audit、五宿主 required packaged smoke、公开文档及本仓库 `docs/MCP_QA_EXPERIENCE_GUIDE.md` 通过后才具备发布条件；兄弟仓库指南不再更新或绑定，本阶段不创建 tag、不 publish、不执行 registry refetch、unpublish 或历史清理。

**Plans:** 45/45 plans complete

Plans:

- [x] 04.2-43-PLAN.md
- [x] 04.2-44-PLAN.md
- [x] 04.2-45-PLAN.md

- [x] 04.2-01-PLAN.md
- [x] 04.2-02-PLAN.md
- [x] 04.2-03-PLAN.md
- [x] 04.2-04-PLAN.md
- [x] 04.2-05-PLAN.md
- [x] 04.2-06-PLAN.md
- [x] 04.2-07-PLAN.md
- [x] 04.2-08-PLAN.md
- [x] 04.2-09-PLAN.md
- [x] 04.2-10-PLAN.md
- [x] 04.2-11-PLAN.md
- [x] 04.2-12-PLAN.md
- [x] 04.2-13-PLAN.md
- [x] 04.2-14-PLAN.md
- [x] 04.2-15-PLAN.md
- [x] 04.2-16-PLAN.md
- [x] 04.2-17-PLAN.md
- [x] 04.2-18-PLAN.md
- [x] 04.2-19-PLAN.md
- [x] 04.2-20-PLAN.md
- [x] 04.2-21-PLAN.md
- [x] 04.2-22-PLAN.md
- [x] 04.2-23-PLAN.md
- [x] 04.2-24-PLAN.md
- [x] 04.2-25-PLAN.md
- [x] 04.2-26-PLAN.md
- [x] 04.2-27-PLAN.md
- [x] 04.2-28-PLAN.md
- [x] 04.2-29-PLAN.md
- [x] 04.2-30-PLAN.md
- [x] 04.2-31-PLAN.md
- [x] 04.2-32-PLAN.md
- [x] 04.2-33-PLAN.md
- [x] 04.2-34-PLAN.md
- [x] 04.2-35-PLAN.md
- [x] 04.2-36-PLAN.md
- [x] 04.2-37-PLAN.md
- [x] 04.2-38-PLAN.md
- [x] 04.2-39-PLAN.md
- [x] 04.2-40-PLAN.md
- [x] 04.2-41-PLAN.md
- [x] 04.2-42-PLAN.md

**Cross-cutting constraints:**

- D-02/D-14：本计划只处理显式paths；每批从immutable commit验证zero-hit且public output不含raw path/match。
- 每批编辑前记录private dirty path+hunk baseline，重叠则blocking checkpoint，未重叠才精确stage/commit。
- Phase03.1 npx/runtime历史语义保持。
- Phase04 deployment assurance历史语义保持。
- D-02：Phase04.2 PLAN artifacts自身进入immutable Git zero-hit，无planning例外。
- 中性化不改变D-01–D-18、BRAND-01–04、tasks、commands或evidence语义。
- D-02：Phase04.2 SUMMARY artifacts自身进入immutable Git zero-hit，无planning例外。

### Phase 5: 统一 Hook 策略与真实宿主验证

**Goal:** 用户在 Codex、Claude Code、Cursor、OpenCode 与 ZCode 中获得统一但宿主诚实的低打扰导航策略；每一种项目级提示、成功 marker、更新行为和 MCP 路径都由同一 exact package 的契约测试与真实宿主事件留下可审计证据。
**Mode:** mvp
**Requirements**: HOOK-06, HOOK-07, HOOK-08, ROUT-05, TEST-07, TEST-08, TEST-09, TEST-11
**Depends on:** Phase 04.2
**Success Criteria** (what must be TRUE):

  1. 具备受支持 `SessionStart` 生命周期的宿主在 `startup`、`resume`、`clear` 与 `compact` 后恢复有界、条件化的 KCodeRag 使用方式、离线更新信息与受支持代码规范；Cursor/OpenCode 只投影其真实 Rule/plugin 能力，不伪装等价 Hook。
  2. 导航、代码规范和 `submit_feedback` 提示只在对应语义首次命中时出现，后续匹配静默；任何按会话、context epoch、时间或语义次数重新武装的政策都必须有界、secret-free、并发安全且全异常 fail-open，不能按原始工具总调用数刷屏。
  3. `-F/--fixed-strings`、多个明确文件、单文件、生成/日志文本、深层窄目录及常见 Lua 全局处理器保持限定本地搜索；宽范围唯一 C++ 符号和限定 Lua 方法获得图优先建议，且只有 `list_indexes` 证明可用时才推荐 `semantic`/`hybrid`。
  4. 同一 exact tgz 或公开 exact npx 版本在干净项目中完成五宿主 install/status/update/uninstall、MCP、Hook/Rule/plugin、成功 marker 与更新路径；live PASS 必须由真实宿主触发原生事件，直接执行 launcher 只算 packaged contract，`NOT_RUN` 或 skipped 不得完成阶段。
  5. Windows/Linux 适用 runner 可复跑 exact package 与宿主证据；authenticated QA 协商目标 MCP protocol 并返回合规结构化工具结果，所有 receipt、日志和制品保持 metadata-only 且不泄露 URL、Header、Bearer、工具参数或响应正文。

**Plans:** 5/6 plans executed

Plans:

- [x] 05-01-PLAN.md
- [x] 05-02-PLAN.md
- [x] 05-03-PLAN.md
- [x] 05-04-PLAN.md
- [x] 05-05-PLAN.md
- [ ] 05-06-PLAN.md

- [x] `05-01-PLAN.md` — 以 Codex exact-tgz SessionStart tracer 建立统一事件、governor、精度、索引门禁与 feedback 状态机
- [x] `05-02-PLAN.md` — 将共享策略诚实投影到 Claude、Cursor、OpenCode 与 ZCode 的真实原生表面
- [ ] `05-03-PLAN.md` — 从 canonical source 确定性生成 QA runtime/config/guidance family
- [ ] `05-04-PLAN.md` — 关闭 PASS/FAIL/NOT_RUN receipt、五宿主 coordinator 与 independently passing actual tgz
- [ ] `05-05-PLAN.md` — 建立受保护 exact-artifact workflow 并在 dispatch 前封存 immutable candidate
- [ ] `05-06-PLAN.md` — 消费已授权 exact candidate run，仅提交五宿主 authenticated LIVE evidence 与宿主诚实指南

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 03.1 → 4 → 04.1 → 04.2 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. QA 优先的可重复插件包 | 1/1 | Complete    | 2026-08-23 |
| 2. 受管项目安装与环境生命周期 | 1/1 | Complete    | 2026-08-23 |
| 3. 可预测的单环境图导航 | 1/1 | Complete    | 2026-08-23 |
| 03.1. JavaScript 与 npx 安装运行时迁移 | 31/31 | Complete    | 2026-08-24 |
| 4. 已部署项目与安装来源可靠性 | 19/19 | Complete    | 2026-08-26 |
| 04.1. 多能力安装平台与代码规范提示 | 13/13 | Complete    | 2026-08-27 |
| 04.2. 公开版本去品牌化 | 45/45 | Complete    | 2026-08-30 |
| 5. 统一 Hook 策略与真实宿主验证 | 5/6 | In Progress|  |

### Phase 6: 四 Skill 公共接口与宿主交付模式

**Goal:** 用户可在 Codex、Claude Code、Cursor、OpenCode 与 ZCode 中直接调用四个名称稳定、职责清晰的 KCodeRag Skill；代码规范手动 Skill 对五宿主可用，自动写前提示仍只由真实宿主证据门禁启用，并由 status/doctor 分别报告两种交付模式。
**Requirements**: None — Phase 06 was added without mapped requirement IDs; locked CONTEXT decisions are the acceptance source.
**Depends on:** None for implementation execution — the user explicitly authorized Phase 06 to run before Phase 05 LIVE closure on 2026-09-03. Phase 05 evidence remains independently incomplete and must not be claimed by this phase.
**Success Criteria** (what must be TRUE):

  1. 五宿主安装后只暴露 `$kcoderag`、`$kcoderag-manage`、`$kcoderag-feedback` 与 `$kcoderag-code-style` 四个公开 Skill，不保留 `code-lookup-discipline` 或 `code-style-correction` 兼容别名。
  2. `$kcoderag` 只负责只读代码导航；`$kcoderag-manage` 默认只读 status/doctor、仅在明确要求时 update，且默认不 cleanup/uninstall；`$kcoderag-feedback` 通过反馈接口提交真实查询评价；`$kcoderag-code-style` 支持自然语言写前指导和 `review <文件或当前变更>`，不提供 `apply` 子命令。
  3. 内部 capability 仍固定为 `kcoderag-navigation` 与 `code-style-nudge`；五宿主均可安装手动代码规范 Skill，仅冻结 PASS receipt 对应的 Claude Code 2.1.241 投影自动写前提示。
  4. status/doctor 以 secret-safe、状态完整性可证明的方式分别报告 `manualSkill` 与 `automaticNudge`，更新/卸载按所有权安全重组旧 Skill 路径并保留无关文件。
  5. Codex 的四个 Skill 均包含一致的 `agents/openai.yaml`，生成、打包、五宿主 smoke、文档和完整 CI 对四公开 Skill/两内部 capability 模型达成一致。

**Plans:** 1 convergence plan

Plans:
**Wave 1**

- [ ] 06-01-PLAN.md — 采用既有 RED 与 staged GREEN，在首次实现提交前一次性收敛 canonical、generated、五宿主、文档、审计、pack 与 smoke，并通过真实 pre-commit

**Dependency notes:** 旧 13-plan 集合已由 `06-SUPERSEDED.md` 明确取代并从可执行 PLAN 扫描中移除。仓库 pre-commit 对任一 managed staged path 都检查完整 canonical/generated 集合并运行全局门禁，因此中间实现提交无法在不绕过 Hook 的情况下成立；`06-01-PLAN.md` 保留 `c821975` RED 提交并以一个正常 Hook 验证的 GREEN 提交闭合全部 D-01–D-13。
