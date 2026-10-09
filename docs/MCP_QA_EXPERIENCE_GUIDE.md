# KCodeRag Nav 安装和使用

`kcoderag-nav` 会把 KCodeRag 代码导航接入当前项目。安装完成后，可以直接在 Codex、Claude Code、Cursor、OpenCode 或 ZCode 中让 AI 搜索代码、查看上下文和追踪调用关系。

本文是 KCodeRag Nav 的权威安装与使用指南，由 Nav 仓库独占维护。QA 服务和任务的当前状态以实时响应为准。

## 安装前

- 安装 Node.js 22 或更高版本。
- 进入要使用 KCodeRag 的项目目录。
- 确认当前网络可以访问团队的 KCodeRag QA 服务。

## 安装

最简单的方式是运行：

```powershell
npx kcoderag-nav@latest install
```

然后按提示选择宿主和功能：

- `kcoderag-navigation`：代码搜索、上下文、调用链查询，以及打开 QA 看板。五个宿主都可以安装。
- `code-style-nudge`：写 C/C++/Lua 前提醒加载代码规范。

如果不想交互选择，可以直接指定宿主。五个宿主都可以安装两个 capability；下面以 Codex 为例：

```powershell
npx kcoderag-nav@latest install --host codex --capability kcoderag-navigation --yes
npx kcoderag-nav@latest install --host codex --capability code-style-nudge --yes
```

`--host` 可选值是 `codex`、`claude`、`cursor`、`opencode` 和 `zcode`。

五个宿主都会安装手动代码规范 Skill；Claude Code `2.1.241` 还会获得自动写前提示：

```powershell
npx kcoderag-nav@latest install --host claude `
  --capability kcoderag-navigation `
  --capability code-style-nudge --yes
```

默认安装到当前目录。要安装到另一个项目，加上 `--target`：

```powershell
npx kcoderag-nav@latest install --host codex `
  --capability kcoderag-navigation --target D:\work\my-project --yes
