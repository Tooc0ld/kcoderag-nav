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

需要 Dev 或环境比较时才显式安装：

```powershell
python scripts/manage_project_install.py install --target PATH --environment dev
python scripts/manage_project_install.py install --target PATH --environment both
```

Claude Code 使用仓库 marketplace 的 project scope 安装；不要把 Codex 项目安装器当成
Claude Code 的 project-scope plugin 命令。

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

## 查询与环境路由

QA 插件提供 `search_code`、`context`、`get_call_chain`、`list_indexes`、`cypher` 与
`submit_feedback` 六个正式工具。常见路径是先用 `search_code` 找到符号，再用 `context`
查看关系和源码，最后用 `get_call_chain` 追踪调用方向。

仅安装一个环境时查询该环境；QA 与 Dev 双装且未指定环境时默认 QA。只有明确指定 Dev 或
明确要求环境比较时才查询 Dev 或两侧。选中的环境不可达时应明确报告，不静默回退。

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
