# Requirements: KCodeRag Nav Plugins

**Defined:** 2026-08-20
**Core Value:** 用户安装任一环境插件后即可获得可靠、低打扰、环境选择明确的 KCodeRag 图优先导航体验。

## v1 Requirements

### 安装与分发

- [ ] **PKG-01**: 用户可独立安装、使用和卸载 QA 插件
- [ ] **PKG-02**: 用户可独立安装、使用和卸载 Dev 插件
- [ ] **PKG-03**: 普通用户文档默认只引导安装 QA，双装明确标记为测试场景
- [ ] **PKG-04**: 用户安装后无需额外索取或配置 Bearer 凭据即可连接对应环境
- [ ] **PKG-05**: 默认项目安装将 QA hook、skill 与 MCP 配置部署到目标仓库自己的 `.codex/` 和 `.agents/`
- [ ] **PKG-06**: 用户必须通过显式参数选择 Dev 或 QA+Dev 项目安装，并可只卸载对应的受管文件

### 环境路由

- [ ] **ROUT-01**: QA 与 Dev 双装时，未指定环境的查询默认使用 QA
- [ ] **ROUT-02**: 用户明确指定 Dev 时只查询 Dev
- [ ] **ROUT-03**: 用户明确要求环境对比时才同时查询 QA 和 Dev
- [ ] **ROUT-04**: 目标环境不可达时明确报告，不静默切换环境

### Hook 行为

- [ ] **HOOK-01**: 结构化 `Grep`、`Glob` 和 shell 搜索会收到图优先导航提示
- [ ] **HOOK-02**: QA 与 Dev 双装时，同一次工具调用最多注入一次 hook 提示
- [ ] **HOOK-03**: hook 解析失败、去重失败或输入异常时保持 fail-open，不阻止原始工具调用
- [ ] **HOOK-04**: 精确文本、日志、单文件和未提交改动搜索继续使用本地工具
- [ ] **HOOK-05**: 已修复的命令解析形式全部保留自动化回归覆盖

### 生成式发布

- [ ] **GEN-01**: hook、skill 和共享测试只维护一份规范源
- [ ] **GEN-02**: 生成器产出两个自包含、可独立安装的 QA 与 Dev 插件
- [ ] **GEN-03**: 生成过程保留各环境的名称、MCP 地址、Bearer 和权限命名空间
- [ ] **GEN-04**: 生成器提供只读检查模式，能够发现生成产物漂移且不修改文件
- [ ] **GEN-05**: 相同输入重复生成得到内容一致的安装产物

### 验证与兼容

- [ ] **TEST-01**: 共享 hook 测试同时验证 QA 与 Dev 生成产物
- [ ] **TEST-02**: 自动校验 marketplace、plugin manifest、hook 和 MCP 路径
- [ ] **TEST-03**: 自动验证仅 QA、仅 Dev、QA 与 Dev 双装以及独立卸载场景
- [ ] **TEST-04**: 自动验证默认 QA、显式 Dev、双环境对比和 hook 去重行为
- [ ] **TEST-05**: 插件保持 Codex 支持与现有 Claude Code 兼容路径
- [ ] **TEST-06**: 项目安装与卸载验证用户级 Codex 配置、插件缓存和无关项目文件保持不变

## v2 Requirements

### 凭据与传输

- **SEC-01**: 用户通过个人或组织身份获取短期凭据，而不是共享内置 Bearer
- **SEC-02**: MCP 连接使用 HTTPS 并验证服务身份
- **SEC-03**: 维护者可以轮换凭据而无需重新发布完整插件

### 发布自动化

- **REL-01**: CI 自动生成、验证并发布版本化插件产物
- **REL-02**: 支持的 Codex 与 Claude Code 版本具有自动兼容矩阵

## Out of Scope

| Feature | Reason |
|---------|--------|
| 安装一个环境时自动卸载另一个环境 | 破坏双环境测试与独立可逆安装 |
| 强制安装第三个公共 core 插件 | QA 与 Dev 都必须能够单独完整工作 |
| QA 不可达时自动回退 Dev | 会隐藏环境故障并可能返回错误环境的数据 |
| 修改 KCodeRag MCP 服务或图数据 | 本仓库只负责插件分发和导航策略 |
| 当前里程碑实施生产级身份与凭据治理 | 用户明确限定为内部 QA/Dev 装即用阶段 |
| Codex 原生 project-scope plugin install | 当前 CLI 与官方文档没有该能力，使用项目级兼容安装器 |

## Traceability

路线图创建时填充；每个 v1 requirement 必须映射到且仅映射到一个阶段。

| Requirement | Phase | Status |
|-------------|-------|--------|
| PKG-01 | Phase 1 | Pending |
| PKG-02 | Phase 2 | Pending |
| PKG-03 | Phase 1 | Pending |
| PKG-04 | Phase 1 | Pending |
| PKG-05 | Phase 1 | Pending |
| PKG-06 | Phase 2 | Pending |
| ROUT-01 | Phase 3 | Pending |
| ROUT-02 | Phase 3 | Pending |
| ROUT-03 | Phase 3 | Pending |
| ROUT-04 | Phase 3 | Pending |
| HOOK-01 | Phase 1 | Pending |
| HOOK-02 | Phase 3 | Pending |
| HOOK-03 | Phase 1 | Pending |
| HOOK-04 | Phase 1 | Pending |
| HOOK-05 | Phase 1 | Pending |
| GEN-01 | Phase 1 | Pending |
| GEN-02 | Phase 1 | Pending |
| GEN-03 | Phase 1 | Pending |
| GEN-04 | Phase 1 | Pending |
| GEN-05 | Phase 1 | Pending |
| TEST-01 | Phase 1 | Pending |
| TEST-02 | Phase 1 | Pending |
| TEST-03 | Phase 2 | Pending |
| TEST-04 | Phase 3 | Pending |
| TEST-05 | Phase 2 | Pending |
| TEST-06 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 26 total
- Mapped to phases: 26
- Unmapped: 0

---
*Requirements defined: 2026-08-20*
*Last updated: 2026-08-20 after roadmap creation*
