# Phase 5: 统一 Hook 策略与真实宿主验证 - Context

**Gathered:** 2026-09-01
**Status:** Ready for planning

<domain>
## Phase Boundary

本阶段统一 KCodeRag Nav 的 SessionStart 基线、工具语义提醒、一次性 marker、feedback 消费与真实宿主验收策略。交付必须覆盖 Codex、Claude Code、Cursor、OpenCode 与 ZCode，并诚实区分宿主原生能力、packaged contract 与 LIVE evidence。所有实现继续保持项目级、secret-free、有界、并发安全和 fail-open；同一 exact package 必须在受支持 runner 上留下可审计证据。

本阶段不实现 Hook 自动修改项目、不扩展全局 GSD Hook，也不解决生产身份、HTTPS、凭据轮换或公开发布授权。

</domain>

<decisions>
## Implementation Decisions

### 统一事件与 SessionStart 基线

- **D-01:** 内部采用 capability contributor registry，由中央 dispatcher/governor 组合 SessionStart 与工具事件的策略、状态和有界输出；跨宿主统一的是政策与状态机，不伪造宿主不具备的原生事件。
- **D-02:** `startup`、`resume`、`clear`、`compact` 都重新生成同一份有界 SessionStart 基线，不依赖压缩前上下文，也不为 `compact` 单独缩短。基线始终包含简短 KCodeRag 使用原则；代码规范和更新信息为条件片段。
- **D-03:** 代码规范摘要只在 capability 已安装、当前宿主版本由冻结 LIVE PASS receipt 支持、且 managed state composite digest 与全部文件摘要完整时加入。首次相关源码写入再给一次具体规范提醒。
- **D-04:** 更新片段只在 OS cache 中存在 24 小时内的新鲜、严格 schema-valid 缓存，且 `latest` 严格大于安装版本时加入。缓存缺失或过期时，SessionStart 只静默调度后台 worker，不等待网络；worker 仅接受固定 HTTPS npm Registry 的受限合法响应并原子写入，结果从后续 SessionStart 生效。
- **D-05:** Phase 5 只提供自动版本获知和明确命令更新；SessionStart/Hook 不自动修改项目。真正后台自动更新必须未来单独设计为显式 opt-in。

### ReminderGovernor、epoch 与 marker 生命周期

- **D-06:** 工具提醒默认按 `host + managed project root + capability + stable session ID + context epoch` 隔离。每个 capability 在一个 epoch 的首次合格语义命中最多输出一次。
- **D-07:** 新 session 建立新提醒范围；`clear` 与 `compact` 开启新的 context epoch，`resume` 不开启。宿主不能可靠报告 source 时不猜测、不重置。
- **D-08:** 暂不实现时间、原始工具次数或语义违规计数纠偏。同一 epoch 内没有第二次纠偏提醒。
- **D-09:** 只有 LIVE receipt 证明宿主 `SessionEnd` 携带稳定、准确的 session identity 时，才自动删除该会话的 marker。无法证明的宿主不自动清理；容量耗尽、锁竞争或清理失败时静默停止新提醒并继续原工具。人工重置继续遵循既有 D-19：先关闭相关宿主，再删除 OS cache 下 `kcoderag-nav/nudges`，status/doctor 不代为清理。

### 工具语义与 submit_feedback

