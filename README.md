# KCodeRag Nav

KCodeRag Nav 是面向 Codex、Claude Code、Cursor、OpenCode 与 ZCode 的项目级 capability 安装平台。
公共 npm CLI `kcoderag-nav` 把已编译 CJS、Skill、QA MCP 配置和宿主原生资产写入一个明确的
目标项目。用户只需要 Node.js 22 或更高版本；不需要 Python、Git checkout 或运行时 TypeScript
编译，也不通过 marketplace 安装。

当前包只提供两个内置 capability：

- `kcoderag-navigation`：五宿主可用的 QA 图优先导航与 MCP 配置；五个宿主
  额外提供成功调用 marker 与离线更新提示。
- `jx3-style-nudge`：C/C++/Lua 结构化写入前的短提示与 `$jx3-code-style-correction` Skill。

QA 是唯一公开 MCP 环境；capability 不是环境选择。旧 QA/Dev 状态、Python 安装、手工 MCP/Hook、
plugin 或其他来源没有迁移、接管或自动清理入口。发现它们时，CLI 只做 secret-safe 报告并在
全部变更命令写入前停止。

面向 QA 使用者的完整接入与体验指南由 KCodeRag 服务仓库独占维护，见
[MCP_QA_EXPERIENCE_GUIDE.md](https://github.com/Tooc0ld/KCodeRag/blob/main/MCP_QA_EXPERIENCE_GUIDE.md)。
本仓库不保留该指南副本，也不在文档或诊断中展示 MCP URL、Header、Bearer 或配置正文。

## 快速安装

在真正需要接入 KCodeRag 的项目目录中运行：

```powershell
npx kcoderag-nav@latest install
```

未传 `--host` 和 `--capability` 时，CLI 先选择一个宿主，再多选 capability。自动化必须一次明确
一个宿主，并可重复传入 `--capability`：

```powershell
npx kcoderag-nav@latest install --host codex --capability kcoderag-navigation --yes
npx kcoderag-nav@latest install --host claude --capability kcoderag-navigation `
  --capability jx3-style-nudge --yes
npx kcoderag-nav@latest install --host cursor --capability kcoderag-navigation --yes
npx kcoderag-nav@latest install --host opencode --capability kcoderag-navigation --yes
npx kcoderag-nav@latest install --host zcode --capability kcoderag-navigation --yes
```

目标默认为当前目录；`--target PATH` 指向另一个精确项目。CLI 不向上推断 Git/SVN 根，也不要求
专用 marker。文件系统根、用户主目录和宿主用户级 config/plugin/cache 根会被拒绝。一次命令
只管理一个宿主，因此同一项目的五个宿主可以拥有彼此独立的 capability 集合。

## 当前宿主支持

JX3 支持结论来自 checked-in、digest-bound 的宿主 receipt，不从 Hook 名称、Skill 是否打包、toast
或 after-event 推断。ZCode navigation 当前由项目级 adapter contract 与 synthetic lifecycle smoke
覆盖，真实宿主与已认证 MCP 证据仍留给 Phase 06。

| 宿主与冻结版本 | `kcoderag-navigation` | `jx3-style-nudge` | JX3 结论 |
| --- | --- | --- | --- |
| Codex `0.146.1` | 支持 | 不支持 | exact `UNSUPPORTED`；选择后返回 `host_version_unsupported` |
| Claude Code `2.1.241` | 支持 | 支持 | exact `PASS`，native model-visible pre-write |
| Cursor `3.17.8` | 支持 | 不支持 | exact `UNSUPPORTED`；Rule/Skill/after-event 不冒充 pre-write |
| OpenCode `1.18.23` | 支持 | 不支持 | exact `UNSUPPORTED`；toast/after-event 不冒充 pre-write |
| ZCode（真机版本待验收） | 支持 | 不支持 | 无 JX3 PASS receipt；选择后返回 `host_version_unsupported` |

未列出的版本也不自动继承 JX3 支持。unsupported host 选择 JX3 时，在 desired-state render 和
transaction 之前稳定零写拒绝；已经安装的 navigation 保持健康、可用。

## 五个生命周期命令

```powershell
npx kcoderag-nav@latest install --host claude --capability kcoderag-navigation
npx kcoderag-nav@latest status --host claude
npx kcoderag-nav@latest doctor --host claude
npx kcoderag-nav@latest update --host claude
npx kcoderag-nav@latest uninstall --host claude --capability kcoderag-navigation
```

- `install`：把所选 capability 加入已安装集合，目标始终是 `installed ∪ selected`。重复选择相同
  集合且无漂移时字节和 mtime 都不变；不会删除未选择的已安装能力。
- `status`：快速、只读地报告所选宿主全部 capability 的安装、支持、摘要完整性、漂移、更新和
  来源冲突摘要。
- `doctor`：只读深扫所选宿主的项目状态与用户级来源；未安装时也可运行。没有 `doctor --fix`。
- `update`：默认更新所选宿主全部已安装 capability；传 `--capability ID` 时只筛选已安装集合。
- `uninstall`：交互选择或显式传 `--capability ID`；自动化如需删除全部能力必须显式 `--all`，
  绝不默认全删。

install、update、uninstall 都需要确认精确 target，并对本次完整 capability 集合先做统一预检。
任何一项不支持、冲突或漂移都会整组零写失败，不做部分成功。status 与 doctor 不需要 `--yes`；
`--json` 只输出一个稳定、可解析且 secret-safe 的 JSON 值。

## 来源门禁、所有权与完整性

所选宿主的 active plugin、raw MCP、manual Hook/Rule、旧 Python 安装或 ambiguous source 都是
`source_conflict`，顶层 `ok: false`。同一来源门禁用于 install、update 和 uninstall，并且在
provider、adapter render 与 transaction 之前结束，因此项目树、状态和其他 capability 均零写。

CLI 不执行来源迁移、adoption、自动 cleanup 或宿主原生卸载，也没有 cleanup flag。诊断只返回
稳定 code、source type、scope 和安全相对路径；这些来源始终是 manual-only，用户必须在 CLI 外确认并人工清理，再重新运行
doctor。一次命令只扫描所选宿主，不会把其他宿主的项目安装当成冲突。

当前 install state 只接受 exact schema v1。它记录排序后的 capability、每个 capability 的文件与
section contributor、每个受管文件/section 摘要、可恢复 original 和一个 canonical composite
digest。缺失/额外 owner、摘要不匹配、symlink、特殊文件、危险 target 或模糊所有权都会在首个
写入前停止。更新/卸载一个 capability 时，共享文件按 contributor 合成；只有最后一个 contributor
移除后才恢复原始内容。事务失败只回滚所选宿主。

JX3 提示还有完整 D-15 运行时门禁：最近状态必须是 current schema，其 composite digest 与每个
受管文件摘要必须全部匹配。Skill、references、handler、dispatcher、launcher 或注册中的任何
缺失/漂移都会静默 fail-open，且不会提前创建一次性 marker；`status`/`doctor` 报
`capability_drift`。handler 没有内置简版规则兜底。

## 宿主行为与项目移动

| 宿主 | 项目级受管位置 | 当前行为 |
| --- | --- | --- |
| Codex | `.codex/`、`.agents/skills/` | advisory/fail-open navigation `PreToolUse`；JX3 unsupported |
| Claude Code | `.claude/settings.json`、`.claude/skills/`、根 `.mcp.json` | navigation 与 receipt-supported JX3 共用 native `PreToolUse` dispatcher |
| Cursor | `.cursor/rules/`、`.cursor/skills/`、`.cursor/mcp.json`、`.cursor/hooks.json` | always-on navigation Rule/Skill/MCP；不声明等价 `PreToolUse` |
| OpenCode | `opencode.json`/`opencode.jsonc`、`.opencode/plugins/`、`.opencode/skills/` | project plugin + MCP；JX3 unsupported |
| ZCode | `.zcode/config.json`、`.zcode/skills/`、`.zcode/kcoderag-nav/hooks/` | project MCP + Skill；`hooks.enabled: true` 的 advisory/fail-open `PreToolUse`、`PostToolUse` marker 与更新提示；JX3 unsupported |

ZCode 首次打开包含项目 Hook 的工作区时，还必须由用户在宿主中信任/批准 workspace Hook。
安装器只写项目声明，不能替用户预授权或修改用户级 trust；未批准时 MCP 与 Skill 仍可能正常，
但 `PreToolUse`/`PostToolUse` 不会执行，因此没有动态导航提示、成功 marker 或 Hook 更新提示。
批准后重启相关会话再验收。`status`/`doctor` 只证明受管项目字节健康，不证明 ZCode 已接纳 Hook。

Codex/Claude launcher 从宿主会话 cwd 向上选择最近的对应受管状态。损坏或不兼容的最近状态是
静默 fail-open 边界，不穿透到外层项目。状态和 launcher 使用项目相对路径；完整项目 move、rename、
复制或换盘后仍指向同一内部资产。CLI 自身的 cwd/`--target` 始终是精确目标，不执行这项向上查找。

五个宿主使用各自原生成功后事件写入 secret-free、有界、fail-open
的 KCodeRag 调用 marker：
Codex/Claude Code 为 `PostToolUse`，Cursor 为 `afterMCPExecution`，OpenCode 为
`tool.execute.after`，ZCode 为项目 `PostToolUse`。marker 不保存 MCP 参数、结果、URL、Header
或 Bearer。ZCode 的 `PreToolUse` 只添加导航与更新上下文，绝不拒绝 Grep、Glob 或 Bash，也不
冒充 JX3 pre-write；该行为使用 ZCode 官方
[MCP](https://zcode.z.ai/cn/docs/mcp-services)、[Skill](https://zcode.z.ai/en/docs/skill) 和
[Hook](https://zcode.z.ai/en/docs/hooks) 合同一致。

## JX3 一次性提示与人工复位（D-19）

JX3 只在结构化 Write/Edit/MultiEdit/apply_patch 类调用能提供目标路径、扩展名属于冻结的
C/C++/Lua 白名单且存在稳定 `session_id`、`thread_id` 或 `conversation_id` 时提示。每个宿主会话、
项目边界和 capability 最多一次；普通 shell、纯删除/重命名或缺少稳定 ID 时静默。

一次性 claim 位于操作系统用户 cache 的 `kcoderag-nav/nudges`（Windows 通常为
`%LOCALAPPDATA%\kcoderag-nav\nudges`，Linux 通常为
`${XDG_CACHE_HOME:-$HOME/.cache}/kcoderag-nav/nudges`）。如需人工复位：

1. 先关闭所有与该项目相关的 Codex、Claude Code、Cursor 和 OpenCode 会话。
2. 再用操作系统文件工具删除整个 `kcoderag-nav/nudges` 目录。
3. 重新打开需要的宿主会话。

必须先关会话，否则仍运行的进程可能立即重新创建 marker。`status` 与 `doctor` 始终只读，不会
删除这个目录；没有第六个公开 cleanup 命令。目录列举、容量清理或人工删除失败都 fail-open，
不会阻断原始写入或宿主会话。

## 更新提示、证据与维护者门禁

五个宿主共享一个离线前台更新检查器：前台只读有界 cache，过期时分离启动 npm Registry worker，
不等待网络、不自动更新。Codex/Claude 将已知提示加入首次符合条件的上下文；Cursor 返回
`additional_context`；OpenCode 显示 warning toast；ZCode 通过项目 `PreToolUse` 注入相同的短提示。
所有异常 fail-open，提示只建议运行所选宿主的显式更新命令，例如
`npx kcoderag-nav@latest update --host zcode`。

这里的“自动更新”仅表示自动感知新版本：后台 worker 只刷新版本 cache，绝不运行 install/update。
required smoke 的 `runtimeContract.layer: packaged` 会从实际 tgz 安装后执行注册处理器，验证提示、
marker、fail-open 与分离刷新调度；它不等于真宿主已加载/信任这些注册。真机接纳与真实 MCP 查询
必须由独立的 optional-live 或人工 UAT receipt 证明。

Phase 04.1 的 packed smoke 证明 Claude 双顺序完整 lifecycle、三个 unsupported host 的 navigation
保留与 JX3 零写拒绝，以及 metadata-only receipt。它不声称已完成 authenticated real-host MCP
query evidence；真实查询和 OpenCode 公共 exact/latest 证据属于 Phase 06。

维护源码是 strict TypeScript `.cts`，构建为 Node.js 22+ 可直接执行的 CJS，生产依赖为零。生成
QA/Cursor trees 不能手改：

```powershell
npm ci
git config core.hooksPath .githooks
npm run build
npm test
npm run generate:check
npm run pack:audit
```

当前内部 QA profile 的连接材料视为不透明敏感输入。生成、CLI、状态、测试、receipt 与文档只处理
必要元数据；生产身份、HTTPS 与轮换属于 Phase 08。

## Historical Phase 04 record — not current instructions

以下内容只保存已发生的 Phase 04 审计语汇，不能在当前 CLI 上执行。旧版本曾要求
`--allow-owned-source-cleanup --cleanup-fingerprint sha256:<64-lowercase-hex>`，并曾审核固定命令
`codex plugin remove PLUGIN@MARKETPLACE --json`、
`codex plugin marketplace remove kcoderag-nav --json`、
`claude plugin uninstall PLUGIN@MARKETPLACE --scope user|project|local` 与
`claude plugin marketplace remove MARKETPLACE --scope SCOPE`，随后要求完整 post-removal rescan。
Phase 04.1 已删除这些 authority 和旧 QA/Dev migration decoder；这些字符串只用于历史可追溯性，
不是 cleanup、迁移或卸载建议。
