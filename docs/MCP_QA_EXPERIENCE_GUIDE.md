# QA 项目集成体验指南

> 面向 Codex、Claude Code、Cursor、OpenCode 与 ZCode 的项目级安装、使用和验收。

`kcoderag-nav` 是一个 Node.js 22+ 的 npm 项目集成工具，不是 marketplace plugin。它把已编译
CJS、Skill、QA MCP 配置和宿主原生资产安装到一个明确项目中，不依赖 Python、Git checkout 或
运行时 TypeScript 编译。

当前包提供两个内置 capability：

- `kcoderag-navigation`：五宿主可用的 QA 图优先导航、MCP 配置、成功调用 marker 与离线更新提示。
- `code-style-nudge`：有宿主证据约束的 C/C++/Lua 写前短提示与 `$code-style-correction` Skill。

QA 是唯一公开 MCP 环境；capability 不是环境切换。旧环境状态、Python 安装和手工来源没有迁移、
接管或自动清理入口。

## 项目级安装

进入真正需要查询的项目目录后运行：

```powershell
npx kcoderag-nav@latest install
```

交互模式先选择一个宿主，再选择 capability。自动化一次只管理一个宿主：

```powershell
npx kcoderag-nav@latest install --host codex --capability kcoderag-navigation --yes
npx kcoderag-nav@latest install --host claude --capability kcoderag-navigation `
  --capability code-style-nudge --yes
