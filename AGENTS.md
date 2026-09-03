<!-- GSD:project-start source:PROJECT.md -->

## Project

**KCodeRag Nav**

KCodeRag Nav 是 KCodeRag MCP 查询服务的 Node.js 项目集成，面向 Codex、Claude Code、
Cursor、OpenCode 与 ZCode。公共 npm CLI `kcoderag-nav` 将编译后的 CJS 运行时、内置 capability、MCP 配置和宿主资产
部署到目标项目的原生目录；它不是 marketplace plugin，也不依赖 Python、Git checkout 或
运行时 TypeScript 编译。标准入口是 `npx kcoderag-nav@latest install`。

未指定宿主时交互选择 Codex、Claude Code、Cursor、OpenCode 或 ZCode；自动化使用
`--host codex|claude|cursor|opencode|zcode`，一次调用只管理一个宿主。当前内置 capability 固定为
`kcoderag-navigation` 与 `code-style-nudge`；公开手动入口固定为 `$kcoderag`、`$kcoderag-manage`、
`$kcoderag-update`、`$kcoderag-feedback` 与 `$kcoderag-code-style`。install 将显式选择加入已安装集合，跨宿主的项目级
安装可以共存。当前状态只接受 capability-scoped schema v1；旧 QA/Dev 状态、迁移、接管和自动清理
不再是可执行产品能力。

Codex、Claude Code 与 ZCode 使用 advisory、fail-open 的 PreToolUse hook；Cursor 使用 always-on Rule
和共享 skill，OpenCode 使用项目 plugin；ZCode 同时使用项目 `.zcode/config.json` MCP 与 workspace Skill。
五宿主成功调用事件写入 secret-free、fail-open marker。
install/update/uninstall 只修改 adapter 声明的受管
项目文件和 section，遇到漂移、危险 target 或所选宿主的手工/活动重复来源时全部在写前硬停止，并按单宿主
事务完整回滚。`status` 快速报告项目健康；`doctor` 深扫所选宿主的用户级来源且始终只读。

**Core Value:** 用户通过统一 npx CLI 即可在所选宿主和明确项目边界内获得可靠、低打扰、QA 图优先的导航体验。

### Constraints

- **运行时**: 用户路径最低 Node.js 22；维护源码编译为 CJS，不允许 Python 或运行时 TypeScript 编译
- **分发**: 用户安装、更新与卸载统一通过 `npx kcoderag-nav@latest`；只发布两个内置 capability，根 marketplace catalog 不得恢复
- **宿主边界**: 一次命令只管理 Codex、Claude Code、Cursor、OpenCode 或 ZCode 中的一个；跨宿主安装可以共存
- **状态边界**: 只接受当前 capability-scoped schema v1、完整 contributor/section 清单和 composite digest；旧状态无迁移、接管或清理入口
- **项目边界**: 默认只修改目标项目内由 adapter 声明的文件/section，不污染用户配置、无关项目或其他宿主
- **所有权**: update/uninstall 遇到漂移、symlink、特殊文件或模糊所有权必须写前硬停止并保持原子回滚
- **来源门禁**: install/update/uninstall 全部深扫所选宿主来源；raw/manual/ambiguous/旧来源只读报告并硬停止，CLI 不迁移、接管或自动清理
- **根定位**: Codex/Claude/ZCode Hook 从 cwd 向上选择最近受管状态；损坏最近边界静默 fail-open 且不得穿透，项目移动后仍使用相对路径工作
- **诊断**: status/doctor 只读且 secret-safe；`source_conflict` 为 `ok:false`，输出不得包含 URL、Header、Bearer 或配置正文
- **Hook**: Codex/Claude/ZCode 仅提供 advisory context，任何异常 fail-open，不阻断 `grep`、`glob` 或 shell
- **Cursor**: 使用 Rule、skill 与 MCP，不声称具备等价的 PreToolUse hook 行为
- **成功调用记录**: Codex/Claude/ZCode `PostToolUse`、Cursor `afterMCPExecution`、OpenCode
  `tool.execute.after` 共用 secret-free、有界、fail-open marker
