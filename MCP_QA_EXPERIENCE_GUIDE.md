# KCodeRag Nav QA 体验指南

本指南说明如何通过本仓库安全安装、检查和验证 QA 导航插件。连接配置与认证材料由受控插件
携带；使用者不需要把这些内容复制到命令、日志或问题报告中。

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

新版插件在每个 session 的首次相关 `PreToolUse`（`Grep`、`Glob` 或 `Bash`）才延迟检查版本。
同一 session 后续不重复检查或提示；宿主没有 session id 时，用当前环境、规范化项目路径与一小时
时间桶做有界 throttle。严格验证的远端版本结果缓存 24 小时，因此新 session 可以复用缓存，
而不是每个 session 都访问 GitHub。检查失败完全 fail-open，原工具照常执行。

更新提示只是 advisory：AI 必须先询问用户，不能自动调用 installer 或宿主 CLI。项目级 Codex
安装先更新本仓库 checkout，再保留当前单一环境刷新目标项目：

```powershell
git pull --ff-only
python scripts/manage_project_install.py update --target PATH
```

若 `status` 为 `drifted` 或 `invalid`，update 会在写入前拒绝；先处理本地变更或 state 问题。
命令不接受 `--environment`，不会把 QA 切到 Dev。

Codex marketplace 与 Claude Code marketplace 安装使用显式 updater：

```powershell
python scripts/update_plugin.py --host codex --environment qa
python scripts/update_plugin.py --host claude --environment qa
```

前者内部运行 `codex plugin marketplace upgrade kcoderag-nav --json` 后再运行
`codex plugin add kcoderag-qa@kcoderag-nav --json`；后者运行
`claude plugin marketplace update kcoderag-nav` 后再运行
`claude plugin update kcoderag-qa@kcoderag-nav --scope project`。第一步失败后不会执行第二步，
输出只保留稳定 reason/stage，不包含捕获的宿主输出。成功后开启新的 Codex thread 或 Claude
session。需要 Dev 时仍须先卸载 QA，再安装 Dev；update 本身不负责切换环境。

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