npx kcoderag-nav@latest install --host cursor --capability kcoderag-navigation --yes
npx kcoderag-nav@latest install --host opencode --capability kcoderag-navigation --yes
npx kcoderag-nav@latest install --host zcode --capability kcoderag-navigation --yes
```

默认 target 是当前目录；`--target PATH` 指向另一个精确项目。CLI 不向上推断 Git/SVN 根，也不要求
项目 marker。文件系统根、用户主目录和宿主用户级 config/plugin/cache 根会被拒绝。同一项目的
不同宿主安装彼此独立。

### 当前宿主支持

代码规范提示的支持结论只来自 checked-in、digest-bound 的真实宿主 receipt，不能从 Hook 名称、
Skill 是否打包、Rule、toast 或 after-event 推断：

| 冻结宿主行 | `kcoderag-navigation` | `code-style-nudge` | 证据结论 |
| --- | --- | --- | --- |
| Codex `0.146.1` | 支持 | 不支持 | exact `UNSUPPORTED` |
| Claude Code `2.1.241` | 支持 | 支持 | exact `PASS`，native model-visible pre-write |
| Cursor `3.17.8` | 支持 | 不支持 | exact `UNSUPPORTED` |
| OpenCode `1.18.23` | 支持 | 不支持 | exact `UNSUPPORTED` |
| ZCode（真机版本待验收） | 支持 | 不支持 | 无 PASS receipt；exact refusal |

未列出的版本不自动继承代码规范提示支持。不支持的宿主选择 `code-style-nudge` 时返回
`host_version_unsupported`，并在 desired-state render/transaction 之前零写停止；已经安装的
navigation 保持健康。

安装或更新后，运行所选宿主的 `status` 与 `doctor`，然后重新打开宿主会话。`healthy` 只证明项目
集成完整，不等于 live QA 服务或真宿主接纳已经验收。

需要验收 live QA 时，还应通过已认证连接完成 `initialize`、`tools/list` 和至少一次
`search_code`。协议 revision、工具集合和成功响应结构必须同时符合下文合同；HTTP 200、MCP
connected 或仅列出工具都不能单独替代 live 验收。

## 五个生命周期命令

```powershell
npx kcoderag-nav@latest install --host claude --capability kcoderag-navigation
npx kcoderag-nav@latest status --host claude
npx kcoderag-nav@latest doctor --host claude
npx kcoderag-nav@latest update --host claude
npx kcoderag-nav@latest uninstall --host claude --capability kcoderag-navigation
```

- `install`：把所选 capability 加入已安装集合，目标始终为 `installed ∪ selected`；相同集合且无
  漂移时保持字节和 mtime 不变。
- `status`：快速、只读地报告项目安装、支持、完整性、漂移、更新和来源冲突摘要。
- `doctor`：只读深扫项目状态和所选宿主的用户级来源；没有 `doctor --fix`。
- `update`：默认更新所选宿主全部已安装 capability；显式 capability 只筛选已安装集合。
- `uninstall`：必须交互选择、显式指定 capability 或传 `--all`；绝不默认全删。

install、update、uninstall 先预检完整目标集合，再通过一次单宿主事务写入。任一 capability 不支持、
存在来源冲突或发生漂移都会整组零写失败，不做部分成功。`--json` 只输出一个稳定、可解析且
secret-safe 的 JSON 值。

## 来源、所有权与完整性

可能生效的 plugin、raw MCP、manual Hook/Rule、旧 Python 安装或 ambiguous source 都报告为
`source_conflict`，顶层 `ok: false`。同一来源门禁覆盖 install、update 和 uninstall，并在
provider、adapter render 与 transaction 之前停止。CLI 不迁移、不接管、不编辑、不调用宿主命令
删除，也不自动清理这些来源；用户需要在 CLI 外人工核对后重新运行 doctor。

安装状态只接受 exact capability-scoped schema v1。状态记录排序后的 capability、文件/section
contributor、每个受管对象摘要、可恢复 original，以及一个 canonical composite digest。缺失或额外
owner、摘要不匹配、symlink、特殊文件、危险 target 或模糊所有权都会在首个写入前停止。共享文件
按剩余 contributor 确定性合成；只有最后一个 contributor 移除后才恢复 original。

代码规范提示前还会验证最近 current state、composite digest 与全部受管文件摘要。Skill、references、
handler、dispatcher、launcher 或注册中的任意缺失/漂移都静默 fail-open，不创建一次性 marker；
`status`/`doctor` 报 `capability_drift`。

## 宿主行为和项目边界

| 宿主 | 项目级受管位置 | 当前行为 |
| --- | --- | --- |
| Codex | `.codex/`、`.agents/skills/` | advisory/fail-open navigation `PreToolUse`；代码规范提示不支持 |
| Claude Code | `.claude/settings.json`、`.claude/skills/`、根 `.mcp.json` | navigation 与 receipt-supported 代码规范提示共用 native `PreToolUse` dispatcher |
| Cursor | `.cursor/rules/`、`.cursor/skills/`、`.cursor/mcp.json`、`.cursor/hooks.json` | always-on navigation Rule/Skill/MCP；不使用等价代码规范 `PreToolUse` |
| OpenCode | `opencode.json`/`opencode.jsonc`、`.opencode/plugins/`、`.opencode/skills/` | project plugin + MCP；代码规范提示不支持 |
| ZCode | `.zcode/config.json`、`.zcode/skills/`、`.zcode/kcoderag-nav/hooks/` | project MCP + Skill；`hooks.enabled: true` 的 advisory/fail-open `PreToolUse`、`PostToolUse` marker 与更新提示；代码规范提示不支持 |

ZCode 第一次打开包含项目 Hook 的工作区时，必须由用户在宿主中信任或批准 workspace Hook。安装器
不能预授权或改写用户级 trust。未批准时 MCP 与 Skill 仍可能工作，但项目 Hook 不执行；批准后应
重启相关会话。`status`/`doctor` 只证明受管项目字节健康，不证明宿主已接纳 Hook。

Codex、Claude Code 与 ZCode 的 advisory Hook 绝不拒绝原始 Grep、Glob 或 shell。Cursor 使用
Rule、Skill、MCP 与 `afterMCPExecution`，不声明 native model-visible pre-write 等价。OpenCode toast
和 `tool.execute.after` 也不构成代码规范提示的 pre-write 证据。

五个宿主的成功调用 marker 都是 secret-free、有界、fail-open：Codex、Claude Code 与 ZCode 使用
`PostToolUse`，Cursor 使用 `afterMCPExecution`，OpenCode 使用 `tool.execute.after`。marker 不保存
MCP 参数、结果、URL、Header 或 Bearer。

OpenCode 项目同时存在 `opencode.json` 与 `opencode.jsonc` 时，以
`ambiguous_project_config` 写前停止。只存在一个时保留其格式和无关内容；都不存在时创建
`opencode.json`。

### 最近项目状态与项目移动

Codex、Claude Code 与 ZCode launcher 从宿主会话 cwd 向上选择最近的对应受管状态。损坏或不兼容的
最近边界静默 fail-open，绝不穿透到外层项目。状态与 launcher 使用项目相对路径；完整项目 move、
rename、复制或换盘后仍指向同一内部资产。CLI 的 cwd/`--target` 始终是精确管理目标。

## 一次性代码规范提示与人工复位

只有 Claude Code `2.1.241` 的 exact PASS row 会投影 native pre-write。handler 仅处理能可靠取得目标
路径的结构化 Write/Edit/MultiEdit/apply_patch 类调用，扩展名固定为 C/C++/Lua 白名单。普通 shell、
纯删除、纯重命名、未知路径和缺少稳定 ID 的事件静默。

稳定 ID 只接受非空 `session_id`、`thread_id` 或 `conversation_id`。每个宿主会话、项目边界和
capability 最多提示一次。提示要求在写前加载 `$code-style-correction`，遵守“用户明确要求 > 项目
文档 > Skill”，并在任务结束前有界自查本次实际修改区域；它不声称静态扫描通过。

一次性 claim 位于操作系统用户 cache 的 `kcoderag-nav/nudges`。需要复位时：

1. 先关闭所有与该项目相关的宿主会话。
2. 再用操作系统文件工具删除整个 `kcoderag-nav/nudges` 目录。
3. 重新打开需要的宿主会话。

必须先关闭会话，否则仍运行的进程可能立即重建 marker。`status` 与 `doctor` 始终只读，不清理该
目录；删除失败也 fail-open，不会阻断原始写入或宿主会话。

## 更新感知与证据边界

五个宿主共享离线优先更新检查器。前台只读有界本地 cache，过期时分离启动 npm Registry worker；
不等待网络、不自动更新。异常全部 fail-open。提示只建议用户显式运行所选宿主的更新命令，例如：

```powershell
npx kcoderag-nav@latest update --host zcode
```

“自动更新”只表示自动感知版本；后台 worker 绝不运行 install/update，真正修改项目必须由用户显式
执行 update。

项目集成、isolated MCP contract 与 live QA 是三个独立层级：

- `status`/`doctor` 证明项目内容和注册状态，不证明远端服务协议。
- loopback MCP 证明发布制品可以调用隔离服务，不证明 live QA 部署一致。
- required smoke 的 `runtimeContract.layer: packaged` 证明实际 tgz 中的注册处理器可运行，但不证明
  native host admission、workspace trust 或已认证真实 MCP 查询。

Phase 04.2 只验证 exact `0.3.0` 的五宿主 packaged readiness，不执行 publish、tag、release 或
dist-tag 变更。
Phase 05 负责 Hook 精度，Phase 06 负责 authenticated real-host MCP 查询以及 OpenCode/ZCode 真机证据，
Phase 07 负责全局 GSD Hook，Phase 08 负责身份、HTTPS、凭据轮换与发布自动化；本阶段不提前声明这些
事项完成。

## 正式 MCP 服务合同

KCodeRag 当前正式工具面固定为六个：

| 工具 | 用途 |
| --- | --- |
| `search_code` | 按关键词、语义或混合模式搜索代码实体 |
| `list_indexes` | 查看全文与向量索引及其覆盖状态 |
| `get_call_chain` | 追踪 callers/callees 和跨语言调用关系 |
| `context` | 查看符号概览、关系、执行流和按需源码 |
| `cypher` | 执行受限的只读图查询 |
| `submit_feedback` | 提交严格脱敏、等待人工复核的观察 |

`get_entity_context` 与 `get_knowledge_bundle` 已退役，调用必须返回 `unknown tool`，不会转发到
`context`。`cypher` 会拒绝写入语句和存储过程调用，其他查询工具也不会修改图数据。

服务只接受 MCP protocol revision `2025-11-25`。成功的 `tools/call` 必须同时返回 `content`、
`structuredContent` 和 `isError`；机器事实只从 `structuredContent` 获取，Text `content` 只是有界
摘要。通用结构包含 `completeness`，`meta` 中的 `requested`、`effective` 及 changes 用于表达请求
语义与实际语义的差异。revision 不符或成功响应缺少这些字段时，应判定部署漂移并停止验收。

两个正式只读 Resource 是 `krag://graph/status` 和 `krag://graph/schema`。它们提供有界状态和 schema
快照，不是可参数化的图查询工具。