- **体验指南所有权**: 本仓库从 Phase 04.2 起独占维护 `docs/MCP_QA_EXPERIENCE_GUIDE.md`；兄弟 KCodeRag 仓库中的旧指南只允许作为一次性只读迁入来源，后续不得修改、同步或纳入 readiness 摘要
- **代码规范支持**: 五宿主均安装手动 `$kcoderag-code-style` Skill；只有冻结 PASS receipt 对应的 Claude Code `2.1.241` 获得 native 自动写前提示，其他宿主与未证明版本保持 manual-only
- **代码规范完整性**: 写前提示前必须验证当前状态 composite digest 及全部受管文件摘要；缺失、损坏或漂移静默 fail-open，由 status/doctor 报 `capability_drift`
- **D-19 marker**: 需要重置一次性提示时，先关闭所有相关宿主会话，再人工删除 OS cache 下 `kcoderag-nav/nudges`；status/doctor 不清理，删除失败也不阻断宿主
- **发布**: 全部门禁通过后只验证 readiness，不在本阶段执行 publish；既有不可变版本只以前进版本修复
- **凭据**: 当前内部 QA 阶段允许装即用的内置 Bearer — 明确接受内部测试阶段风险
- **阶段边界**: Phase 05 统一负责 Hook 精度、节流、真实宿主事件与 authenticated MCP 证据；全局 GSD Hook 和生产身份/HTTPS/轮换已移出当前 milestone，未来重新立项前不得宣称完成
- **OpenCode**: 只允许项目级安装；JSON/JSONC 双配置硬停止；真机验收基线为 `1.18.23`
- **ZCode**: 只允许项目级安装；管理 `.zcode/config.json` 的 MCP/Hook section、`.zcode/skills/` 与项目 Hook 运行时；CLI 不预授权 workspace trust，Phase 04.2 验收 packaged lifecycle/smoke，真机 trust/admission 与版本冻结并入 Phase 05
- **变更保护**: 仓库已有未提交修改，初始化和后续实现不得覆盖或回退无关工作

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- TypeScript (`.cts`) - canonical CLI, transaction, host adapters, hooks, generator, maintainer tools, smoke harness, and tests.
- CommonJS (`.cjs`) - compiled user and maintainer runtime in `dist/` plus self-contained generated QA hook payloads.
- JSON/TOML/Markdown/shell - host-native MCP/settings, generated compatibility manifests, skills/Rules, launchers, and workflow configuration.

## Runtime

- Node.js 22+ is the only user runtime. Node 22 and 24 are the required CI lines.
- TypeScript compiles `.cts` to directly executable `.cjs`; no `ts-node`, runtime compilation, or Python fallback is allowed.
- The public executable is `dist/bin/kcoderag-nav.cjs`, exposed as the `kcoderag-nav` npm bin.
- Root `package.json` is the single version and script source; `package-lock.json` pins the audited dev-only dependency graph.

## Frameworks

- Model Context Protocol (MCP) - the external KCodeRag QA service is the `kcoderag-navigation` projection in each selected host's native project configuration.
- Host adapters - Codex, Claude Code, Cursor, OpenCode, and ZCode render host-specific desired state behind a shared read/render-only interface.
- Node built-in test runner - compiled `dist-tests/**/*.test.cjs` provides unit, integration, pack, lifecycle, smoke, and release coverage.
- npm/npx - package acquisition and the five-command project lifecycle; marketplace catalogs are not a distribution surface.

## Key Dependencies

- Runtime dependencies: none beyond Node.js built-ins.
- Dev dependencies: audited TypeScript and Node 22 declarations only; dependency graph or integrity drift requires re-audit.
- KCodeRag QA MCP service - provides graph lookup tools; endpoint and authorization values remain opaque sensitive inputs.
- Codex/Claude/ZCode hook runtimes invoke generated Node launchers; Cursor consumes project Rule, skill, MCP, and `afterMCPExecution`; OpenCode consumes a project plugin and MCP configuration.

## Configuration

- `src/hosts/` declares Codex, Claude Code, Cursor, OpenCode, and ZCode project ownership; `src/core/transaction.cts` is the only filesystem commit boundary.
- `plugin-src/` is the deterministic template/config source for the two built-in capabilities; generated QA/Cursor assets remain self-contained and version-aligned.
- Codex targets `.codex/` and `.agents/skills/`; Claude Code targets `.claude/settings.json`, `.claude/skills/`, and root `.mcp.json`; Cursor targets `.cursor/rules/`, `.cursor/skills/`, `.cursor/mcp.json`, and `.cursor/hooks.json`; OpenCode targets one root config plus `.opencode/`; ZCode targets `.zcode/config.json`, `.zcode/skills/`, project hooks, and its managed state.
- MCP configuration files may contain credentials. Never inspect, print, snapshot, or include their values in diagnostics.

