# Requirements: KCodeRag Nav

**Defined:** 2026-08-20
**Core Value:** 用户通过统一 npx CLI 即可在所选宿主和明确项目边界内获得可靠、低打扰、QA 图优先的导航体验。

> Phase 1–3/03.1 的勾选项记录当时已经交付的 QA/Dev 合同。Phase 04 的 D-01 以公开
> `0.2.0` QA-only 合同取代其当前产品效力，但不改写这些历史完成事实；Dev 只保留精确 legacy
> 解码、迁移和卸载兼容。Phase 04.1 再以尚无公开用户的多能力平台合同取代旧 CLI、旧状态
> schema 和 QA/Dev 迁移兼容实现；pre-npm 手工来源只读检测并硬停止，不迁移或自动清理。

## v1 Requirements

### 安装与分发

- [x] **PKG-01**: 用户可独立安装、使用和卸载 QA 插件
- [x] **PKG-02**: 用户可独立安装、使用和卸载 Dev 插件
- [x] **PKG-03**: 普通用户文档默认只引导安装 QA，并明确 QA 与 Dev 互斥
- [x] **PKG-04**: 用户安装后无需额外索取或配置 Bearer 凭据即可连接对应环境
- [x] **PKG-05**: 默认项目安装将 QA hook、skill 与 MCP 配置部署到目标仓库自己的 `.codex/` 和 `.agents/`
- [x] **PKG-06**: 用户必须通过显式参数选择 Dev；切换环境前必须先卸载当前受管安装

### 环境路由

- [x] **ROUT-01**: 项目安装器拒绝 QA 与 Dev 同时安装
- [x] **ROUT-02**: 导航只查询当前安装的单一环境
- [x] **ROUT-03**: QA 与 Dev 环境切换必须先显式卸载当前环境
- [x] **ROUT-04**: 目标环境不可达时明确报告，不静默切换环境；索引不可用或陈旧时允许明确退回本地搜索

### Hook 行为

- [x] **HOOK-01**: 结构化 `Grep`、`Glob` 和 shell 搜索会收到图优先导航提示
- [x] **HOOK-02**: 导航 nudge 不创建跨环境所有权 marker；异步更新检查或同轮本地复核可使用有界、fail-open 的 cache/session marker
- [x] **HOOK-03**: hook 解析失败或输入异常时保持 fail-open，不阻止原始工具调用
- [x] **HOOK-04**: 精确文本、日志、单文件和未提交改动搜索继续使用本地工具
- [x] **HOOK-05**: 已修复的命令解析形式全部保留自动化回归覆盖

### 生成式发布

- [x] **GEN-01**: hook、skill 和共享测试只维护一份规范源
- [x] **GEN-02**: 生成器产出两个自包含、可独立安装的 QA 与 Dev 插件
- [x] **GEN-03**: 生成过程保留各环境的名称、MCP 地址、Bearer 和权限命名空间
- [x] **GEN-04**: 生成器提供只读检查模式，能够发现生成产物漂移且不修改文件
- [x] **GEN-05**: 相同输入重复生成得到内容一致的安装产物

### 验证与兼容

- [x] **TEST-01**: 共享 hook 测试同时验证 QA 与 Dev 生成产物
- [x] **TEST-02**: 自动校验 marketplace、plugin manifest、hook 和 MCP 路径
- [x] **TEST-03**: 自动验证仅 QA、仅 Dev、跨环境安装冲突以及显式卸载切换场景
- [x] **TEST-04**: 自动验证单环境路由、不可达语义、本地 fallback、无跨环境所有权 marker 及有界更新状态
- [x] **TEST-05**: 插件保持 Codex 支持与现有 Claude Code 兼容路径
- [x] **TEST-06**: 项目安装与卸载验证用户级 Codex 配置、插件缓存和无关项目文件保持不变

## v1.1 Hardening Requirements

### JavaScript 与 npx 运行时迁移

