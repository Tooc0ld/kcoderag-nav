# KCodeRag Nav QA 体验指南

本指南说明如何通过本仓库安全安装、检查和验证 QA 导航插件。连接配置与认证材料由受控插件
携带；使用者不需要把这些内容复制到命令、日志或问题报告中。

维护要求：任何影响安装、卸载、更新、发布、宿主兼容、路由或 hook 的变更，都必须在同一
变更中同步更新本指南；自动化测试会锁定其中的关键操作契约。

## 安装与 Python runtime

项目级 Codex 安装要求受信任目标目录，hook source 要求 Python 3.10+：

```powershell
python scripts/manage_project_install.py install --target PATH
```

POSIX launcher 按 `python3`、`python` 顺序探测；Windows launcher 按 `py -3`、
`python3`、`python` 顺序探测。只有版本不低于 3.10 的解释器才会执行 hook。解释器缺失、
版本过旧、probe 失败或 launch 失败都会静默 fail-open，原宿主工具继续执行。

需要 Dev 时先卸载当前 QA 安装，再显式安装 Dev：

```powershell
python scripts/manage_project_install.py uninstall --target PATH --environment qa
python scripts/manage_project_install.py install --target PATH --environment dev
```

项目安装器拒绝 QA 与 Dev 双装，也拒绝未先卸载当前环境的跨环境安装。

Claude Code 使用仓库 marketplace 的 project scope 安装；不要把 Codex 项目安装器当成
Claude Code 的 project-scope plugin 命令。

```powershell
claude plugin marketplace add Tooc0ld/kcoderag-nav --scope project
claude plugin install kcoderag-qa@kcoderag-nav --scope project
claude plugin uninstall kcoderag-qa@kcoderag-nav --scope project
```

前两条命令完成当前项目的 marketplace 注册与 QA 插件安装；第三条只卸载当前项目中的插件。

## 纯 MCP 安装

纯 MCP 安装只连接 MCP server，不包含 plugin hook、skill 或 agent 行为。选择这条路径时仍可调用
协议工具，但不会获得插件提供的查询提醒、环境路由纪律或专用 agent 工作流。

## 只读状态诊断

安装、升级或排障前运行：

```powershell
python scripts/manage_project_install.py status --target PATH
python scripts/manage_project_install.py status --target PATH --json
```

状态含义：

- `healthy`：安装 bytes、ownership state 与当前 source 一致，退出码 0。
- `not_installed`：没有安装记录，退出码 1。
- `drifted`：受管文件丢失或被本地修改，退出码 1。
- `update_available`：安装本身未漂移，但当前 source 已更新，退出码 1。
- `invalid`：目标、state、ownership 或路径边界无效，退出码 2。

输出只包含状态、active environment、稳定 issue code 和项目相对 path。命令不会修复、
prune 或重写目标，也不会打印配置内容或摘要。

## 更新感知与应用

仓库 `master` 更新后，已经安装的 plugin cache 不会自动被替换。旧版安装尚未携带更新 checker，
需要先按下面对应路径手动升级一次；此后才会在会话中感知新版本。

新版插件在每个 session 的首次相关 `PreToolUse`（`Grep`、`Glob` 或 `Bash`）只读取本地版本
缓存。缓存新鲜时直接比较；缓存缺失或过期时只抢占刷新锁并启动隐藏的后台刷新，
当前工具调用不等待网络。后台 worker 仍使用固定 GitHub URL、1.5 秒超时、严格 schema 与原子缓存写入；
刷新成功后，同一 session 的下一次相关 `PreToolUse` 即可提示，如果没有后续调用则由下一个
session 感知。

同一 session 在消费过新鲜缓存后不重复检查或提示；宿主没有 session id 时，用当前环境、
规范化项目路径与一小时时间桶做有界 throttle。严格验证的结果缓存 24 小时。网络、schema、
process launch、lock 或 cache 异常全部静默 fail-open，原工具照常执行。

更新提示只是 advisory：AI 必须先询问用户，不能自动调用 installer 或宿主 CLI。普通 marketplace 用户
应优先使用以下原生命令；它们可在任意目录执行，不要求本仓库 checkout：

```powershell
codex plugin marketplace upgrade kcoderag-nav --json
codex plugin add kcoderag-qa@kcoderag-nav --json

claude plugin marketplace update kcoderag-nav
claude plugin update kcoderag-qa@kcoderag-nav --scope project
```

