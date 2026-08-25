# Phase 04: 已部署项目与安装来源可靠性 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-25
**Phase:** 04-deployment-reliability
**Areas discussed:** QA-only 产品与旧安装迁移、项目根与 Hook 定位、用户级来源分类与写入门禁、status 与 doctor 诊断体验、Head 部署与公开验证

---

## QA-only 产品与旧安装迁移

### 公共 Dev 能力

| Option | Description | Selected |
|--------|-------------|----------|
| 彻底删除 Dev | 从公共 npm 包、CLI、生成资产和文档移除 Dev | ✓ |
| 隐藏 Dev | 普通用户界面隐藏，但保留维护者参数 | |
| 拆分内部包 | 主包只支持 QA，Dev 另建内部包 | |

**User's choice:** 从公共产品中彻底删除 Dev。
**Notes:** QA 成为唯一可安装环境；遗留 Dev 只保留迁移/卸载兼容。

### 已有项目 Dev 安装

| Option | Description | Selected |
|--------|-------------|----------|
| 一步迁移 | 明确确认后在同一项目事务中迁移为 QA | ✓ |
| 分两步 | 先卸载 Dev，再单独安装 QA | |
| 完全拒绝 | 要求用旧版本先卸载 | |

**User's choice:** 所有权明确且无漂移时，一步迁移为 QA。
**Notes:** 自动化必须显式传 legacy Dev 迁移参数。

### 用户级旧 plugin

| Option | Description | Selected |
|--------|-------------|----------|
| 询问后卸载 | 通过所选宿主原生命令移除后继续 | ✓ |
| 永不修改 | 只报告并要求用户自行清理 | |
| 静默卸载 | 所有权明确时直接删除 | |

**User's choice:** 展示计划并询问，确认后使用宿主原生卸载能力。
**Notes:** raw MCP、手写 Hook 和所有权不明来源不自动处理。

### 版本与发布时间

| Option | Description | Selected |
|--------|-------------|----------|
| `0.2.0` | 以公开契约变化发布 | ✓（最终） |
| `0.1.9` | 作为 patch 延续当前版本线 | |
| 暂不发布 | 只在本地与仓库验证 | ✓（初选，后续覆盖） |

**User's choice:** 最终决定实现和门禁通过后发布验证，不需要人工授权。
**Notes:** Dev 删除按 `0.2.0` 处理；初始“暂不发布”在澄清后被明确覆盖。

### Head 使用的制品

| Option | Description | Selected |
|--------|-------------|----------|
| 公开 exact 版本 | 发布后使用 `kcoderag-nav@0.2.0` | ✓ |
| 延后 Head 更新 | 整个 Phase 不发布 | |
| 本地 tarball | 使用 `npm pack` 更新 Head | |

**User's choice:** 只使用公开 npm exact 版本迁移 Head。
**Notes:** 本地包不能冒充普通用户的公开安装证据。

---

## 项目根与 Hook 定位

### 根目录发现

| Option | Description | Selected |
|--------|-------------|----------|
| 向上查找最近状态 | 从当前目录逐级寻找最近受管项目 | ✓ |
| 绝对路径 | 安装时把项目绝对路径写入 Hook | |
| Git/SVN 根 | 依赖版本库根定位 | |

**User's choice:** 向上查找最近的受管状态。
**Notes:** 只改变 Hook/运行时定位，CLI 的 `cwd/--target` 仍是精确目标。

### 最近状态损坏

| Option | Description | Selected |
|--------|-------------|----------|
| 最近边界内 fail-open | 不越过内层项目使用外层安装 | ✓ |
| 跳过损坏状态 | 继续寻找外层安装 | |
| 多层即停用 | 发现嵌套安装就停止 | |

**User's choice:** 最近项目仍是边界，损坏时静默 fail-open。
**Notes:** 问题交给 `status/doctor`，避免查询错误项目。

### 项目移动

| Option | Description | Selected |
|--------|-------------|----------|
| 内容完整即继续 | 状态使用相对路径和摘要 | ✓ |
| 移动后 update | 首次运行要求更新状态 | |
| 移动后重装 | 复制可用但移动需重装 | |

**User's choice:** 项目移动、复制、改名或改盘符后继续可用。
**Notes:** 不记录旧绝对路径。

### 项目级目标限制

| Option | Description | Selected |
|--------|-------------|----------|
| 拒绝明确全局位置 | 禁止 home、宿主全局配置/cache 和文件系统根 | ✓ |
| 必须 Git/SVN 根 | 只允许版本库根目录 | |
| 专用 marker | 先初始化 KCodeRag 项目标记 | |

**User's choice:** 拒绝明确全局位置，其他目录规范化确认后可安装。
**Notes:** 不强制 Git/SVN，CLI 由全局 npm bin 启动也不能写全局宿主目录。

---

## 用户级来源分类与写入门禁

### 来源严重程度

| Option | Description | Selected |
|--------|-------------|----------|
| 分级处理 | 活动来源阻断，已知旧来源可清理，cache 只提示 | ✓ |
| 任何痕迹阻断 | cache 或禁用记录也硬停止 | |
| 只检查活动运行时 | 忽略损坏注册和残留 | |

**User's choice:** 分级处理。
**Notes:** 无害残留不能妨碍项目安装。

### 宿主扫描范围

