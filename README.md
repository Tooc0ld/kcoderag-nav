# KCodeRag Nav Plugins

本仓库从一份规范源生成两个可独立安装的 KCodeRag 导航插件：普通用户使用
`kcoderag-qa`，开发与环境验证使用 `kcoderag-dev`。两个包都支持 Codex，并保留
Claude Code marketplace、MCP、skill 与 `PreToolUse` hook 兼容路径。

## 推荐：项目级安装（默认 QA）

在本仓库 checkout 中运行以下命令，把插件资产安装到一个**受信任的目标项目**：

```powershell
python scripts/manage_project_install.py install --target PATH
```

未指定环境时只安装 QA。安装器仅管理目标项目内的 `.codex/` 与 `.agents/` 内容，
不会调用用户级 plugin 命令，也不会修改用户级 Codex config 或 cache。目标项目必须受
信任，因为 Codex/Claude Code 会从其中加载 hook 与 MCP 配置。

开发或测试人员可显式选择 Dev 或双环境：

```powershell
python scripts/manage_project_install.py install --target PATH --environment dev
python scripts/manage_project_install.py install --target PATH --environment both
```

按环境独立卸载；从双装状态移除一个环境不会删除另一个环境：

```powershell
python scripts/manage_project_install.py uninstall --target PATH --environment qa
python scripts/manage_project_install.py uninstall --target PATH --environment dev
```

若受管文件在安装后被修改，卸载会安全拒绝并报告冲突路径，不覆盖或删除用户内容。

## 环境路由

- 仅安装一个环境时查询该环境。
- QA 与 Dev 双装且未指定环境时默认查询 QA。
- 明确指定 Dev 时只查询 Dev。
- 只有明确要求环境比较时才同时查询 QA 与 Dev。
- 选中的环境不可达时明确报告，不静默切换或回退到另一个环境。

QA 与 Dev 的匹配 hook 可能由宿主并发启动；跨进程原子去重确保同一工具调用最多注入
一次 advisory context。解析、身份或去重异常都 fail-open，不阻止原始搜索。

## 可选：用户级 Codex 插件路径

以下是显式的用户级可选安装方式，不是 project scope：

```powershell
codex plugin marketplace add Tooc0ld/kcoderag-nav
codex plugin add kcoderag-qa@kcoderag-nav
```

Codex 当前没有原生 project-scope plugin install；本仓库的项目级行为由上面的兼容
安装器提供。双装仅用于开发或环境对比，可再显式安装 `kcoderag-dev@kcoderag-nav`。

## Claude Code marketplace

```text
/plugin marketplace add Tooc0ld/kcoderag-nav
/plugin install kcoderag-qa@kcoderag-nav
```

## 内部凭据边界

当前 QA/Dev 内部测试阶段的插件包携带装即用 Bearer，并连接内部 HTTP endpoint；
本仓库不会在生成器、安装器、测试输出或文档中打印凭据值。生产级身份、HTTPS 与轮换
不属于当前版本范围。

## 离线验证

```powershell
python scripts/generate_plugins.py --check
python -m unittest discover -s tests -p "test_*.py" -v
python kcoderag-qa/hooks/test_grep_nudge.py
python kcoderag-dev/hooks/test_grep_nudge.py
```