- [x] **JS-01**: Hook、更新检查、安装器、生成器、pre-commit、smoke 与测试使用 TypeScript 维护源码并构建为 Node.js 可直接执行的 CJS，发布包不包含 Python 运行代码或运行时编译器
- [x] **JS-02**: 用户通过公共 `kcoderag-nav` 包的统一 npx CLI 完成 install/status/doctor/update/uninstall，根 `package.json` 是唯一版本源
- [x] **JS-03**: Codex、Claude Code 与 Cursor 使用各自原生项目配置和可扩展 host adapter，一次命令只修改一个所选宿主
- [x] **JS-04**: 旧 Python 安装在无漂移时安全迁移；所有变更遵守受管所有权、写前校验和单宿主原子回滚
- [x] **JS-05**: CJS hook 保持 advisory/fail-open，更新检查只在后台查询 npm Registry latest，具备 24 小时缓存且已安装路径可离线运行
- [x] **JS-06**: Node 生成器、pre-commit 与 npm pack 检查能证明生成确定性、版本一致、自包含和无 Python/未解析占位符
- [x] **JS-07**: CI 覆盖 Windows/Linux 与 Node.js 22/24；只有匹配 package 版本的 `vX.Y.Z` 标签可触发 npm 发布，普通 master push 只测试
- [x] **JS-08**: Node 测试与 loopback smoke 覆盖三宿主生命周期、hook/Rule、MCP 证据、离线行为和诚实 PASS/FAIL/NOT_RUN，README 与唯一权威体验指南同步 npx 流程

### 已部署项目与安装来源

- [x] **DEP-01 — QA-only 公开发布与 Head 部署（D-01、D-02、D-04、D-17–D-20）**:
  公共 `kcoderag-nav` 自 `0.2.0` 起、CLI、生成资产和用户文档只提供 QA；Dev 只由严格 legacy
  解码器读取，并且迁移需要独立明确授权。实现、测试、审查、pack、四通道 CI 与公开制品门禁
  全部通过后无需再次人工审批即可发布。`I:\JX3_SVN\Head` 最终必须使用公开 exact `0.2.2`
  完成三宿主 QA-only 部署，Codex/Claude 还需通过 root/deep Hook 复核；最终 healthy、无活动重复
  来源。若已发布制品在真实迁移中失败，项目事务回滚但 npm 版本、tag 和 latest 保持不可变，
  只能以前进版本修复；本阶段实际由 `0.2.0` 经 `0.2.1` 前进到已验收的 `0.2.2`。

- [x] **DEP-02 — 项目边界与可移动 Hook 根定位（D-05–D-08）**:
  Codex/Claude Hook 从会话 cwd 有界向上查找所选宿主最近的 `kcoderag-nav/install-state.json`，
  根目录、Unicode/空格深层子目录和完整移动/改名/换盘副本均定位同一受管 launcher；嵌套项目
  最近状态优先，且最近状态损坏、版本不兼容或 launcher 缺失时静默 fail-open，绝不穿透到外层。
  CLI 的 cwd/`--target` 始终是精确目标；文件系统根、用户主目录和宿主用户级 config/plugin/cache
  根被拒绝，普通非 VCS 目录仍可安装。

- [x] **DEP-03 — selected-host、secret-safe 来源诊断与清理权限（D-03、D-09–D-16）**:
  `status` 快速报告项目状态、版本、漂移和来源冲突摘要；`doctor` 深扫所选宿主的 plugin、raw MCP、
  manual Hook、cache/disabled residue，并在未安装项目上给出安装前就绪结论。活动来源导致顶层
  `source_conflict`、`ok:false` 并在 install/update 写前硬停止；uninstall 只受项目自身漂移约束。
  每个 finding 只含稳定 code、severity、source type、scope、安全路径及经验证的宿主原生清理命令，
  不读取、比较、记录或输出 URL/Header/Bearer。只有所有权明确的旧 plugin/marketplace source
  可形成冻结清理计划；授权必须独立绑定该计划的精确 fingerprint，非交互自动化必须传完全匹配的
  cleanup authority。一般 `--yes`、发布授权和 legacy migration authority 均不能替代。raw MCP、
  manual Hook 或 ambiguous source 永远只提示人工清理，不提供 `doctor --fix` 或自动删除。

#### Phase 04 可观察验收分类

| Requirement | Classification | Required evidence |
|-------------|----------------|-------------------|
| DEP-01 | release/deployment | immutable `0.2.0` 起点、exact public `0.2.2` identity、四通道 CI、pack/public receipt、三宿主 Head healthy/clean 与 fix-forward 证据 |
| DEP-02 | runtime/path safety | root/deep/nested/damaged/moved 跨平台自动化，危险全局 target 拒绝和普通非 VCS target 成功 |
| DEP-03 | diagnostics/authority | selected-host source fixtures、只读 status/doctor、secret sentinels 不出现在输出、指纹不匹配零写入 |

### 多能力安装平台与 JX3 规范提示