| Option | Description | Selected |
|--------|-------------|----------|
| 只处理所选宿主 | Codex 命令不阻断 Claude/Cursor | ✓ |
| 其他宿主只提示 | 扫描但不阻断 | |
| 全宿主唯一来源 | 任一宿主来源都阻断 | |

**User's choice:** 写入门禁只处理所选宿主。
**Notes:** 跨宿主项目 QA 安装继续允许共存。

### 无受管状态的 raw 配置

| Option | Description | Selected |
|--------|-------------|----------|
| 硬停止并人工清理 | 只报告安全路径和稳定错误码 | ✓ |
| 匹配模板时删除 | 读取并比对配置后询问删除 | |
| 警告后继续 | 允许潜在重复来源 | |

**User's choice:** raw MCP/Hook 硬停止并人工清理。
**Notes:** 不读取或输出 URL、Header、Bearer 等值。

### 门禁命令范围

| Option | Description | Selected |
|--------|-------------|----------|
| install/update 阻断 | uninstall 可减少来源，仍允许执行 | ✓ |
| 所有写命令阻断 | uninstall 也被外部冲突阻止 | |
| 只阻断 install | update 不重新扫描 | |

**User's choice:** `install/update` 门禁，`uninstall` 在项目自身无漂移时可执行。
**Notes:** `status/doctor` 始终只读。

---

## status 与 doctor 诊断体验

### 命令分工

| Option | Description | Selected |
|--------|-------------|----------|
| status 快速、doctor 深入 | 项目健康摘要与用户来源深查分开 | ✓ |
| 完全相同 | 两个命令仅名称不同 | |
| status 也完整扫描 | 每次状态检查都扫描用户来源 | |

**User's choice:** `status` 快速，`doctor` 深入。
**Notes:** `install/update` 自行执行完整门禁，不依赖用户先运行 doctor。

### doctor 修复信息

| Option | Description | Selected |
|--------|-------------|----------|
| 错误码、路径和命令 | 给出安全、可复制的宿主原生命令 | ✓ |
| 只报告问题 | 不提供具体清理命令 | |
| `doctor --fix` | doctor 自动修改配置 | |

**User's choice:** 输出稳定 finding 和可复制命令，但不自动修复。
**Notes:** finding 包含严重级别、来源类型和 scope。

### 重复来源顶层状态

| Option | Description | Selected |
|--------|-------------|----------|
| `source_conflict` | 独立状态且 `ok: false` | ✓ |
| `healthy` warning | 项目文件健康即保持 healthy | |
| `invalid` | 与项目损坏统一归类 | |

**User's choice:** 使用独立的 `source_conflict`。
**Notes:** 自动化不能忽略实际重复生效问题。

### 未安装项目的 doctor

| Option | Description | Selected |
|--------|-------------|----------|
| 执行安装前诊断 | `not_installed` 同时扫描用户来源 | ✓ |
| 只返回未安装 | 安装后才能深入诊断 | |
| 自动安装 | doctor 进入写流程 | |

**User's choice:** 未安装时仍执行安装前诊断。
**Notes:** doctor 保持只读。

---

## Head 部署与公开验证

### 迁移顺序

| Option | Description | Selected |
|--------|-------------|----------|
| exact doctor → migrate → status | 全流程绑定 `0.2.0` | ✓ |
| 卸载后重装 | 产生无安装窗口 | |
| `latest update` | 无法绑定确切制品 | |

**User's choice:** 使用公开 exact `0.2.0` 完成诊断、清理、迁移和复验。
**Notes:** 不使用 `latest` 或本地 tarball。

### Head 漂移

| Option | Description | Selected |
|--------|-------------|----------|
| 写前硬停止 | 人工确认和恢复后再迁移 | ✓ |
| 备份后强制覆盖 | 提供 `--force` | |
| 自动卸载重装 | 绕过摘要保护 | |

**User's choice:** 漂移硬停止，不提供强制覆盖。
**Notes:** 不通过自动卸载规避所有权问题。

### Phase 04 验收范围

| Option | Description | Selected |
|--------|-------------|----------|
| 部署可靠性验收 | 制品、状态、来源、嵌套 Hook 和边界 | ✓ |
| 只验 status/doctor | 不验证子目录 Hook | |
| 完整真实 MCP | 提前执行 Phase 06 | |

**User's choice:** 验证部署可靠性，不吞并真实 MCP/图查询证据。
**Notes:** 项目移动通过临时副本自动化测试验证。

### 发布后 Head 失败

| Option | Description | Selected |
|--------|-------------|----------|
| 不可变发布、修复前进 | 回滚项目事务，后续发 `0.2.1` | ✓ |
| 回退 latest | 把 dist-tag 退回 `0.1.8` | |
| unpublish | 删除已发布版本 | |

**User's choice:** 保持 `0.2.0` 和 tag 不变，修复前进。
**Notes:** Head 回滚到迁移前状态，修复版使用新的 exact 版本。

---

## Agent's Discretion

- 向上查找 bootstrap 的内部模块拆分、遍历上限和跨平台转义。
- legacy Dev 迁移参数、用户级 plugin 清理授权参数与 finding 的具体字段名。
- 宿主原生 plugin 枚举/卸载封装及 human-readable 输出排版。

## Deferred Ideas

- Hook 误报和索引能力路由留在 Phase 05。
- 真实三宿主 MCP/图查询证据留在 Phase 06。
- GSD runtime 与全局 Hook 整理留在 Phase 07。
- 生产身份、HTTPS 和凭据轮换留在 Phase 08。