已经 checkout 本仓库时，可选安全封装会按相同顺序调用上述命令，并在第一步失败后停止；输出只
保留稳定 reason/stage，不包含捕获的宿主输出：

```powershell
python scripts/update_plugin.py --host codex --environment qa
python scripts/update_plugin.py --host claude --environment qa
```

项目级 update 仍要求本仓库 checkout；先更新 checkout，再保留当前单一环境刷新目标项目：

```powershell
git pull --ff-only
python scripts/manage_project_install.py update --target PATH
```

若 `status` 为 `drifted` 或 `invalid`，update 会在写入前拒绝；先处理本地变更或 state 问题。
命令不接受 `--environment`，不会把 QA 切到 Dev。更新成功后开启新的 Codex thread 或 Claude
session。需要 Dev 时仍须先卸载 QA，再安装 Dev；update 本身不负责切换环境。

## Cursor 私有插件接入与更新

Cursor 只分发一个配置单一环境的 `kcoderag-nav` 私有插件，内置默认配置连接 QA。普通 QA
用户不需要 checkout 本仓库，也不需要手工配置 MCP JSON；由团队管理员先接入私有 Team
Marketplace，再由开发者在自己的业务项目中安装。Team Marketplace 要求 Cursor **Teams 或
Enterprise** 方案（即 Teams 或 Enterprise）。

### 管理员：接入 Team Marketplace

执行者需要 Cursor 团队管理员权限，并确保 Cursor GitHub App 能读取本仓库：

1. 打开 Cursor **Dashboard → Integrations**，连接 GitHub；若选择
   **Selected repositories**，把 `Tooc0ld/kcoderag-nav` 加入授权范围。GitHub App 是后续
   Auto Refresh 接收 push 的前提。
2. 打开 **Dashboard → Plugins → Team Marketplaces → Add Marketplace**，选择
   **Import from Repo**，导入 `Tooc0ld/kcoderag-nav` 并跟踪 `master`。
3. 确认 Cursor 从仓库根 `.cursor-plugin/marketplace.json` 识别出唯一插件
   `kcoderag-nav`；不要把 `kcoderag-qa`、`kcoderag-dev` 当作 Cursor 插件分别导入。
4. 在 **Marketplace Settings → Marketplace Access** 中只授权目标内部团队或组织组；把
   `kcoderag-nav` 的安装模式设为 **Default Off**，让开发者自行选择项目安装。
5. 开启 **Enable Auto Refresh** 并保存。跟踪分支 push 后 Cursor 最多每 10 分钟重新索引
   一次，并把短时间连续 push 合并到最新提交；若未刷新，管理员手动点击 **Refresh**。