- **D-10:** 导航候选 matcher 保留 `Grep`、`Glob`、`Bash`，但 matcher 命中只负责唤醒 handler。只有符号定义/引用、调用链、模块结构、未知入口等结构化意图才输出；fixed string、明确文件集合、单文件、日志、生成文本、未提交改动和深层窄目录文本核对静默放行。Lua/C++ 精度和 semantic/hybrid 门禁继续服从 ROADMAP/REQUIREMENTS 的 Phase 5 锁定条件。
- **D-11:** 代码规范候选工具仅 `Write`、`Edit`、`MultiEdit` 与原生 `apply_patch`。只有结构化目标包含 C/C++ 头源文件或 Lua 文件才合格；多文件 patch 中任一合格源码可命中。Bash 重定向/脚本写入、文档、JSON 与日志不触发；任何完整性失败不得消费 once marker。
- **D-12:** feedback 提醒只在真实成功的 `search_code`、`context` 或 `get_call_chain` 后触发。`list_indexes` 只是能力探测，不算可评价结果；失败、取消、超时或无法可靠判断成功的事件不消费 marker。宿主可宽匹配 KCodeRag MCP 工具，handler 必须再按工具名和成功状态收窄。
- **D-13:** feedback 使用两层状态：`feedback-reminded` 按 context epoch；`feedback-submitted` 仅在 `submit_feedback` 成功后按整个 session。提交成功后即使 `clear/compact` 也不再提醒；未成功提交时，新 epoch 的首次成功查询可再提醒。失败不记作已提交且当前 epoch 不循环催促；新 session 可重新提醒。提示只允许 AI 提交可由查询结果支持的真实评价，禁止虚构用户意见或包含源码、凭据和敏感正文。

### LIVE evidence、CI 与错误模型

- **D-14:** 只有真实宿主进程加载同一 exact tgz/公开 exact npx 安装出的项目配置，并经宿主原生事件触发行为，才算 `LIVE PASS`。直接执行 launcher、handler 或测试替身只能算 `PACKAGED PASS`；`skipped`、宿主未安装/未登录、未观察到事件和缺失 receipt 均不得完成阶段。
- **D-15:** 机器 receipt 使用独立的 `status`、`stage`、`reasonCode` 维度，并另存 `host`、`hostVersion`、`os`、`nodeVersion`、`evidenceLevel`。环境前提缺失记为 `NOT_RUN + reasonCode`；宿主已运行但行为违约记为 `FAIL + reasonCode`。reasonCode 至少覆盖环境、准入、包、安装、原生事件、提示语义、MCP、feedback 与证据完整性，不能退化为一个通用 `live_failed`。
- **D-16:** GitHub 托管 Windows/Linux runner 在 Node 22、24 上为五宿主提供 PACKAGED 证据。唯一现有自托管平台为 Windows；Windows 自托管 Node 22 必须为 Codex、Claude Code、Cursor、OpenCode、ZCode 全部提供 LIVE 证据。Linux 只声明 packaged/runtime 覆盖，不宣称 Linux 真机宿主验证；receipt 明确 `liveOs: windows` 与 `packagedOs: [windows, linux]`。
- **D-17:** 每个宿主的 authenticated MCP LIVE lane 至少证明：真实 SessionStart；`list_indexes` 协商/能力；固定非敏感 canary 的 `search_code` 合规结构化结果；feedback 提醒；验收用途 `submit_feedback` 成功与后续抑制；malformed/失败路径 fail-open。宿主自己读取 opaque MCP 配置，测试程序不得解析或打印连接值。
- **D-18:** Receipt 只保存 exact tgz SHA-256、宿主/平台/Node 元数据、原生事件与逻辑工具名、协议/认证/结构化结果布尔值、status/stage/reasonCode、耗时、计数和 marker 状态。不得保存查询、代码结果、模型回复、配置正文、URL、Header、Bearer、工具参数、响应正文或原始 stderr；receipt、日志和制品必须通过 secret scan。
- **D-19:** 普通 PR 必须通过 GitHub 托管双系统 Node 22/24 PACKAGED 矩阵。自托管 LIVE 只允许受保护分支、人工批准 environment 或明确 `workflow_dispatch`，不得自动执行未受信任 fork 代码。Hosted job 只构建一次 exact tgz；LIVE 下载并核验同一 hash，禁止重建。任一 `FAIL`、`NOT_RUN`、缺失 receipt 或 hash 不一致使 live gate 失败；历史 receipt 不能替代当前候选。
- **D-20:** 单个 Windows LIVE job 内采用混合并行协调器：Codex、Claude Code、OpenCode 使用隔离 project/cwd/temp/npm cache/marker lane 并行；Cursor 与 ZCode 因桌面单实例、前台焦点和 workspace trust 风险分别串行。每宿主必须有独立超时、完整进程树清理和 metadata-only receipt。只有未来 LIVE 证明确认独立 profile 且无焦点依赖时，才开放 Cursor/ZCode 并行。

