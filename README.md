# KCodeRag Nav Plugins

本仓库从一份规范源生成两个可独立安装、但互斥使用的 KCodeRag 导航插件：普通用户使用
`kcoderag-qa`，开发与环境验证使用 `kcoderag-dev`。两个环境包都支持 Codex，并保留
Claude Code marketplace、MCP、skill 与 `PreToolUse` hook 兼容路径；另生成一个互斥环境的
Cursor 私有插件 `kcoderag-nav`。

面向 QA 使用者的完整安装、状态诊断和 smoke 流程见
[MCP_QA_EXPERIENCE_GUIDE.md](MCP_QA_EXPERIENCE_GUIDE.md)。

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
延迟检查。相同 session 后续不再检查或提示；缺少 session id 时，按环境、项目和一小时时间桶
做有界 throttle。已验证的远端版本结果缓存 24 小时，所以新 session 可以复用缓存而不重复
访问 GitHub，但每个新 session 最多仍会收到一次可用更新提示。网络、schema、lock 或 cache
异常全部静默 fail-open，不影响原工具。

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

## Cursor 私有插件

Cursor 分发只提供一个 `kcoderag-nav` 插件，位于生成目录 `kcoderag-cursor/`，仓库根清单为
`.cursor-plugin/marketplace.json`。插件只声明一个通用 `kcoderag` MCP server，因此不会出现
QA 与 Dev 同时启用；内置默认配置选择 QA。

团队分发使用 Cursor Dashboard 的 **Plugins → Team Marketplaces → Import from Repo** 导入本
仓库，然后把 `kcoderag-nav` 的安装模式设为 **Default Off**。开发者从 Cursor 的
**Customize** 页面安装并选择 **project scope**。不要在本仓库中安装这个插件，否则会让维护
和验收搜索被本项目自己的 KCodeRag 配置影响。

本地开发时，可把生成目录复制或链接到：

```text
~/.cursor/plugins/local/kcoderag-nav
```

然后重启 Cursor 或执行 **Developer: Reload Window**。需要测试 Dev 时，在插件的
**Configure** 中成对替换 `KCODERAG_MCP_URL` 与 `KCODERAG_BEARER_TOKEN`；测试结束后也应成对
恢复 QA 配置。

Cursor 的 `preToolUse` hook 不能在工具执行前注入 advisory context，因此 Cursor 包不复制
现有 hook，而使用精简的 always-on Rule 加共享 skill。该 Rule 仍明确允许精确字符串、未提交
改动，以及索引不可用或陈旧时的本地搜索回退。

## 纯 MCP 安装

纯 MCP 安装只连接 MCP server，不包含 plugin hook、skill 或 agent 行为。它适合只需要协议工具
连接的场景；查询前提醒、环境路由纪律和专用 agent 工作流仍需完整插件安装。

## 内部连接边界

当前 QA/Dev 内部测试包及 Cursor 私有插件默认变量携带受控连接配置和认证材料。本仓库不会
在生成器、安装器、status、测试输出或公开指南中打印这些值。Cursor 包只能进入受限的私有
Team Marketplace，不能提交公共 Cursor Marketplace。生产级身份、传输升级、团队后台注入
凭据与轮换不属于当前版本范围。

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