- [ ] **PLAT-01**: 公共 npm 包以内置 capability manifest 注册 KCodeRag navigation 与 `jx3-style-nudge`；安装状态、受管文件、摘要和配置 section 按 capability 记录，同一宿主所选能力集合通过一次事务原子提交，独立更新或卸载不会破坏其他能力、宿主或用户配置
- [ ] **PLAT-02**: 五个 CLI 命令支持 capability 粒度的安全语义：交互 install 在单宿主内多选，自动化重复传 `--capability`；status/doctor 默认展示所选宿主全部能力，update 默认更新全部已安装能力且可筛选，uninstall 必须交互选择或显式指定
- [ ] **PLAT-03**: 一份包内 canonical Skill/handler 资产由 Codex、Claude Code、Cursor 与 OpenCode adapter 确定性投影到宿主原生项目路径；写前能力必须通过真实宿主 fixture 证明结构化目标路径、稳定会话标识和非阻断模型上下文注入，宿主版本未知、不可解析、过低或未证明时只拒绝该能力而不伪装降级
- [ ] **LEG-01**: 删除尚未公开使用的旧 CLI、旧状态 schema 和 QA/Dev 迁移兼容逻辑；对 pre-npm 手工 MCP、marketplace/plugin、Python Hook 和多来源冲突仅做 secret-safe、只读检测并在写前硬停止，不迁移、接管或自动删除
- [ ] **JX3-01**: `jx3-style-nudge` 以纯 CJS/JS Hook 配合受管 Markdown `$jx3-code-style-correction` Skill 工作，只在每个稳定宿主会话首次相关 C/C++/头文件/Lua 内容写入前注入一次短提示；无稳定会话 ID、资产漂移或任何运行异常均静默 fail-open，且不运行 Python、SVN、网络、逐次 PostToolUse scanner 或宣称静态扫描通过
- [ ] **TEST-10**: 自动化覆盖 capability 组合与独立生命周期、共享配置/Hook 合成、版本门禁、扩展名和结构化写入过滤、一次性并发 marker、资产漂移、legacy 来源硬停止、事务回滚、secret-safe 输出、Node.js 22/24 及 Windows/Linux；真实宿主 fixture 明确记录每个支持版本的 delivery evidence

### Hook 精度与能力诚实性

- [ ] **HOOK-06**: fixed-string、多明确文件、单文件、日志和生成文本等本地核对保持静默
- [ ] **HOOK-07**: 深层窄目录与常见 Lua 全局处理器在明确 scope 下保留限定本地搜索，唯一 C++ 符号和限定 Lua 方法仍获得图优先建议
- [ ] **HOOK-08**: 已使用 KCodeRag 后的同轮本地精确复核不会重复收到结构提醒；任何去重状态有界且 fail-open
- [ ] **ROUT-05**: nudge、skill 和指南仅在索引真实可用时推荐 semantic/hybrid，否则默认 keyword/context/call-chain 并明确降级

### 真实宿主验证

- [ ] **TEST-07**: 在干净项目和隔离 Codex 配置中，通过已发布的 exact `kcoderag-nav` npx 版本真实验证 install/status、direct MCP 工具注册、hook 出参、update 与 uninstall
- [ ] **TEST-08**: 在干净 Claude Code 项目中，通过同一 exact npx 包真实验证 install/status、MCP、Grep/Glob/Bash hook、update 与 uninstall
- [ ] **TEST-09**: 在干净 Cursor 项目中，通过同一 exact npx 包真实验证 install/status、必要 reload 后的 MCP/Rule/skill、update 与 uninstall

### GSD 运行时与 Hook

- [ ] **GSD-01**: GSD 在 Codex 中从安装 runtime marker 选择 orchestrator-worktree，并保留显式 Claude override 与可持久重放的回归保护
- [ ] **GSD-02**: 全局 GSD context monitor 只在必要事件启动相应逻辑，不在无意义事件重复启动 Node

## v2 Requirements

### 凭据与传输

- [ ] **SEC-01**: 用户通过个人或组织身份获取短期凭据，而不是共享内置 Bearer
- [ ] **SEC-02**: MCP 连接使用 HTTPS 并验证服务身份
- [ ] **SEC-03**: 维护者可以轮换凭据而无需重新发布完整插件

### 发布自动化

- [ ] **REL-01**: 只有与根 `package.json` 版本匹配的 `vX.Y.Z` 标签可触发 CI 重新生成、验证并发布公共 `kcoderag-nav` npm 包；普通 `master` push 只测试
- [ ] **REL-02**: 支持的 Codex、Claude Code、Cursor、Node.js 22/24 与 Windows/Linux 组合具有自动兼容矩阵和明确淘汰策略