只需要原生 MCP 时，可以直接在客户端设置中注册 KCodeRag Streamable HTTP server；这种接入不包含
nav 的 Hook、Rule、Skill、更新提示或受管生命周期。服务地址与认证材料由部署约定单独维护。

## MCP 查询工作流

正式工具面包括 `search_code`、`context`、`get_call_chain`、`list_indexes`、`cypher` 和
`submit_feedback`。推荐从搜索定位开始，再查看上下文和调用链，最后用限定路径的本地搜索复核当前
工作区与尚未提交的改动：

```text
搜索定位 → 查看上下文 → 追踪调用链 → 按需读取源码 → 本地精确复核
search_code   context      get_call_chain    context          grep/rg
```

`cypher` 只允许受限只读查询。向量索引不可用时，显式请求的 semantic/hybrid 可以降级为 keyword，
并在响应元数据中说明；keyword 的零命中不会静默切换语义。先调用 `list_indexes` 核对实际部署能力。

## 故障排查

- MCP 工具未出现：重新打开宿主会话，并运行所选宿主的 `status` 与 `doctor`。
- `host_version_unsupported`：当前 exact host row 没有代码规范提示 PASS receipt；保留 navigation。
- `capability_drift`：不要继续变更；恢复全部受管资产后重新运行只读检查。
- `source_conflict`：在 CLI 外人工核对报告来源；全部 mutation 保持零写。
- `ambiguous_project_config`：人工确认 OpenCode 的两个项目配置，安装器不会替用户删除。
- QA 不可达：明确报告网络、服务或鉴权问题，不切换到其他环境。
- 语义搜索不可用：调用 `list_indexes`，再使用 keyword 继续按名查询。
- `initialize` revision 或成功响应结构不符：按部署漂移处理，更新 QA 服务后重新验收。
- 同名实体过多：从 candidates 中选择完全限定实体，再调用 `context`。

本文件由本仓库独立维护，并参与 docs、打包、Git 与 tgz 审计。它不依赖其他仓库的文件、状态、
提交或摘要。