### the agent's Discretion

- 在宿主协议上限内确定 contributor 顺序、精确英文提示词和总字符预算；SessionStart 基线应短且确定，不能重复注入同义内容。
- 在不扩大用户已锁定语义边界的前提下，确定 classifier 的解析结构、标准化事件字段、receipt schema version、具体 stage 枚举和细粒度 reasonCode 完整清单。
- 确定混合并行协调器的安全超时、进程树回收、隔离目录命名和 metadata-only 汇总格式。
- 选择固定、非敏感、可重复的 MCP canary 及验收 feedback 内容；必须明确标记为测试用途并避免污染真实用户反馈语义。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase contract and product boundaries

- `.planning/ROADMAP.md` § Phase 5 — phase goal、requirements、五条成功标准与执行顺序。
- `.planning/REQUIREMENTS.md` — `HOOK-06`、`HOOK-07`、`HOOK-08`、`ROUT-05`、`TEST-07`、`TEST-08`、`TEST-09`、`TEST-11` 的验收合同。
- `.planning/PROJECT.md` — 当前五宿主产品、capability、所有权、D-19、发布与 deferred boundary。
- `docs/MCP_QA_EXPERIENCE_GUIDE.md` — 本仓库独占维护的 KCodeRag 体验与验收指南。

### Architecture and codebase conventions

- `.planning/codebase/ARCHITECTURE.md` — adapter、transaction、hook、generator、smoke 与宿主诚实边界。
- `.planning/codebase/CONVENTIONS.md` — fail-open、secret-safe、strict TypeScript、Node-only 与测试注入约定。
- `.planning/codebase/TESTING.md` — Node test、exact tgz、smoke/receipt 和验证分层。
- `.planning/codebase/STRUCTURE.md` — canonical source、generated assets 与宿主路径布局。

### Existing hook and evidence implementations

- `src/hooks/pre-tool-dispatcher.cts` — 当前 bounded contributor dispatcher。
- `src/hooks/grep-nudge.cts` — 当前导航语义 classifier 与提示词。
- `src/hooks/code-style-nudge.cts` — 当前结构化写入/扩展名/完整性/once 提醒实现。
- `src/hooks/once-marker.cts` — 当前 stable-session secret-free exclusive claim。
- `src/hooks/session-cleanup.cts` — receipt-proven SessionEnd 清理边界。
- `src/hooks/mcp-call-marker.cts` — 五宿主成功 MCP 调用 marker 标准化。
- `src/hooks/update-check.cts`、`src/hooks/update-worker.cts`、`src/hooks/update-notice.cts` — 离线前台缓存、detached refresh 与宿主适配。
- `src/smoke/host-smoke.cts` — exact package 生命周期、packaged runtime 与 receipt 汇总入口。
- `.github/workflows/acceptance.yml` — 当前 GitHub-hosted 与 Windows self-hosted acceptance 基线。
- `plugin-src/hooks/hooks.json` — 当前项目 Hook matcher/registration canonical template。
- `plugin-src/skills/code-lookup-discipline/SKILL.md` — KCodeRag 查询路由和 fallback 纪律。

### Host and CI documentation

