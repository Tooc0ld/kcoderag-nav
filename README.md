# KCodeRag Nav Plugins

本仓库从一份规范源生成两个可独立安装、但互斥使用的 KCodeRag 导航插件：普通用户使用
`kcoderag-qa`，开发与环境验证使用 `kcoderag-dev`。两个环境包都支持 Codex，并保留
Claude Code marketplace、MCP、skill 与 `PreToolUse` hook 兼容路径；另生成一个互斥环境的
Cursor 免费本地插件 `kcoderag-nav`。

面向 QA 使用者的完整接入与体验指南由 KCodeRag 服务仓库独占维护，见
[MCP_QA_EXPERIENCE_GUIDE.md](https://github.com/Tooc0ld/KCodeRag/blob/main/MCP_QA_EXPERIENCE_GUIDE.md)；
本分发仓库不保留副本。

## 推荐：项目级安装（默认 QA）

在本仓库 checkout 中运行以下命令，把插件资产安装到一个**受信任的目标项目**：

```powershell
python scripts/manage_project_install.py install --target PATH
```

未指定环境时只安装 QA。安装器仅管理目标项目内的 `.codex/` 与 `.agents/` 内容，
不会调用用户级 plugin 命令，也不会修改用户级 Codex config 或 cache。项目级安装只对
**Codex** 生效——Claude Code 不读取 `.codex/`与 `.agents/`，请使用下文的
marketplace 插件安装。目标项目必须受信任，因为 Codex 会从其中加载 hook 与 MCP 配置。

开发或测试人员可显式选择 Dev：

```powershell
python scripts/manage_project_install.py install --target PATH --environment dev
```

QA 与 Dev 不能同时安装。若要切换环境，先卸载当前环境，再安装另一个：

```powershell
python scripts/manage_project_install.py uninstall --target PATH --environment qa
python scripts/manage_project_install.py uninstall --target PATH --environment dev
```

若受管文件在安装后被修改，卸载会安全拒绝并报告冲突路径，不覆盖或删除用户内容。

安装或升级前可只读检查目标项目；机器消费场景使用稳定 JSON：

```powershell
python scripts/manage_project_install.py status --target PATH
python scripts/manage_project_install.py status --target PATH --json
```

状态区分 `healthy`、`not_installed`、`drifted`、`update_available` 与 `invalid`。
退出码为：0 = `healthy`；1 = 未安装、本地 drift 或存在可用源更新；2 = `invalid`。
诊断只包含稳定状态、环境、问题 code 与项目相对 path，不输出受管文件内容、摘要或 MCP
配置值，也不会修改或清理目标目录。

## 更新感知与应用

向 `master` 推送新代码不会主动替换其他用户已经缓存或安装的插件。旧版安装不包含本节所述
checker，因此必须先手动刷新一次；完成这次升级后，插件才具备后续的低打扰更新感知。

新版 QA/Dev 插件只在每个会话首次相关 `PreToolUse`（`Grep`、`Glob` 或 `Bash`）到来时
读取本地版本缓存。缓存新鲜时直接比较；缓存缺失或过期时只抢占刷新锁并启动隐藏的后台刷新，
当前工具调用不等待网络。后台 worker 仍使用固定 GitHub URL、1.5 秒超时、严格 schema 与原子
缓存写入；刷新成功后，同一 session 的下一次相关 `PreToolUse` 即可读取新缓存并提示，如果没有
后续调用则由下一个 session 感知。

同一 session 在消费过新鲜缓存后不重复检查或提示；缺少 session id 时，按环境、项目和一小时
时间桶做有界 throttle。已验证结果缓存 24 小时，因此新 session 通常只读缓存。网络、schema、
process launch、lock 或 cache 异常全部静默 fail-open，不影响原工具。

提示只报告当前版本、新版本和固定更新命令，并要求 AI 先取得用户确认；hook 不会自动刷新
marketplace、重装插件或修改项目。普通 marketplace 用户应优先使用下面的宿主原生命令；这些
命令可以在任意目录执行，不需要本仓库 checkout。普通用户保持 `qa` 不变，Dev 测试人员把插件名
改为 `kcoderag-dev`：

```powershell
codex plugin marketplace upgrade kcoderag-nav --json
codex plugin add kcoderag-qa@kcoderag-nav --json

claude plugin marketplace update kcoderag-nav
claude plugin update kcoderag-qa@kcoderag-nav --scope project
```

如果已经 checkout 本仓库，可以改用下面的可选安全封装；它按相同顺序调用原生命令，任何一步
失败都会停止，且只返回稳定的 stage/reason，不透传宿主 stdout/stderr：

```powershell
python scripts/update_plugin.py --host codex --environment qa
python scripts/update_plugin.py --host claude --environment qa
```

项目级 update 仍要求本仓库 checkout；先更新 checkout，再保留当前唯一环境刷新目标项目：

```powershell
git pull --ff-only
python scripts/manage_project_install.py update --target PATH
```

更新成功后开启新的 Codex thread 或 Claude session 以加载新插件。更新不会切换环境；QA/Dev
切换仍须先卸载再安装。

## 环境选择

- 默认只安装并查询 QA；显式选择 Dev 时只安装并查询 Dev。
- 项目安装器拒绝 `both` 以及在未卸载当前环境时安装另一个环境。
- 已安装环境不可达时明确报告，不静默查询另一个 KCodeRag 环境。
- 索引不可用或陈旧时，可以明确退回本地搜索。

单环境 hook 只在用户 cache 中创建有界、hash 命名的 session marker、版本 cache 与短期 refresh
lock，不写入目标项目或插件目录。解析和状态异常仍 fail-open，不阻止原始搜索。

hook source 明确要求 Python 3.10+。POSIX launcher 依次探测 `python3`、`python`；
Windows launcher 依次探测 `py -3`、`python3`、`python`。只有合格解释器才执行 hook；
缺失、版本过旧、probe 或 launch 失败全部静默 fail-open（exit 0，空诊断），不会阻断宿主。

## 可选：用户级 Codex 插件路径

以下是显式的用户级可选安装方式，不是 project scope：

```powershell
codex plugin marketplace add Tooc0ld/kcoderag-nav
codex plugin add kcoderag-qa@kcoderag-nav
```

Codex 当前没有原生 project-scope plugin install；本仓库的项目级行为由上面的兼容
安装器提供。当前 Codex plugin manifest 也没有插件互斥字段，因此用户级路径无法由宿主
自动阻止双装；同时启用 `kcoderag-qa` 与 `kcoderag-dev` 属于不支持的配置，切换前必须先
卸载或禁用现有环境。
仓库根同时携带 Codex 版 marketplace 清单 `.agents/plugins/marketplace.json`（Claude
Code 版在 `.claude-plugin/marketplace.json`）。插件包的 `.mcp.json` 保留 Claude Code
格式；Codex 清单指向独立生成的 `.codex.mcp.json`（`mcp_servers` 封装）。

## Claude Code marketplace（project scope）

以下 CLI 命令把 marketplace 与 QA 插件安装限定在当前项目；卸载时使用相同 scope：

```powershell
claude plugin marketplace add Tooc0ld/kcoderag-nav --scope project
claude plugin install kcoderag-qa@kcoderag-nav --scope project
claude plugin uninstall kcoderag-qa@kcoderag-nav --scope project
```

插件不做权限预授权：首次调用 KCodeRag MCP 工具时宿主会弹出权限确认，批准后放行。
否则需要把 `mcp__plugin_kcoderag-qa_kcoderag-qa__*`（dev 同理）自行加入 settings 的
`permissions.allow`。

## Cursor 免费本地插件

Cursor 分发只提供一个 `kcoderag-nav` 插件，位于生成目录 `kcoderag-cursor/`，仓库根清单为
`.cursor-plugin/marketplace.json`。插件只声明一个通用 `kcoderag` MCP server，因此不会出现
QA 与 Dev 同时启用；内置默认配置选择 QA。免费安装使用 Cursor 官方本地插件目录，
**不需要 Cursor Team**、Dashboard 或团队管理员。

安装管理命令需要 Python 3.10+，只使用标准库、无需 pip 依赖。保留一个本仓库 checkout，
在仓库根目录运行：

```powershell
git clone https://github.com/Tooc0ld/kcoderag-nav.git
Set-Location kcoderag-nav
python scripts/manage_cursor_local_install.py install
python scripts/manage_cursor_local_install.py status --json
```

安装器把自包含生成包复制到：

```text
~/.cursor/plugins/local/kcoderag-nav
```

Windows 中 `~` 是 `%USERPROFILE%`。安装后重启 Cursor 或执行
**Developer: Reload Window**，再在新 Agent 会话确认 `kcoderag` MCP server、Rule 和 skill
已加载。不要在本仓库中安装或打开它作为查询目标，否则维护搜索会被自己的插件配置影响。

安装器只拥有 `kcoderag-nav` 目录及其相邻状态文件；不会覆盖未托管目录。若安装内容被手工
修改，`status` 返回 `drifted`，`update` 和 `uninstall` 会在删除任何内容前拒绝。

### Cursor 更新与卸载

本地安装器不会自动联网。先更新 checkout，再安全覆盖未漂移的旧安装：

```powershell
git pull --ff-only
python scripts/manage_cursor_local_install.py status --json
python scripts/manage_cursor_local_install.py update
```

更新后执行 **Developer: Reload Window**。重复执行 `install` 也是幂等的：当前版本不写入，
checkout 包更新时等价于安全更新。卸载命令为：

```powershell
python scripts/manage_cursor_local_install.py uninstall
```

Team Marketplace 只是付费可选路径，不是普通用户安装 KCodeRag 的前置条件。需要测试 Dev 时，
在插件的
**Configure** 中成对替换 `KCODERAG_MCP_URL` 与 `KCODERAG_BEARER_TOKEN`；测试结束后也应成对
恢复 QA 配置。

Cursor 的 `preToolUse` hook 不能在工具执行前注入 advisory context，因此 Cursor 包不复制
现有 hook，而使用精简的 always-on Rule 加共享 skill。该 Rule 仍明确允许精确字符串、未提交
改动，以及索引不可用或陈旧时的本地搜索回退。

## 维护者提交前生成

本仓库提供版本化的 `.githooks/pre-commit`。每个新 clone 需要显式启用一次：

```powershell
git config core.hooksPath .githooks
```

之后每次 `git commit` 都会先运行等价于
`python scripts/generate_plugins.py --write` 的确定性生成流程，同时刷新 QA、Dev 与 Cursor
的内容哈希版本。若生成物发生变化，本次提交会中止；hook 不会自动执行 `git add`。请检查
差异、暂存生成物，再重新提交。若规范源存在“部分已暂存、部分未暂存”的状态，hook 会在
生成前拒绝，避免规范源与提交中的包不一致。

这个 hook 只刷新 `+codex.<hash>` / `+cursor.<hash>`，不会自动修改
`plugin-src/version.txt` 的基础 SemVer；需要发布新的基础版本时仍由维护者显式修改。CI 继续
只运行 `--check`，不会替开发者生成、提交或 push 文件。

Cursor 的本地内容哈希也由同一个生成器维护；免费本地安装用户在 checkout 执行
`git pull --ff-only`，再运行 `python scripts/manage_cursor_local_install.py update` 并 reload。
Cursor 包不增加运行时更新 hook，也不把网络检查放进 Agent 工具调用路径。

## 纯 MCP 安装

纯 MCP 安装只连接 MCP server，不包含 plugin hook、skill 或 agent 行为。它适合只需要协议工具
连接的场景；查询前提醒、环境路由纪律和专用 agent 工作流仍需完整插件安装。

## 内部连接边界

当前 QA/Dev 内部测试包及 Cursor 本地插件默认变量携带受控连接配置和认证材料。本仓库不会
在生成器、安装器、status、测试输出或公开指南中打印这些值。Cursor 包只能进入受限的私有
本地目录或付费私有 Team Marketplace，不能提交公共 Cursor Marketplace。生产级身份、传输
升级、团队后台注入凭据与轮换不属于当前版本范围。

## CI 分层

required CI 使用 Python 3.10 与较新版本的 Ubuntu/Windows matrix，离线运行 generation
check、全套 unittest、两份 generated hook regression 与 loopback stub MCP 合同；不依赖
内部服务或模型认证。optional host smoke 只能由显式 workflow dispatch 在预装、已认证的
隔离 runner 上运行，并仍只连接 loopback stub。

Codex headless smoke 会传 `--dangerously-bypass-hook-trust`，但仅限已经 vet 的临时 hook
source，同时保持 read-only sandbox。普通用户安装不得复制该 trust bypass，也不得加入
blanket approval 或 sandbox bypass。

## 离线验证

```powershell
python scripts/generate_plugins.py --check
python -m unittest discover -s tests -p "test_*.py" -v
python kcoderag-qa/hooks/test_grep_nudge.py
python kcoderag-dev/hooks/test_grep_nudge.py
```