## Platform Requirements

- Node.js 22+ and npm/npx on Windows or Linux.
- At least one selected host: Codex, Claude Code, Cursor, OpenCode, or ZCode.
- Network access for initial npm acquisition and the internal QA MCP service. Installed hooks run offline and update checks fail open.

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

- Canonical modules use kebab-case `.cts` names such as `grep-nudge.cts`, `host-adapter.cts`, and `pack-audit.cts`.
- Tests use `*.test.cts`; compiled paths preserve the same structure under `dist-tests/`.
- Functions and locals use descriptive `camelCase`; interfaces and exported type names use `PascalCase`.
- Module constants use `SCREAMING_SNAKE_CASE`; stable command/host collections are frozen and readonly.
- Generated assets keep host-native names and paths; do not rename compatibility manifests or MCP keys independently of the generator.

## Code Style

- TypeScript is strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; preserve explicit readonly contracts and narrow unknown values at boundaries.
- Runtime code uses Node built-ins only. Do not add a production dependency, runtime transpiler, or new package without the dependency audit gate.
- Executable sources use a Node shebang and a concise module docstring; compiled CJS is the runnable artifact.
- Preserve readable two-space indentation, semicolons, LF-normalized deterministic generated bytes, and path-only diagnostics.

## Import Organization

- Node built-ins are loaded with `node:` specifiers. TypeScript modules import sibling compiled names with `.cjs` suffixes so emitted CJS resolves directly.
- Keep host-specific imports out of `src/core/`; the CLI reaches hosts through `src/hosts/index.cts` and `HostAdapter`.

## Error Handling

- Expected refusals use stable `InstallError` codes and safe relative paths; never include file contents, URLs, headers, subprocess bodies, or credentials.
- Mutating commands validate runtime, ownership, drift, and complete desired state before one `applyTransaction` call; state commits last and rollback is host-local.
- Hook boundaries catch every malformed/oversized/unsupported/error case, emit empty stdout, and exit 0. Advisory behavior must never reject the original tool call.
- `status` and `doctor` are read-only; `--json` emits exactly one stable JSON value without diagnostic noise.

## Logging

- Hook stdout contains only a valid host protocol response and is otherwise empty; launchers suppress runtime failures and stderr.
- CLI and maintainer diagnostics contain stable codes and safe paths only. Never log MCP values or captured network/subprocess bodies.
- Machine receipts and smoke evidence contain metadata-only fields; `NOT_RUN` is never converted to required `PASS`.

## Comments

- Use module/function docstrings for ownership, transaction, protocol, and fail-open boundaries.
- Comments explain non-obvious safety policy, host differences, deterministic ordering, and why values remain opaque; do not restate syntax.

## Function Design

- Prefer pure read/render functions that return immutable desired state. Filesystem mutation belongs only in the transaction layer.
- Inject clocks, fetchers, spawners, and failure points where deterministic tests need to prove timing, network, or rollback behavior.

## Module Design

- `src/core/` is host-neutral; `src/hosts/` owns paths and structured merge rules; `src/cli/` owns orchestration, not writes.
- `src/generator/` renders sorted bytes from canonical templates; checks are read-only and generators never expose credential inputs.
- Generated QA/Cursor trees are products, not independent maintenance sources.

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Overview

