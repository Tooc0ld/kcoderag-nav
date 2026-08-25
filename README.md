# KCodeRag Nav

KCodeRag Nav 是面向 Codex、Claude Code 与 Cursor 的 KCodeRag 项目集成。公共 npm CLI
`kcoderag-nav` 将已编译的 CJS 运行时、导航 skill、QA MCP 配置和宿主资产写入明确目标项目的
原生目录。它不是 marketplace plugin；用户不需要 Git checkout、Python 或运行时 TypeScript
编译。

自 `0.2.0` 起，QA 是唯一公开可安装、更新和生成的环境。Dev 不再是公开、隐藏或维护者专用的
安装选项；它只作为具有精确 schema、完整所有权和正确摘要的旧状态输入，用于一次性迁移或
卸载。旧的 `--environment` 安装/更新参数会被拒绝，而不是被静默忽略。

面向 QA 使用者的完整接入与体验指南由 KCodeRag 服务仓库独占维护，见
[MCP_QA_EXPERIENCE_GUIDE.md](https://github.com/Tooc0ld/KCodeRag/blob/main/MCP_QA_EXPERIENCE_GUIDE.md)。
本仓库不保留该指南副本，也不在文档或诊断中展示 MCP URL、Header、Bearer 或配置正文。

## 快速安装

要求 Node.js 22 或更高版本。在真正需要接入 KCodeRag 的项目目录中运行：

```powershell
npx kcoderag-nav@latest install
```

未传 `--host` 时，安装器会交互选择 Codex、Claude Code 或 Cursor。自动化场景一次显式管理
一个宿主，并用 `--yes` 接受安装器显示的规范化目标路径：

```powershell
npx kcoderag-nav@latest install --host codex --yes
npx kcoderag-nav@latest install --host claude --yes
npx kcoderag-nav@latest install --host cursor --yes
```

目标默认为当前工作目录；`--target PATH` 可以指定另一个精确项目。CLI 不向上推断 Git/SVN
根，也不要求目标含有 Git、SVN 或专用 marker。文件系统根、用户主目录，以及 Codex、Claude
Code、Cursor 的用户级 config/plugin/cache 根会被拒绝；其他明确目录在显示规范化绝对路径并
确认后可以使用。

一次命令只管理和扫描一个宿主，因此同一项目的 Codex、Claude Code 和 Cursor 项目级 QA
安装可以共存，不会互相卸载或覆盖。

## 五个生命周期命令

普通用户始终通过公共 `@latest` 入口运行：

```powershell
npx kcoderag-nav@latest install --host codex
npx kcoderag-nav@latest status --host codex
npx kcoderag-nav@latest doctor --host codex
npx kcoderag-nav@latest update --host codex
npx kcoderag-nav@latest uninstall --host codex
```

- `install`：安装所选宿主的项目级 QA；同版本、无漂移的重复安装是幂等操作。
- `status`：快速、只读地报告项目安装、版本、漂移、更新和活动来源冲突摘要；未安装时返回
  `not_installed`。
- `doctor`：只读地深扫所选宿主的用户级 plugin、raw MCP、manual Hook 及 cache/disabled
  残留；即使项目尚未安装，也会给出 QA 安装前就绪结论。
- `update`：在完整写前门禁通过后更新所选宿主的项目级 QA；不会选择或恢复 Dev。
- `uninstall`：只删除能由受管状态和摘要证明归属当前项目/宿主的内容。它减少活动来源，因此
  不会因为外部重复来源而被阻断，但项目自身漂移仍会硬停止。

`status` 与 `doctor` 始终只读，不需要 `--yes`，也不提供 `doctor --fix`。`--json` 只输出一个
稳定、可解析的 JSON 值。install/update 会自行运行与 doctor 同等完整的写前来源门禁，用户
不必先手动执行 doctor。

若受管文件或 section 已漂移，或者遇到 symlink、特殊文件、模糊所有权或危险 target，写操作
会在修改任何项目文件前硬停止；没有 `--force` 绕过路径。事务中途失败时只恢复所选宿主的
原状态，不影响同项目中的其他宿主。

## 来源诊断与受控清理

用户级来源按实际影响分层：

- 可能生效的 plugin、raw MCP 或 manual Hook 是活动冲突；项目内容完整时顶层仍返回
  `source_conflict`、`ok: false`，并阻断 install/update。
- 所有权明确的旧 plugin 或 marketplace registration 可以形成“待确认清理计划”。计划只含
  稳定 finding code、severity、source type、scope、安全路径、已验证的固定原生命令和
  `sha256:` fingerprint。
- 仅 cache、下载残留或 disabled record 只在 doctor 中提示，不阻断项目安装。

每次清理授权都必须独立绑定 doctor/写前门禁刚刚显示的冻结 fingerprint：

```powershell
npx kcoderag-nav@latest update --host codex --target "D:\path\to\project" --yes `
  --allow-owned-source-cleanup --cleanup-fingerprint sha256:<64-lowercase-hex>
```

`--yes` 只确认项目目标，发布授权和 legacy Dev 迁移授权也都不能替代这两个清理参数。CLI 只有
在计划未变化、fingerprint 完全匹配、原生命令成功且完整 post-removal rescan 证明来源确实
消失后，才会开始项目事务。fingerprint 不匹配、命令失败/超时、复扫不完整或仍有冲突时不会
写项目。

宿主原生边界如下；命令由 doctor 作为经验证的清理建议展示，不能自行替换名称或 scope：

- Codex 正常 inventory 中的单个 owned plugin 优先使用
  `codex plugin remove PLUGIN@MARKETPLACE --json`。仅对已知的退役本地注册、固定 marketplace
  名 `kcoderag-nav`，并且版本/help schema、来源路径、legacy provenance、失败归因和唯一性
  全部满足时，才允许降级命令 `codex plugin marketplace remove kcoderag-nav --json`。
- Claude Code 优先使用精确 scope 的
  `claude plugin uninstall PLUGIN@MARKETPLACE --scope user|project|local`。只有完整 plugin 与
  marketplace inventories 证明该 marketplace 及全部受影响 plugin 均由 KCodeRag 独占时，
  才能使用 `claude plugin marketplace remove MARKETPLACE --scope SCOPE`。
- Cursor 不假定存在等价的原生 plugin CLI；没有经过版本化能力预检的来源保持 manual-only。

无受管所有权的 raw MCP、手写 Hook、不同名称/路径、多个来源、共享 marketplace、缺失/不兼容
能力或任何 ambiguous observation 永远只报告安全路径和人工清理指引，CLI 不编辑其配置。一次
命令只扫描所选宿主；其他宿主的项目级 QA 或用户来源不会被误当成当前宿主的删除授权。

## 旧 Dev 状态的一次性迁移或卸载

旧 Dev 不是可安装产品。只有状态 schema、host、完整受管路径集合和所有摘要均精确匹配时，CLI
才把它识别为可迁移/卸载的 legacy state；漂移、额外内容、未知 owner 或部分状态均在写前硬
停止。

交互式 install/update 会先显示 Dev→QA 的完整变更并单独确认。非交互自动化必须显式增加独立
的 legacy authority：

```powershell
npx kcoderag-nav@latest update --host codex --target "D:\path\to\project" --yes `
  --allow-legacy-dev-migration
```

`--allow-legacy-dev-migration` 只授权当前项目/宿主中已验证旧 Dev 到 QA 的单事务迁移，不授权
用户级来源清理。`uninstall` 可读取同样经过验证的旧 QA/Dev 状态并只移除其受管内容；它不会
把 Dev 恢复为安装选项。

## Hook 根定位、项目移动与宿主差异

| 宿主 | 项目级受管位置 | 导航提醒 |
| --- | --- | --- |
| Codex | `.codex/`、`.agents/skills/` | advisory、fail-open 的 `PreToolUse` Hook |
| Claude Code | `.claude/settings.json`、`.claude/skills/`、根 `.mcp.json` 的 KCodeRag section | advisory、fail-open 的 `PreToolUse` Hook |
| Cursor | `.cursor/rules/`、`.cursor/skills/`、`.cursor/mcp.json` 的 KCodeRag section | always-on Rule 与共享 skill；不声明等价的 `PreToolUse` Hook |

Codex/Claude Hook 从宿主会话当前目录向父目录逐级查找，选择最近的对应宿主
`kcoderag-nav/install-state.json`。在项目根和任意深层子目录启动都落到同一最近项目；嵌套受管
项目以更近边界为准。一旦找到最近状态，即使它损坏、版本不兼容或 launcher 缺失，也会静默
fail-open，绝不穿透去运行外层项目的 Hook。

状态只记录项目内相对路径和受管摘要，不绑定旧绝对路径。完整复制、移动、改名或换盘后，只要
相对内容和摘要保持完整，Hook 与精确目标 `status` 仍可工作。CLI 自身的 cwd/`--target` 始终是
精确目标；只有运行时 Hook 做向上最近状态发现。

Codex/Claude Hook 完全离线运行，任何异常都输出空结果并退出成功，不阻断原始 Grep、Glob 或
shell。Cursor 使用 Rule、skill 与 MCP，不伪装宿主不存在的事件 Hook。安装或更新后，请重新
打开 Codex thread、Claude Code session，或在 Cursor 执行 **Developer: Reload Window**。

首次符合条件的 Codex/Claude Hook 事件只读本地更新状态，并可分离启动后台 npm Registry
refresh；前台不等待网络，任何更新失败都 fail-open。发现新版本时只提示运行
`npx kcoderag-nav@latest update --host <host>`，不会自动修改项目。

## `0.2.0` 发布、Head 部署与证据边界

`0.2.0` 只有在实现、自动化测试、审查、pack、Windows/Linux × Node.js 22/24 四通道 CI 和
公开制品门禁全部通过后才会发布。发布后以不可变 npm 版本和 `v0.2.0` tag 为准；普通 master
push 只是源码更新，不等于其他用户已经获得新版。

实际 Head 验收只接受公开 exact 制品，并按以下顺序执行：

```text
kcoderag-nav@0.2.0 doctor
→ 清理唯一、已确认且 fingerprint 完全匹配的旧来源
→ kcoderag-nav@0.2.0 update/migrate
→ kcoderag-nav@0.2.0 status 与 doctor
```

验收要求 `status=healthy`、doctor 无活动重复来源、项目根和深层子目录选择同一项目 Hook，且
无关项目、其他宿主和用户配置保持不变。不得使用 `@latest` 或本地 `npm pack` 冒充这项 exact
公开制品证据。若 `0.2.0` 已发布但 Head 迁移失败，项目事务恢复迁移前状态；npm version、tag
和 latest 保持不变，不 unpublish 或回退 dist-tag，只以 `0.2.1` 修复前进。

Phase 04 的证据只证明项目生命周期、来源门禁和 Hook/Rule 合同。真实 Codex、Claude Code、
Cursor MCP 工具注册及已认证图查询证据属于 Phase 06，本文不把 loopback/offline 检查描述为
真实查询成功。

## 维护者流程

仓库使用 TypeScript 维护源码并构建可直接执行的 CJS。生产运行时只有 Node.js built-ins，用户
不需要安装生产依赖。新 checkout 先安装锁定依赖并启用版本化提交 hook：

```powershell
npm ci
git config core.hooksPath .githooks
npm run build
npm test
```

规范源位于 `plugin-src/`，`0.2.0` 的 QA 与 Cursor 生成树不能手工维护，且不会再生成公开 Dev
产品：

```powershell
npm run generate
npm run generate:check
npm run pack:audit
```

本地 pre-commit 会重新构建并检查规范源、生成物、文档、测试与打包边界；它不会自动暂存文件。
若生成物变化，请检查并显式暂存后重新提交。

根 `package.json` 是唯一版本源。维护者使用 `npm run release:patch`、
`npm run release:minor` 或 `npm run release:major` 准备版本和 `vX.Y.Z` tag；普通分支 push 只运行
测试，只有与 `package.json` 版本一致的 tag 工作流能够发布 npm 包。发布证据只记录版本、
commit、workflow 和 Registry 元数据，不记录 MCP 配置值。

## 纯 MCP 与内部连接边界

纯 MCP 指只在宿主原生 MCP 设置中注册 KCodeRag 服务。它不包含 KCodeRag Nav 的 Hook、Rule、
skill、后台更新感知或受管生命周期；连接与认证材料需按服务约定单独维护。需要完整导航体验时，
应使用项目级 npx 安装。

当前内部 QA 阶段允许装即用的内置认证材料；生成器、CLI、状态、测试、CI 和文档都必须把连接
值视为不透明敏感输入。生产级身份、HTTPS 与凭据轮换属于 Phase 08。
