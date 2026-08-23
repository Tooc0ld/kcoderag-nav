# KCodeRag Nav

KCodeRag Nav 是面向 Codex、Claude Code 与 Cursor 的 KCodeRag 项目集成。公共 npm CLI
`kcoderag-nav` 将已编译的 CJS 运行时、导航 skill、MCP 配置和宿主资产写入目标项目的原生
目录。它不是 marketplace plugin；用户不需要 Git checkout、Python 或运行时 TypeScript 编译。

面向 QA 使用者的完整接入与体验指南由 KCodeRag 服务仓库独占维护，见
[MCP_QA_EXPERIENCE_GUIDE.md](https://github.com/Tooc0ld/KCodeRag/blob/main/MCP_QA_EXPERIENCE_GUIDE.md)。
本仓库不保留该指南副本，也不在文档或诊断中展示内置连接凭据。

## 快速安装

要求 Node.js 22 或更高版本。在需要接入 KCodeRag 的项目目录中运行：

```powershell
npx kcoderag-nav@latest install
```

未传 `--host` 时，安装器会交互选择 Codex、Claude Code 或 Cursor；自动化场景显式指定一个
宿主，并用 `--yes` 接受显示的目标路径：

```powershell
npx kcoderag-nav@latest install --host codex --yes
npx kcoderag-nav@latest install --host claude --yes
npx kcoderag-nav@latest install --host cursor --yes
```

目标默认为当前工作目录，不会向上查找 Git 或 SVN 根。每个写操作都会先显示规范化绝对路径并
请求确认；`--target PATH` 可以显式覆盖目标。一次命令只管理一个宿主，因此同一项目中的 Codex、
Claude Code 和 Cursor 安装可以共存，不会互相卸载或覆盖。

## 环境选择

QA 是默认环境，普通用户无需额外参数。Dev 只用于开发和测试，必须显式选择：

```powershell
npx kcoderag-nav@latest install --host codex --environment dev
```

QA 与 Dev 只在同一宿主内互斥，安装器不会自动替换环境。切换前必须为同一宿主显式卸载当前
环境，再安装另一个环境：

```powershell
npx kcoderag-nav@latest uninstall --host codex --environment qa
npx kcoderag-nav@latest install --host codex --environment dev
```

跨宿主可以使用不同环境，例如 Codex QA 与 Cursor Dev 可以同时存在。

## 生命周期命令

所有用户命令都通过公共 `@latest` 入口运行：

```powershell
npx kcoderag-nav@latest install --host codex
npx kcoderag-nav@latest status --host codex
npx kcoderag-nav@latest doctor --host codex
npx kcoderag-nav@latest update --host codex
npx kcoderag-nav@latest uninstall --host codex
```

- `install`：安装一个宿主；同环境、无漂移的重复安装是幂等操作。
- `status`：只读报告安装环境、版本、漂移和更新状态。
- `doctor`：在只读状态基础上报告 Node.js 与宿主集成问题。
- `update`：保留当前宿主环境并更新受管文件；不会切换 QA/Dev。
- `uninstall`：只删除该宿主中能够证明由 KCodeRag Nav 管理的内容。

自动化可为写命令组合 `--host`、`--target`、`--yes` 和 `--json`。`status` 与 `doctor`
始终只读，不需要 `--yes`。若受管文件或 section 已漂移，或者遇到 symlink、特殊文件、模糊
所有权，写操作会在修改任何项目文件前硬停止；失败事务会恢复该宿主的原状态。

首次执行 `npx` 需要从 npm Registry 获取包。网络、registry 或包获取失败发生在 CLI 启动前，
因此不会写入目标项目；恢复网络后重试相同命令即可。

## 宿主落盘与行为差异

| 宿主 | 项目级受管位置 | 导航提醒 |
| --- | --- | --- |
| Codex | `.codex/`、`.agents/skills/` | advisory、fail-open 的 `PreToolUse` hook |
| Claude Code | `.claude/settings.json`、`.claude/skills/`、根 `.mcp.json` 的 KCodeRag section | advisory、fail-open 的 `PreToolUse` hook |
| Cursor | `.cursor/rules/`、`.cursor/skills/`、`.cursor/mcp.json` 的 KCodeRag section | always-on Rule 与共享 skill；不声明等价的 `PreToolUse` hook |

Codex 与 Claude Code 的已安装 hook 完全离线运行：异常、缺失 Node 或损坏输入都静默
fail-open，不阻断原始 Grep、Glob 或 shell 操作。每个会话首次符合条件的事件只读取本地更新
状态，并可启动一个分离的后台 npm 更新检查；网络延迟不会进入工具调用关键路径。发现新版本时
只提示用户运行：

```powershell
npx kcoderag-nav@latest update
```

Cursor 使用项目 Rule、skill 与 MCP，不伪装宿主不提供的 hook 能力。安装或更新后，请重新打开
Codex thread、Claude Code session，或在 Cursor 执行 **Developer: Reload Window**。

## 旧 Cursor 本地安装迁移

如果检测到旧版用户目录安装，Cursor adapter 会先验证旧状态、完整文件集合和 exact digest。
验证通过后，删除旧用户目录仍需要一项独立授权：交互模式会单独询问；自动化必须显式增加
`--allow-legacy-user-removal`。

```powershell
npx kcoderag-nav@latest install --host cursor --yes --allow-legacy-user-removal
```

`--yes` 只确认项目目标，绝不隐含旧用户目录删除权限。旧安装有漂移、额外文件、状态不明，或
用户拒绝独立确认时，迁移会保持旧用户目录和目标项目零写入。

## 维护者流程

仓库使用 TypeScript 维护源码并构建可直接执行的 CJS。依赖只用于开发，用户运行时没有 npm
生产依赖。新 checkout 先安装锁定依赖并启用版本化提交 hook：

```powershell
npm ci
git config core.hooksPath .githooks
npm run build
npm test
```

规范源位于 `plugin-src/`，QA、Dev 与 Cursor 生成树不能手工维护：

```powershell
npm run generate
npm run generate:check
npm run pack:audit
```

本地 pre-commit 会重新构建并检查规范源、生成物、文档、测试与打包边界；它不会自动暂存文件。
若生成物变化，请检查并显式暂存后重新提交。

根 `package.json` 是唯一版本源。维护者使用 `npm run release:patch`、
`npm run release:minor` 或 `npm run release:major` 准备版本和 `vX.Y.Z` tag；普通分支 push 只运行
测试，只有与 `package.json` 版本一致的 tag 工作流能够发布 npm 包。发布前后证据只记录版本、
commit、workflow 和 registry 元数据，不记录 MCP 配置值。

## 纯 MCP 与内部连接边界

只配置 MCP server 的方式属于纯 MCP 接入，不包含本项目的 hook、Rule、skill、更新感知或受管
生命周期。当前 QA/Dev 内部测试 profile 允许装即用的内置认证材料；生成器、CLI、状态、测试、
CI 和文档都必须把连接值视为不透明敏感输入。生产级身份、HTTPS 与凭据轮换属于后续阶段。