- `https://learn.chatgpt.com/docs/hooks` — Codex SessionStart source、additional context 与 compact 恢复语义。
- `https://docs.github.com/en/actions/reference/runners/self-hosted-runners#routing-precedence-for-self-hosted-runners` — self-hosted runner idle/busy 调度与排队语义。
- `https://docs.github.com/en/actions/get-started/understand-github-actions#jobs` — job、runner、step 与并行执行模型。

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `pre-tool-dispatcher.cts`: 已有 contributor 合成和 600 字符上限，可演进为统一 event dispatcher/governor，而不需要为每个 capability 复制宿主 handler。
- `once-marker.cts`: 已有 hash-only、exclusive-create、容量锁和 stable session identity，可扩展 context epoch 与 feedback 双 marker。
- `update-check.cts` / `update-worker.cts`: 已有 24 小时 cache、严格 semver、固定 Registry、bounded response、原子写入和 detached spawn；需让 SessionStart normalized event 能调度 refresh。
- `code-style-nudge.cts`: 已有 C/C++/Lua 精确扩展名、Write/Edit/MultiEdit/apply_patch 结构化解析和完整性门禁。
- `mcp-call-marker.cts`: 已有跨五宿主的 secret-free successful-call identity，可作为 feedback 成功触发和 authenticated receipt 的基础。
- `host-smoke.cts`: 已有 exact tgz acquisition、五宿主生命周期、loopback/packaged smoke 和 metadata receipt，可拆分 PACKAGED 与真实原生 LIVE lanes。

### Established Patterns

- Host adapter 只 read/render，所有项目修改经过 shared transaction；Hook 不能自行更新项目。
- Hook malformed、超限、unsupported、锁失败和 I/O 异常全部空 stdout、exit 0；不合格事件不得提前消费 once marker。
- Generated host trees 来自 canonical TypeScript/templates，任何新 SessionStart/feedback/receipt 资产必须进入 generator、pack audit 和 drift gate。
- Cursor/OpenCode 保持 Rule/plugin 语义；只有宿主真实支持且 receipt 证明的事件才可声称等价能力。
- 所有连接值和工具正文保持 opaque，诊断与 receipt 只输出稳定代码、路径和 metadata。

### Integration Points

- Host registration/adapters：增加受支持宿主的 SessionStart、epoch、feedback post-event 与 SessionEnd registration，同时保持手工 section 和其他宿主配置。
- Normalized dispatcher：把 SessionStart、PreToolUse、PostToolUse/plugin callbacks 规范化后交给 capability contributors 和 ReminderGovernor。
- Generator/package：同步 `plugin-src/`、compiled CJS、host assets、pack inventory、版本和 exact tgz fingerprints。
- Tests/smoke：新增 classifier table、epoch concurrency、feedback 双 marker、cache refresh、Windows command、native-event receipt schema 和 secret scan。
- CI：hosted PACKAGED matrix 产出唯一 tgz；受保护 Windows self-hosted LIVE job 下载同一 artifact，并由混合并行协调器产生五份 receipt。

</code_context>

<specifics>
## Specific Ideas

- SessionStart 提示采用“稳定核心 + 条件片段”：导航始终短注入；更新只有 confirmed newer cache；代码规范只有 capability/version/integrity 均支持。
- Hook matcher 可以宽，但 model-visible context 必须由窄语义 classifier 决定；handler 每次被启动不等于每次弹提示。
- LIVE receipt 使用 `status + stage + reasonCode`，并以 `evidenceLevel` 明确区分 PACKAGED 与 LIVE。
- 当前真实平台只有 Windows self-hosted；设计 workflow 时保持未来 runner pool 可扩展，但不虚构 Linux LIVE。

</specifics>

<deferred>
## Deferred Ideas

- 真正的后台自动更新：未来单独设计为显式 opt-in，必须复用完整 transaction/source/drift/rollback 门禁。
- Linux 真实宿主 LIVE：等待未来增加隔离 Linux self-hosted runner 后扩展；当前只交付 Linux PACKAGED evidence。
- Cursor/ZCode 五路全并行：等待独立 profile、无窗口焦点依赖和隔离 receipt 的真机证据。
- 全局 GSD Hook 与生产身份、HTTPS、凭据轮换：已移出当前 milestone，未来重新立项。

</deferred>

---

*Phase: 5-统一 Hook 策略与真实宿主验证*
*Context gathered: 2026-09-01*