## Out of Scope

| Feature | Reason |
|---------|--------|
| QA 与 Dev 同时启用 | 两个环境采用互斥安装模式 |
| 安装一个环境时自动卸载另一个环境 | 环境切换必须由用户显式发起，避免隐式删除 |
| 强制安装第三个公共 core 插件 | QA 与 Dev 都必须能够单独完整工作 |
| QA 不可达时自动回退 Dev | 会隐藏环境故障并可能返回错误环境的数据 |
| 修改 KCodeRag MCP 服务或图数据 | 本仓库只负责插件分发和导航策略 |
| 宿主 marketplace 的 project-scope plugin install | 用户入口统一为 npx 管理宿主原生项目配置，不依赖 marketplace scope |
| 公开或隐藏的 Dev 安装能力 | D-01 自 `0.2.0` 起将公共产品收敛为 QA-only；Dev 仅是 legacy decode input |
| 自动清理 raw MCP、manual Hook 或 ambiguous source | D-03/D-11 要求人工清理；无明确所有权时不存在删除授权 |

## Traceability

路线图创建时填充；每个 v1 requirement 必须映射到且仅映射到一个阶段。

| Requirement | Phase | Status |
|-------------|-------|--------|
| PKG-01 | Phase 1 | Complete |
| PKG-02 | Phase 2 | Complete |
| PKG-03 | Phase 1 | Complete |
| PKG-04 | Phase 1 | Complete |
| PKG-05 | Phase 1 | Complete |
| PKG-06 | Phase 2 | Complete |
| ROUT-01 | Phase 3 | Complete |
| ROUT-02 | Phase 3 | Complete |
| ROUT-03 | Phase 3 | Complete |
| ROUT-04 | Phase 3 | Complete |
| HOOK-01 | Phase 1 | Complete |
| HOOK-02 | Phase 3 | Complete |
| HOOK-03 | Phase 1 | Complete |
| HOOK-04 | Phase 1 | Complete |
| HOOK-05 | Phase 1 | Complete |
| GEN-01 | Phase 1 | Complete |
| GEN-02 | Phase 1 | Complete |
| GEN-03 | Phase 1 | Complete |
| GEN-04 | Phase 1 | Complete |
| GEN-05 | Phase 1 | Complete |
| TEST-01 | Phase 1 | Complete |
| TEST-02 | Phase 1 | Complete |
| TEST-03 | Phase 2 | Complete |
| TEST-04 | Phase 3 | Complete |
| TEST-05 | Phase 2 | Complete |
| TEST-06 | Phase 2 | Complete |
| JS-01 | Phase 03.1 | Complete |
| JS-02 | Phase 03.1 | Complete |
| JS-03 | Phase 03.1 | Complete |
| JS-04 | Phase 03.1 | Complete |
| JS-05 | Phase 03.1 | Complete |
| JS-06 | Phase 03.1 | Complete |
| JS-07 | Phase 03.1 | Complete |
| JS-08 | Phase 03.1 | Complete |
| DEP-01 | Phase 4 | Complete |
| DEP-02 | Phase 4 | Complete |
| DEP-03 | Phase 4 | Complete |
| PLAT-01 | Phase 04.1 | Pending |
| PLAT-02 | Phase 04.1 | Pending |
| PLAT-03 | Phase 04.1 | Pending |
| LEG-01 | Phase 04.1 | Pending |
| JX3-01 | Phase 04.1 | Pending |
| TEST-10 | Phase 04.1 | Pending |
| HOOK-06 | Phase 5 | Pending |
| HOOK-07 | Phase 5 | Pending |
| HOOK-08 | Phase 5 | Pending |
| ROUT-05 | Phase 5 | Pending |
| TEST-07 | Phase 6 | Pending |
| TEST-08 | Phase 6 | Pending |
| TEST-09 | Phase 6 | Pending |
| GSD-01 | Phase 7 | Pending |
| GSD-02 | Phase 7 | Pending |
| SEC-01 | Phase 8 | Pending |
| SEC-02 | Phase 8 | Pending |
| SEC-03 | Phase 8 | Pending |
| REL-01 | Phase 8 | Pending |
| REL-02 | Phase 8 | Pending |

**Coverage:**

- v1 + v1.1 requirements: 52 total
- v2 requirements scheduled: 5 total
- Mapped to phases: 57
- Unmapped: 0

---
*Requirements defined: 2026-08-20*
*Last updated: 2026-08-26 for Phase 04.1 multi-capability platform requirements*
