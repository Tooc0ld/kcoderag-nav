# Requirements: KCodeRag Nav Plugins

**Defined:** 2026-08-20
**Core Value:** 用户安装任一环境插件后即可获得可靠、低打扰、环境选择明确的 KCodeRag 图优先导航体验。

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
- [ ] **JS-05**: CJS hook 保持 advisory/fail-open，更新检查只在后台查询 npm Registry latest，具备 24 小时缓存且已安装路径可离线运行
- [ ] **JS-06**: Node 生成器、pre-commit 与 npm pack 检查能证明生成确定性、版本一致、自包含和无 Python/未解析占位符
- [ ] **JS-07**: CI 覆盖 Windows/Linux 与 Node.js 22/24；只有匹配 package 版本的 `vX.Y.Z` 标签可触发 npm 发布，普通 master push 只测试
- [ ] **JS-08**: Node 测试与 loopback smoke 覆盖三宿主生命周期、hook/Rule、MCP 证据、离线行为和诚实 PASS/FAIL/NOT_RUN，README 与唯一权威体验指南同步 npx 流程

### 已部署项目与安装来源

- [ ] **DEP-01**: `I:\JX3_SVN\Head` 的项目级 QA 更新到当前受管版本，状态健康且无用户级 QA/Dev 重复来源
- [ ] **DEP-02**: 项目 hook 从项目根目录或任意嵌套子目录启动时都能稳定定位受管 launcher
- [ ] **DEP-03**: 用户级 doctor/status 能只读发现 raw MCP、marketplace plugin、同环境重复及 QA/Dev 冲突，不输出凭据值也不自动删除配置

### Hook 精度与能力诚实性

- [ ] **HOOK-06**: fixed-string、多明确文件、单文件、日志和生成文本等本地核对保持静默
- [ ] **HOOK-07**: 深层窄目录与常见 Lua 全局处理器在明确 scope 下保留限定本地搜索，唯一 C++ 符号和限定 Lua 方法仍获得图优先建议
- [ ] **HOOK-08**: 已使用 KCodeRag 后的同轮本地精确复核不会重复收到结构提醒；任何去重状态有界且 fail-open
- [ ] **ROUT-05**: nudge、skill 和指南仅在索引真实可用时推荐 semantic/hybrid，否则默认 keyword/context/call-chain 并明确降级

### 真实宿主验证

- [ ] **TEST-07**: 干净 Codex 配置真实验证 marketplace 安装、direct MCP 工具注册、hook 出参、更新与卸载
- [ ] **TEST-08**: Claude Code project scope 真实验证 MCP、Grep/Glob/Bash hook、更新与卸载
- [ ] **TEST-09**: Cursor 免费 local 插件真实验证 install/reload、MCP/Rule/skill、update 与 uninstall

### GSD 运行时与 Hook

- [ ] **GSD-01**: GSD 在 Codex 中从安装 runtime marker 选择 orchestrator-worktree，并保留显式 Claude override 与可持久重放的回归保护
- [ ] **GSD-02**: 全局 GSD context monitor 只在必要事件启动相应逻辑，不在无意义事件重复启动 Node

## v2 Requirements

### 凭据与传输

- [ ] **SEC-01**: 用户通过个人或组织身份获取短期凭据，而不是共享内置 Bearer
- [ ] **SEC-02**: MCP 连接使用 HTTPS 并验证服务身份
- [ ] **SEC-03**: 维护者可以轮换凭据而无需重新发布完整插件

### 发布自动化

- [ ] **REL-01**: CI 自动生成、验证并发布版本化插件产物
- [ ] **REL-02**: 支持的 Codex 与 Claude Code 版本具有自动兼容矩阵

## Out of Scope

| Feature | Reason |
|---------|--------|
| QA 与 Dev 同时启用 | 两个环境采用互斥安装模式 |
| 安装一个环境时自动卸载另一个环境 | 环境切换必须由用户显式发起，避免隐式删除 |
| 强制安装第三个公共 core 插件 | QA 与 Dev 都必须能够单独完整工作 |
| QA 不可达时自动回退 Dev | 会隐藏环境故障并可能返回错误环境的数据 |
| 修改 KCodeRag MCP 服务或图数据 | 本仓库只负责插件分发和导航策略 |
| Codex 原生 project-scope plugin install | 当前 CLI 与官方文档没有该能力，使用项目级兼容安装器 |

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
| JS-05 | Phase 03.1 | Pending |
| JS-06 | Phase 03.1 | Pending |
| JS-07 | Phase 03.1 | Pending |
| JS-08 | Phase 03.1 | Pending |
| DEP-01 | Phase 4 | Pending |
| DEP-02 | Phase 4 | Pending |
| DEP-03 | Phase 4 | Pending |
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

- v1 + v1.1 requirements: 46 total
- v2 requirements scheduled: 5 total
- Mapped to phases: 51
- Unmapped: 0

---
*Requirements defined: 2026-08-20*
*Last updated: 2026-08-23 after deployment, hook-precision, real-host, GSD, and production hardening roadmap expansion*
