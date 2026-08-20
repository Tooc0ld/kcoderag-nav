# Roadmap: KCodeRag Nav Plugins

## Overview

v1 先以规范源稳定地产出两个自包含环境包，再交付只作用于目标仓库的受管安装与卸载，最后完成双环境下可预测、低打扰的图优先导航体验。

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: QA 优先的可重复插件包** - 从一份规范源生成并验证可立即使用的 QA 优先导航 MVP。
- [ ] **Phase 2: 受管项目安装与环境生命周期** - 在不污染用户环境的前提下交付 QA、Dev 和双装的项目级安装与独立卸载。
- [ ] **Phase 3: 可预测的双环境图导航** - 让双装用户获得明确的 QA 默认、Dev 显式和比较查询行为，同时保持单次提示与 fail-open。

## Phase Details

### Phase 1: QA 优先的可重复插件包
**Goal**: 普通用户能从受控、可重复验证的自包含 QA 插件包获得装即用的图优先导航 MVP。
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: PKG-01, PKG-03, PKG-04, PKG-05, HOOK-01, HOOK-03, HOOK-04, HOOK-05, GEN-01, GEN-02, GEN-03, GEN-04, GEN-05, TEST-01, TEST-02
**Success Criteria** (what must be TRUE):
  1. 普通用户可按 QA 优先文档将自包含 QA 插件部署到目标仓库，并无需另行索取或配置凭据即可连接其 MCP 环境。
  2. 目标仓库中的 QA 安装会提供 hook、skill 和 MCP 配置；结构化 Grep、Glob 或 shell 搜索会获得图优先建议，而精确文本、日志、单文件及未提交改动搜索仍保持本地工具路径。
  3. QA hook 遇到无效输入、解析异常或异常去重状态时不会阻止原始工具调用，已修复的命令解析形式继续有自动化回归保护。
  4. 维护者只维护一份 hook、skill 与共享测试规范源，即可生成保留各自名称、MCP 地址、Bearer 和权限命名空间的两个自包含环境包。
  5. 维护者可通过只读检查发现生成产物漂移，并可验证相同输入重复生成的安装产物内容一致、marketplace/manifest/hook/MCP 路径有效。
**Plans**: TBD

### Phase 2: 受管项目安装与环境生命周期
**Goal**: 用户可在目标项目内安全地选择 QA、Dev 或双环境安装，并分别完整使用和卸载每个环境。
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: PKG-02, PKG-06, TEST-03, TEST-05, TEST-06
**Success Criteria** (what must be TRUE):
  1. 用户可通过显式参数在目标仓库中安装 Dev，或同时安装 QA 与 Dev；Dev 无需依赖 QA 即可连接和使用其环境专属插件资产。
  2. 用户可仅卸载所选环境的受管文件，保留另一个已安装环境以及目标仓库的无关文件。
  3. 自动化验证覆盖仅 QA、仅 Dev、QA+Dev 三种安装场景及各环境的独立卸载。
  4. 项目安装与卸载不会修改用户级 Codex 配置、插件缓存或无关项目文件，并同时保留 Codex 支持和现有 Claude Code 兼容路径。
**Plans**: TBD

### Phase 3: 可预测的双环境图导航
**Goal**: 双环境用户的查询路由与 hook 提示始终明确、低打扰且不会在环境故障时静默改变目标。
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: ROUT-01, ROUT-02, ROUT-03, ROUT-04, HOOK-02, TEST-04
**Success Criteria** (what must be TRUE):
  1. QA 与 Dev 双装时，未指定环境的结构化查询默认使用 QA。
  2. 用户明确指定 Dev 时只查询 Dev；只有明确要求环境比较时才同时查询 QA 与 Dev。
  3. 目标环境不可达时，用户会看到明确的不可达结果，系统不会静默切换到另一个环境。
  4. QA 与 Dev 双装下，同一次本地工具调用最多收到一次 hook 导航提示。
  5. 自动化验证覆盖默认 QA、显式 Dev、双环境比较、不可达不回退与跨插件 hook 去重行为。
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. QA 优先的可重复插件包 | 0/TBD | Not started | - |
| 2. 受管项目安装与环境生命周期 | 0/TBD | Not started | - |
| 3. 可预测的双环境图导航 | 0/TBD | Not started | - |