**Default Off 只控制是否默认安装**，不等于关闭更新；自动更新由 **Enable Auto Refresh**
单独控制。Cursor 官方流程见 [Plugins 文档](https://cursor.com/docs/plugins)。

### 开发者：按项目安装 QA

1. 在 Cursor 中打开真正要查询的业务项目。不要在 `kcoderag-nav` 分发仓库本身安装，否则
   本项目的 KCodeRag 配置会影响插件维护与验收搜索。
2. 从侧边栏打开 **Customize**，在团队 Marketplace 中找到 `kcoderag-nav`，选择 **Install → project scope**；
   不要选择 user scope，以免它进入无关项目。
3. 若安装流程显示 **Configure**，普通用户接受内置 QA 默认配置即可，不需要向维护者索取
   URL 或 Bearer，也不要把配置值复制到日志或问题报告中。
4. 执行 **Developer: Reload Window**，或关闭当前 Agent 会话并重新开启，以加载 Rule、Skill
   和 MCP 配置。
5. 回到 Customize，按 project scope 过滤，确认 `kcoderag-nav` 已安装，并确认通用 MCP server `kcoderag`
   已启用。首次工具调用若出现权限确认，只批准该 KCodeRag MCP。
6. 新开 Agent 会话，先要求使用 KCodeRag 的 `list_indexes` 查看索引，再用 `search_code`
   查询一个唯一的 C++ 符号。两步都有结构化工具结果即完成接入验收；索引不可用或陈旧时，
   仍允许明确退回限定范围的本地搜索。

### 切换 Dev、卸载与本地 fallback

- 普通用户保持 QA。测试 Dev 时，在 **Customize → kcoderag-nav → Configure** 中把
  `KCODERAG_MCP_URL` 与 `KCODERAG_BEARER_TOKEN` **必须成对**替换为受控 Dev profile；
  QA 与 Dev 不能共存，也不能只替换其中一个值。测试完成后成对恢复 QA，或卸载后重装以恢复
  内置默认值。
- 卸载时，在目标项目的 Customize 中按 project scope 找到插件并选择 **Uninstall**，然后
  reload。项目级卸载不应影响其他项目。
- Team Marketplace 更新后，执行 **Developer: Reload Window** 或开启新的 Agent 会话。若
  Auto Refresh 未触发，先由管理员手动 **Refresh**，再让开发者重新聚焦窗口或重启 Cursor。
- 只有插件开发者才使用本地 fallback。Windows 目录为
  `%USERPROFILE%\.cursor\plugins\local\kcoderag-nav`，POSIX 目录为
  `~/.cursor/plugins/local/kcoderag-nav`；复制或链接生成的 `kcoderag-cursor/` 内容后 reload。
  本地目录不受 Team Marketplace Auto Refresh 管理，复制安装每次更新都要重新复制 `kcoderag-cursor/`。

### 维护者提交与 Cursor 版本生成

仓库维护者在每个 clone 中执行一次：

```powershell
git config core.hooksPath .githooks
```

此后 `git commit` 会先运行等价于 `python scripts/generate_plugins.py --write` 的流程，统一
刷新 QA、Dev 与 Cursor 的确定性内容哈希。生成物变化时提交会中止，hook 不会自动执行 `git add`；
检查并暂存生成物后再提交。规范源若同时包含已暂存和未暂存改动，也会在生成前
被拒绝，避免提交错配。

基础 SemVer 仍由维护者显式修改 `plugin-src/version.txt`，pre-commit 不自动升级它。Cursor
本地包由上述生成器刷新；已安装用户通过 **Team Marketplace Auto Refresh** 或管理员手动
**Refresh** 获取 push 后的更新，不需要自定义运行时更新 hook。使用本地复制目录时仍须重新
复制并 reload。

## 查询与环境选择

QA 插件提供 `search_code`、`context`、`get_call_chain`、`list_indexes`、`cypher` 与
`submit_feedback` 六个正式工具。常见路径是先用 `search_code` 找到符号，再用 `context`
查看关系和源码，最后用 `get_call_chain` 追踪调用方向。

导航只查询当前安装的单一环境。选中的环境不可达时应明确报告，不静默查询另一个 KCodeRag
环境；索引不可用或陈旧时允许明确退回本地搜索。

## CI 与 host smoke

required CI 完全离线且确定性运行：Python 3.10 与较新版本在 Ubuntu/Windows 上检查生成
drift、全套 unittest、两个 generated hook regression，以及 POSIX/Windows launcher 和
loopback stub MCP 协议。它不依赖内部环境或模型认证。

optional host smoke 只在显式 workflow dispatch、预装且已认证的隔离 runner 上运行：

```powershell
python scripts/run_host_smoke.py --host codex --json
python scripts/run_host_smoke.py --host claude --json
```

smoke 每次创建临时 git workspace、临时 host config/cache、合成 source 与只绑定 loopback
的 MCP stub。只有宿主结构化 hook event、结构化 tool event 和 stub tool-call receipt 同时
存在才返回 `PASS`；缺 CLI 或认证时返回稳定 `NOT_RUN`，不会把模型自然语言当作证据。

Codex 的 `--dangerously-bypass-hook-trust` 仅用于该已 vet hook source 的隔离自动化，且仍
保持 read-only sandbox。普通用户流程不应复制这一 trust bypass，也不应增加 blanket
approval 或 sandbox bypass。

更多安装、卸载和路由说明见 [README.md](README.md)。

## 安全排障清单

1. 先运行 `status --json`，按状态区分未安装、本地 drift、source update 与 invalid state。
2. 确认宿主已重新加载项目配置，并检查所选环境的工具是否出现。
3. 选中环境不可达时报告该环境，不切换到另一环境掩盖问题。
4. 分享回执时只保留 status、reason、issue code/path 和布尔 evidence；不粘贴 host 配置、
   完整命令输出或认证材料。