```

安装后重新打开宿主会话。ZCode 第一次打开项目时，还需要在 ZCode 中信任该工作区的项目 Hook。

## 确认安装成功

在项目目录运行：

```powershell
npx kcoderag-nav@latest status --host codex
npx kcoderag-nav@latest doctor --host codex
```

把 `codex` 换成实际宿主。`status` 用于快速检查安装状态，`doctor` 用于进一步排查配置冲突。
代码规范状态会分别显示 `manualSkill` 和 `automaticNudge`；手动可用、自动 unsupported 是正常的
manual-only 安装。状态正常后，重新打开宿主会话。

宿主重新加载后，在支持 Skill/命令列表展示的界面中通常能看到 `$kcoderag`、`$kcoderag-manage`、
`$kcoderag-update`、`$kcoderag-feedback`、`$kcoderag-dashboard` 和 `$kcoderag-code-style`。部分宿主不提供统一列表；无论界面
是否展示，最终都以 `status`/`doctor` 的项目状态为准。

版本字段示例：

```text
installed_version: 0.3.7
latest_version: 0.3.7
version_status: up_to_date
```

- `installed_version`：当前项目给这个宿主安装的版本。
- `latest_version`：本地有界 cache 已知的 npm latest；没有可信 cache 时显示 `unknown`。
- `version_status`：`up_to_date` 表示已是最新，`update_available` 表示可以更新，`unknown` 表示暂时
  无法比较，并不表示安装失败。

`--json` 中对应字段是 `installedVersion`、`latestVersion` 和 `versionStatus`。上面的版本号只用于解释
字段，不声明当前 npm latest；实际版本以命令和 npm registry 返回值为准。

## 日常使用

平时不需要再运行 `kcoderag-nav` 命令，直接在宿主里用自然语言提问即可，例如：

- “用 KCodeRag 搜索处理登录超时的代码。”
- “查看 `SessionManager` 的上下文和主要调用方。”
- “先用 KCodeRag 找到这个功能的入口，再读取本地源码确认。”

AI 会按需要调用这些工具：

- `search_code`：搜索符号或功能实现。
- `context`：查看符号上下文。
- `get_call_chain`：查看调用方和被调用方。
- `list_indexes`：检查图和搜索索引信息。
- `cypher`：执行自定义只读图查询；通常优先使用前三个专用工具。
- `submit_feedback`：针对实际结果提交反馈；通过 `$kcoderag-feedback` 使用。

也可以手动调用六个公开 Skill：

- `$kcoderag`：只读导航、上下文、调用链和索引查询。
- `$kcoderag-manage`：默认只运行 `status`/`doctor`；破坏性生命周期操作必须有明确请求。
- `$kcoderag-update`：只在明确更新请求下确认项目与单宿主，通过公开 npx CLI 更新并复查状态。
- `$kcoderag-feedback`：只针对真实查询结果提交 secret-safe 反馈。
- `$kcoderag-dashboard`：打开 QA 看板或明确指定的构建页面；随导航功能安装。
- `$kcoderag-code-style`：用自然语言准备 C/C++/Lua 修改，或执行
  `$kcoderag-code-style review <file or current changes>`。它没有公开 `apply` 操作。

`$kcoderag` 可以直接接自然语言；如果不清楚怎么写，裸调用或输入 `$kcoderag help` 会先显示以下帮助，
不会立即调用 MCP：

```text
$kcoderag find <query>
$kcoderag context <symbol>
$kcoderag callers <symbol>
$kcoderag callees <symbol>
$kcoderag indexes
$kcoderag impact <symbol-or-change>
```

例如：`$kcoderag find 登录超时处理`、`$kcoderag callers SessionManager`。这些动作是给用户的
意图提示，不需要手写 MCP JSON 参数；Agent 会按当前宿主实际暴露的工具 schema 调用。

五个宿主都提供手动 `code-style-nudge` Skill；native 自动写前提示仅支持冻结的 Claude Code `2.1.241`。
其他宿主仍可手动调用 `$kcoderag-code-style`，但不应期待自动写前提示。

## 打开 QA 看板

在宿主中输入：

```text
$kcoderag-dashboard
```

它会通过宿主可用的浏览器打开工具进入 [QA 看板](http://10.11.39.59:30107/)。也可以直接点击链接；
没有浏览器打开工具的宿主会返回链接，不会声称已经打开。

如果已经有具体构建页面，可以把完整链接附在 `$kcoderag-dashboard` 后。Skill 使用你给出的链接，
不猜测任务 ID。看板与 MCP 查询是两个入口；打开看板不需要把 MCP 凭据粘贴到浏览器地址中。

看板入口只负责打开和查看页面。任务是否完成要核对该任务的阶段、结果和图版本；打开成功、进程退出、
图已切换或向量索引显示 ONLINE，都不能单独说明向量生成和全量验收已经完成。

## 确认查询实际使用了哪种模式

关键词搜索、上下文和调用链可以在向量尚未就绪时使用。需要语义搜索时，Agent 先通过 `list_indexes`
检查索引，再查看实际查询结果中的 `structuredContent` 与 `meta.requested`、`meta.effective`、`changes`。
`vector_available: true` 或索引 ONLINE 只说明索引存在及其状态，不能单独证明服务已允许语义搜索。

如果请求 `semantic` 或 `hybrid`，但 `meta.effective.mode` 是 `keyword`，本次实际使用的是关键词回退。
Agent 应说明回退原因，例如 `serving_keyword_only`，并可继续使用 `context`、`get_call_chain` 获取结构信息；
不能把返回了结果记为语义/混合搜索通过。

2026-10-09 的 QA 接入实测已验证关键词、上下文和调用链可用，当时 semantic/hybrid 仍回退到 keyword。
这是一条有日期的观测，不是永久限制；后续以当前服务响应为准。图是代码快照，修改前仍需读取定位到的源码确认。

## 更新

可以直接告诉 Agent：“请用 `$kcoderag-update` 更新当前项目的 Codex 接入”。Skill 会先确认目标项目与
单宿主，只有收到明确更新请求才会调用公开 CLI。也可以手动运行：

```powershell
npx kcoderag-nav@latest update --host codex
```

从 0.3.8 升级时，新版发布或运行 `status` 不会替换项目内已有的 Hook。要获得 0.3.9 的
Claude Code 状态栏提示或 Codex CLI 可见警告，请先进入目标项目，按当前宿主择一运行：

```powershell
# 使用 Claude Code 时
npx kcoderag-nav@latest update --host claude

