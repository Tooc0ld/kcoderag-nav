# KCodeRag Nav 安装和使用

`kcoderag-nav` 会把 KCodeRag 代码导航接入当前项目。安装完成后，可以直接在 Codex、Claude Code、Cursor、OpenCode 或 ZCode 中让 AI 搜索代码、查看上下文和追踪调用关系。

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

- `kcoderag-navigation`：代码搜索、上下文和调用链查询。五个宿主都可以安装。
- `code-style-nudge`：写 C/C++/Lua 前提醒加载代码规范。目前只支持 Claude Code `2.1.241`，其他宿主当前不要选择。

如果不想交互选择，可以直接指定宿主。下面以 Codex 为例：

```powershell
npx kcoderag-nav@latest install --host codex --capability kcoderag-navigation --yes
```

`--host` 可选值是 `codex`、`claude`、`cursor`、`opencode` 和 `zcode`。

Claude Code `2.1.241` 可以同时安装两个功能：

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

把 `codex` 换成实际宿主。`status` 用于快速检查安装状态，`doctor` 用于进一步排查配置冲突。状态正常后，重新打开宿主会话。

## 日常使用

平时不需要再运行 `kcoderag-nav` 命令，直接在宿主里用自然语言提问即可，例如：

- “用 KCodeRag 搜索处理登录超时的代码。”
- “查看 `SessionManager` 的上下文和主要调用方。”
- “先用 KCodeRag 找到这个功能的入口，再读取本地源码确认。”

AI 会按需要调用这些工具：

- `search_code`：搜索符号或功能实现。
- `context`：查看符号上下文。
- `get_call_chain`：查看调用方和被调用方。
- `list_indexes`：检查当前可用的搜索索引。

## 更新

```powershell
npx kcoderag-nav@latest update --host codex
```

更新后重新打开宿主会话。

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

- 看不到 KCodeRag 工具：运行 `status` 和 `doctor`，然后重新打开宿主会话。
- 出现 `host_version_unsupported`：当前宿主不能安装 `code-style-nudge`，只安装 `kcoderag-navigation`。
- 出现 `source_conflict`：项目里已有另一份手工或旧版接入。先人工确认并移除重复来源，再重新安装。
- 出现 `capability_drift`：受管文件被修改。先恢复这些修改，再运行更新。
- ZCode 没有执行 Hook：确认已经信任当前工作区，并重新打开会话。