```text
npx kcoderag-nav@latest <command>
        |
        v
CLI policy -> selected HostAdapter (read/render only) -> atomic transaction -> project-native files
        |                                                        |
        +-> status/doctor (read-only)                             +-> managed state/digests

Installed Codex/Claude launcher -> CJS advisory hook -> optional detached npm update worker
Installed Cursor project files  -> Rule + skill + MCP + afterMCPExecution marker
Installed OpenCode project files -> skill + MCP + tool.execute.after marker
Installed ZCode project files    -> skill + MCP + Pre/PostToolUse hooks
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| npm CLI | Parses five commands, selects one host/environment, confirms target, and formats stable output | `src/bin/kcoderag-nav.cts`, `src/cli/commands.cts` |
| Core contracts | Defines safe errors, target/state/status types, runtime checks, and managed-path validation | `src/core/` |
| Atomic transaction | Performs the only installation filesystem commit, state-last ordering, and complete rollback | `src/core/transaction.cts` |
| Host adapters | Detect and render Codex, Claude Code, Cursor, OpenCode, or ZCode project-native desired state without writing | `src/hosts/` |
| Advisory hook | Classifies structural search, emits bounded guidance, and fails open | `src/hooks/grep-nudge.cts` |
| Update runtime | Reads bounded local cache in foreground and refreshes npm latest in a detached worker | `src/hooks/update-check.cts`, `src/hooks/update-worker.cts` |
| Capability registry | Declares the frozen `kcoderag-navigation` and `code-style-nudge` manifests, assets, support policy, and provider contributions | `src/capabilities/` |
| Generator | Produces deterministic self-contained QA/Cursor assets from canonical capability templates | `src/generator/index.cts`, `plugin-src/` |
| Source diagnostics | Classifies selected-host manual/active sources as read-only conflicts and keeps status/doctor secret-safe | `src/core/`, `src/hosts/`, `src/cli/commands.cts` |
| Maintainer gates | Enforce dependencies, generation, pre-commit, pack, docs, retirement, and release contracts | `src/maintainer/` |
| Smoke harness | Acquires a real temporary package and proves lifecycle/MCP evidence against a loopback stub | `src/smoke/` |

## Pattern Overview

- The npm CLI is the composition root. One invocation targets one host; host adapters provide data and the shared transaction owns writes.
- The product has two built-in capabilities. Install composes `installed ∪ selected`; update targets installed capabilities by default; uninstall requires explicit capability selection or `--all`; a project may contain independent host installations.
- OpenCode is also project-only; it selects exactly one JSON/JSONC project config and never writes user-global config.
- ZCode is project-only; it owns bounded sections under `.zcode/config.json`, projects its workspace Skill/hooks, and never pre-authorizes workspace trust.
- Canonical TypeScript/templates generate version-aligned QA CJS and host assets; generated trees are never hand-maintained.
- Codex/Claude/ZCode hooks are advisory and non-blocking. Cursor intentionally uses Rule/skill/MCP instead of a false hook equivalent.
- Code-style delivery has a manual base on all five hosts and a receipt-gated native overlay: only Claude Code 2.1.241 receives the automatic pre-write path.
- All installed ownership is explicit, digest-backed, drift-aware, and recoverable without touching unrelated host configuration.

## Layers

- **Controller:** `src/bin/` and `src/cli/` validate public command policy, target confirmation, host/environment selection, and stable output.
- **Core:** `src/core/` owns host-neutral path validation, state schemas, runtime checks, and transactional mutation.
- **Providers:** `src/hosts/` own only host-native detection, managed roots/sections, merge semantics, and desired-state rendering.
- **Runtime hooks:** `src/hooks/` implement pure lookup classification and optional asynchronous update state with no foreground network access.
- **Build/distribution:** `src/generator/`, `plugin-src/`, and generated QA/Cursor host trees form deterministic, self-contained npm assets.
- **Assurance:** `src/maintainer/`, `src/smoke/`, tests, and CI prove dependency, pack, lifecycle, release, and secret-safe evidence contracts.

## Data Flow

### Project Installation

1. The CLI validates Node.js 22+, command flags, the exact project-only target, selected host, and QA-only public policy.
2. The selected adapter reads current capability-scoped state and performs the selected-host source gate for every mutation, reporting drift, ambiguity, or manual/active source findings without reading credential values or writing.
3. Capability support and complete integrity are preflighted, then the adapter renders one complete immutable desired state for `installed ∪ selected` under declared managed roots.
4. `applyTransaction` verifies expected digests, stages bytes, commits state last, and restores the selected host on failure.
5. Human output or one JSON result reports stable codes and paths only.

### Lookup Guidance and Update Awareness

1. Codex/Claude/ZCode invokes the generated launcher before matched search tools; from the session cwd it walks upward to the nearest selected-host managed state, treats a damaged nearest state as a fail-open boundary, resolves relative sibling CJS, and never falls through to an outer project.
2. The hook parses bounded input and emits advisory JSON only for eligible structural searches.
3. A session's first eligible event may schedule a detached npm Registry refresh; foreground execution reads local bounded state only.
4. Cursor receives navigation policy through its Rule/skill and uses MCP directly; `afterMCPExecution` records a bounded successful-call marker without emulating PreToolUse.
5. OpenCode uses a project plugin's stable `tool.execute.after` event to record the same marker.
6. ZCode uses project `hooks.events` for advisory `PreToolUse` and secret-free `PostToolUse` marker recording; workspace trust remains a user decision.

## Key Abstractions

- **HostAdapter:** Declares host identity/roots and pure detect/render/status methods; it cannot commit files.
- **DesiredState:** Complete immutable single-host mutation plan with expected digests and state path.
- **InstallState:** Exact schema-v1 ownership graph for host, capabilities, contributor-scoped managed files/sections, individual digests, originals, and one composite digest.
- **InstallError:** Stable secret-safe refusal with optional normalized path.
- **Generated product:** Byte-deterministic QA/Cursor asset set derived from root package version and canonical capability templates.

## Entry Points

- `dist/bin/kcoderag-nav.cjs` - npm bin for install/status/doctor/update/uninstall.
- `kcoderag-qa/hooks/run_hook.{cmd,sh}` - generated fail-open launchers for Codex/Claude/ZCode hook events.
- `dist/generator/index.cjs` and `dist/maintainer/*.cjs` - deterministic generation, validation, documentation, pack, and release gates.
- `.githooks/pre-commit` and GitHub Actions - Node-only local/remote assurance entry points.

## Architectural Constraints

- **Mutation ownership:** Only the shared transaction writes installation files; adapters and status paths remain read/render-only.
- **Project scope:** Every resolved path must stay inside the explicit target and adapter-declared roots; reject traversal, symlinks, special files, and ambiguous ownership.
- **State boundary:** Only the current capability-scoped schema is valid. Retired environment-shaped/Python records are invalid inputs with no migration, adoption, cleanup, or implicit conversion authority.
- **Source authority:** Install/update/uninstall all hard-stop on selected-host manual or active duplicates before rendering. Sources are diagnostic-only and `status`/`doctor` remain read-only.
- **Capability support:** Navigation and manual code-style Skills are independent across all five hosts. Only an exact checked-in PASS receipt digest enables the native automatic overlay; unsupported automation never prevents manual Skill installation.
- **Code-style integrity:** The advisory handler validates the nearest current state, its composite digest, and every managed file digest before claiming a once marker; any failure is silent and does not consume the reminder.
- **Hook safety:** All malformed input, runtime failures, missing Node, and update failures exit 0 without blocking or contaminating stdout.
- **Secret boundary:** MCP connection and authorization values are opaque; never expose them in output, diagnostics, tests, receipts, or documentation.
- **Distribution boundary:** Root marketplace catalogs stay retired. Compatibility manifests may remain inside generated self-contained assets but are not install sources.
- **Runtime boundary:** Published/installed code is CJS on Node.js 22+ with no Python, runtime compiler, or production npm dependency.
- **Release boundary:** Phase 04.2 advances the checked candidate to `0.3.0` and verifies five-host readiness against one exact tgz without tag or publish; any later immutable publication is separately authorized and fixes forward without unpublish or dist-tag rollback.
- **Documentation boundary:** This repository exclusively owns `docs/MCP_QA_EXPERIENCE_GUIDE.md` from Phase 04.2 onward. The sibling KCodeRag guide is a one-time read-only import source only and is never updated or bound into readiness evidence.
- **Deferred boundary:** Phase 05 owns Hook precision, reminder consumption, authenticated MCP queries, and OpenCode/ZCode true-host evidence. Global GSD Hook work and production identity/HTTPS/token rotation are outside the current milestone and require a future explicit phase.

## Anti-Patterns

### Treating local grep as the structural source of truth

### Making the hook blocking or stateful

### Writing host files directly from adapters

### Treating generated trees or compatibility manifests as user installation sources

## Error Handling

- CLI expected failures return stable secret-safe codes; JSON mode is one parseable document.
- Transaction failure restores the selected host; rollback failure keeps a private recovery tree and reports only its safe relative location.
- Hook/worker boundaries swallow operational failures, emit no diagnostics on stdout, and never block the original host tool.

## Cross-Cutting Concerns

- Deterministic QA-only bytes and exact package-version propagation.
- Narrow ownership and unrelated configuration preservation.
- Secret-safe diagnostics and metadata-only evidence.
- Node 22/24 and Windows/Linux parity.
- Honest separation between Phase 04 deployment evidence and Phase 05 authenticated real-host MCP evidence.

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