# 使用 Codex CLI 时
npx kcoderag-nav@latest update --host codex
```

完成后重新打开对应宿主会话。每条命令只更新所选宿主已安装的功能。

更新提示不会自动安装新版本，也不保证在发布后立即弹出：前台只读最长复用 24 小时的本地 cache；cache
过期时，当前事件通常只在后台刷新 npm latest，后续符合条件的事件或下一次会话才可能看到提示。

- Claude Code 在原有 GSD 或其他状态栏后追加黄色 `↑ /kcoderag-update`，更新后不再显示。
  安装器在项目 `.claude/settings.local.json` 中组合状态栏；保留原输出，无漂移时卸载会逐字节
  恢复安装前的项目配置，不修改用户级 GSD 设置。该文件整体受摘要保护：安装后修改其他字段，
  也可能使更新或卸载报 `managed_content_changed` 并停止写入。请先保留手工修改，再按
  `doctor --host claude` 的定位处理漂移，不要直接覆盖新内容。
  只有明确高于已安装版本的有效 cache 才显示提示。
- Codex CLI 在会话启动或后续工具事件中直接显示更新警告，并提供 `$kcoderag-update` 入口。
  这使用原生 Hook `systemMessage`，不依赖模型转述；Codex 状态栏没有自定义命令入口，原设置保持不变。
  冷 cache 刚完成后台刷新且尚未调用工具时，提示可能等到后续工具事件或新会话才出现。
- ZCode 会把已知提示加入宿主上下文。
- OpenCode 会在成功工具事件后显示 warning toast。
- Cursor 不提供自动更新提示；需要时请明确调用 `$kcoderag-update` 或运行上面的单宿主命令。

任何自动提示都只建议更新并要求先征得用户同意，绝不自行运行 install/update。更新完成后重新打开宿主
会话，再运行 `status`；如需深查来源冲突，再运行 `doctor`。

## 卸载

卸载当前宿主的全部 KCodeRag Nav 功能：

```powershell
npx kcoderag-nav@latest uninstall --host codex --all
```

只卸载某个功能：

```powershell
npx kcoderag-nav@latest uninstall --host codex --capability kcoderag-navigation
```

## 常见问题

- 看不到 `$kcoderag-dashboard`：更新该项目的 `kcoderag-navigation`，然后重新打开宿主会话。
- 看板无法打开：确认当前网络能访问 QA，看板链接本身不携带 MCP 凭据。
- 新版本暂时出现 npm `ETARGET` 或 404：发布后 registry 可能仍在处理，稍后重试安装即可，无需清空全局缓存。
- 看不到 KCodeRag 工具：运行 `status` 和 `doctor`，然后重新打开宿主会话。
- `version_status` 显示 `unknown`：latest cache 暂时不可用；安装可能仍然健康，稍后重开会话或再检查。
- Claude Code 状态栏暂时没有更新提示：先用 `status --host claude` 查看版本；cache 未刷新、
  已是最新或设置了 `KCODERAG_NAV_UPDATE_CHECK=0` 时不显示。安装或更新接入后重新打开会话。
- Cursor 没有更新弹窗：这是当前设计，请手动调用 `$kcoderag-update` 或运行显式更新命令。
- `automaticNudge` 显示 `unsupported`：当前宿主没有冻结的 native 写前提示证据；仍可手动调用
  `$kcoderag-code-style`。
- 出现 `source_conflict`：项目里已有另一份手工或旧版接入。先人工确认并移除重复来源，再重新安装。
- 出现 `capability_drift` 或 `managed_content_changed`：受管文件被修改，更新和卸载会停止写入。
  先保留手工修改，再运行所选宿主的 `doctor` 定位并处理漂移；不要直接覆盖新内容。
- ZCode 没有执行 Hook：确认已经信任当前工作区，并重新打开会话。
