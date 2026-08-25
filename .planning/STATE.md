---
gsd_state_version: 1.0
current_phase: 04
current_phase_name: 已部署项目与安装来源可靠性
status: executing
stopped_at: Completed 04-15-PLAN.md
last_updated: "2026-08-25T13:34:06.716Z"
last_activity: 2026-08-25
last_activity_desc: Phase 04 execution started
state_head: 73b17b74e8654366be87252cb2bb215b5c2639fa
progress:
  total_phases: 9
  completed_phases: 4
  total_plans: 53
  completed_plans: 52
  percent: 44
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-20)

**Core value:** 用户安装任一环境插件后即可获得可靠、低打扰、环境选择明确的 KCodeRag 图优先导航体验。
**Current focus:** Phase 04 — 已部署项目与安装来源可靠性

## Current Position

Phase: 04 (已部署项目与安装来源可靠性) — EXECUTING
Plan: 19 of 19
Status: Ready to execute
Last activity: 2026-08-25 — Phase 04 execution started

Progress: [████░░░░░░] 44%

## Performance Metrics

**Velocity:**

- Total plans completed: 34
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 1 | - | - |
| 2 | 1 | - | - |
| 3 | 1 | - | - |
| 03.1 | 31 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 03.1 P29 | 2 min | 2 tasks | 1 files |
| Phase 03.1 P01 | 19min | 3 tasks | 9 files |
| Phase 03.1 P02 | 12min | 2 tasks | 6 files |
| Phase 03.1 P03 | 12min | 2 tasks | 7 files |
| Phase 03.1 P22 | 8min | 3 tasks | 4 files |
| Phase 03.1 P08 | 9min | 2 tasks | 4 files |
| Phase 03.1 P26 | 12min | 2 tasks | 5 files |
| Phase 03.1 P07 | 9min | 2 tasks | 5 files |
| Phase 03.1 P09 | 8min | 2 tasks | 2 files |
| Phase 03.1 P10 | 3min | 2 tasks | 5 files |
| Phase 03.1 P11 | 3min | 2 tasks | 5 files |
| Phase 03.1 P23 | 23min | 3 tasks | 13 files |
| Phase 03.1 P04 | 16min | 3 tasks | 10 files |
| Phase 03.1 P05 | 15min | 3 tasks | 9 files |
| Phase 03.1 P06 | 8min | 2 tasks | 8 files |
| Phase 03.1 P13 | 11min | 3 tasks | 6 files |
| Phase 03.1 P15 | 37min | 3 tasks | 14 files |
| Phase 03.1 P30 | 4min | 2 tasks | 7 files |
| Phase 03.1 P16 | 6 min | 3 tasks | 7 files |
| Phase 03.1 P24 | 3min | 2 tasks | 4 files |
| Phase 03.1 P17 | 5min | 3 tasks | 7 files |
| Phase 03.1 P18 | 6min | 2 tasks | 6 files |
| Phase 03.1 P25 | 4min | 2 tasks | 5 files |
| Phase 03.1 P20 | 15min | 3 tasks | 7 files |
| Phase 03.1 P19 | 5min | 3 tasks | 6 files |
| Phase 03.1 P21 | 18min | 2 tasks | 3 files |
| Phase 03.1 P14 | 25 min | 3 tasks | 12 files |
| Phase 04 P01 | 13min | 2 tasks | 4 files |
| Phase 04 P14 | 5min | 2 tasks | 2 files |
| Phase 04 P02 | 20 min | 3 tasks | 12 files |
| Phase 04 P03 | 26min | 3 tasks | 9 files |
| Phase 04 P07 | 26min | 2 tasks | 36 files |
| Phase 04 P04 | 23min | 3 tasks | 11 files |
| Phase 04 P09 | 10min | 2 tasks | 5 files |
| Phase 04 P05 | 35min | 3 tasks | 13 files |
| Phase 04 P08 | 12min | 2 tasks | 1 files |
| Phase 04 P06 | 31min | 3 tasks | 10 files |
| Phase 04 P17 | 11min | 2 tasks | 1 files |
| Phase 04 P10 | 5min | 2 tasks | 1 files |
| Phase 04 P18 | 10min | 3 tasks | 1 files |
| Phase 04 P11 | 17min | 3 tasks | 7 files |
| Phase 04 P12 | 9min | 2 tasks | 2 files |
| Phase 04-deployment-reliability P13 | 22min | 3 tasks | 8 files |
| Phase 04 P19 | 20min | 3 tasks | 8 files |
| Phase 04 P15 | 92m | 3 tasks | 14 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table. Recent decisions affecting current work:

- [Phase 1]: 一份规范源生成两个自包含环境包；只读检查负责发现产物漂移。
- [Phase 2]: 默认项目级安装仅管理目标仓库的 `.codex/` 与 `.agents/`；QA 默认，QA/Dev 互斥，切换前必须显式卸载。
- [Phase 3]: 单环境只查询已安装环境；环境不可达时明确报告，索引不可用或陈旧时允许本地 fallback；导航 nudge 不创建跨环境所有权 marker，异步更新检查可使用有界、fail-open 的 cache/session marker。
- [Cursor]: 只发布一个可配置环境的 `kcoderag-nav`，使用单 MCP server、共享 skill 与 always-on Rule；默认通过免费 local 目录安装器分发，付费 Team Marketplace 仅为可选路径。
- [Reconciliation]: Phase 1–3 已根据 quick task 实现、当前代码与自动化测试回溯生成 canonical plan/summary/verification/validation，并于 2026-08-23 正式完成；后续强化项留在 Phase 4–8。
- [Phase 4]: 先更新真实 Head QA、修复子目录 hook 根路径，再扩展 user-level doctor；不得用自动卸载掩盖错误来源。
- [Phase 5]: fixed-string、本地复核、窄目录与常见 Lua 全局处理器应静默；semantic/hybrid 只能按实际索引能力推荐。
- [Phase 6]: loopback CI 不等于真实宿主 PASS；Codex、Claude Code 与 Cursor 必须分别留下可复跑证据。
- [Phase 7]: KCodeRag hook 与全局 GSD hook 分属不同所有者；GSD runtime 修复需要持久化或上游化。
- [Phase 8]: 内部内置凭据风险继续被接受到生产安全阶段，不提前声称已解决。
- [Phase 03.1]: Node dependency and build outputs use only exact root-anchored ignore rules. — This keeps npm/build artifacts out of Git without hiding nested paths, product packages, source, tests, planning, or unrelated work.
- [Phase 03.1]: Accepted the exact audited TypeScript 6.0.3, @types/node 22.20.1, and undici-types 6.21.0 graph; any graph, integrity, ownership, or lifecycle drift requires re-audit.
- [Phase 03.1]: Confirmed the public unscoped kcoderag-nav package and npx kcoderag-nav@latest install command.
- [Phase 03.1]: Codex QA installation uses full preflight/staging, state-last replacement, and complete rollback with secret-safe output.
- [Phase 03.1]: Clean CI builds compiled CJS before audit/tests and discovers compiled tests with an explicit glob.
- [Phase 03.1]: Host adapters declare managed roots and create validated desired state; only applyTransaction mutates installation files.
- [Phase 03.1]: Rollback failure retains a private project-local recovery tree while diagnostics expose only its safe relative path.
- [Phase 03.1]: Phase 03.1 Plan 03 preserves the Python hook heuristic exactly in TypeScript/CJS; precision policy remains deferred to Phase 5.
- [Phase 03.1]: Windows combines the Node 22 probe and hook invocation in one process so cmd.exe cannot consume redirected hook stdin before main runs.
- [Phase 03.1]: Legacy Python generation defers only within the ordered CJS launcher migration and still hard-gates unrelated canonical or partial-staging changes.
- [Phase 03.1]: Planning docs scan only fenced commands as active instructions; user/project docs also scan active install/update sections.
- [Phase 03.1]: Sibling-guide scans accept exactly the authoritative KCodeRag guide; repository policies accept explicit relative paths only.
- [Phase 03.1]: Sibling receipts bind the guide-only commit parent to baseline HEAD and verify a reproducible baseline evidence digest.
- [Phase 03.1]: A single hashed session marker owns both fresh-cache notice deduplication and stale-cache refresh scheduling; it contains no query, credential, or MCP data. — This enforces one-per-session behavior with one bounded local ownership mechanism.
- [Phase 03.1]: The foreground hook reads only validated local state/cache and loads update support as optional fail-open capability; only the detached worker imports HTTPS. — Registry latency and optional update-runtime failures must never enter or disable the tool-call advisory path.
- [Phase 03.1]: Registry refresh accepts only the fixed kcoderag-nav metadata endpoint, expected JSON content types, matching package name, and strict X.Y.Z dist-tags.latest. — The update cache must not trust redirects, arbitrary package responses, malformed metadata, or prerelease values.
- [Phase 03.1]: HostAdapter methods remain read/render-only; executeCommand is the sole adapter-to-applyTransaction bridge.
- [Phase 03.1]: JSON mutations require explicit host and --yes, while status and doctor remain read-only and report runtime issues.
- [Phase 03.1]: Cursor legacy user-removal authority is independent from --yes and is forwarded only to Cursor mutations.
- [Phase 03.1]: Codex current state uses exact environment-specific ownership sets; ambiguous or partial ownership is invalid. — Exact ownership is required before safe update, uninstall, or legacy replacement.
- [Phase 03.1]: Legacy parsing is host-neutral and receives allowed and required paths from the Codex adapter. — This rejects unknown owners without leaking Codex paths into the shared transaction core.
- [Phase 03.1]: Legacy migration deletes only digest-confirmed Python runtime files and preserves unowned local files. — Deletion authority comes solely from verified installer state.
- [Phase 03.1]: Phase 03.1 generator ordering uses explicit code-unit comparison instead of locale-sensitive sorting.
- [Phase 03.1]: Phase 03.1 all-product runtime groups target QA and Dev; explicit Cursor runtime generation is incompatible.
- [Phase 03.1]: Phase 03.1 generator diagnostics expose only stable codes and safe relative paths while connection inputs remain opaque outside mechanical host projection.
- [Phase 03.1]: Phase 03.1 repository-default generated-tree verification remains deferred to Plan 23 after package migration.
- [Phase 03.1]: QA runtime migration is limited to the five guaranteed-changing runtime-code paths; hook registration and metadata remain read-only for Plan 23. — This preserves the ordered generator migration and makes every write attributable to an exact asset group.
- [Phase 03.1]: Generated QA CJS bytes match dist exactly and launchers match the canonical plugin-src sources exactly. — Byte identity provides deterministic ownership and prevents hand-edited deployment drift.
- [Phase 03.1]: Dev runtime migration is limited to the five guaranteed-changing runtime-code paths; registration and metadata remain read-only for Plan 23. — This keeps the generated write set exact and auditable.
- [Phase 03.1]: Dev and QA share canonical bytes but remain runtime-independent. — A Dev-only temporary fixture proved all modules and both launchers operate without a QA tree.
- [Phase 03.1]: After a read-only RED gate exposed twelve committed canonical drifts, an explicit user-approved narrow migration restored the repository check-only invariant.
- [Phase 03.1]: Repository generation evidence uses compiled checks plus SHA-256, size, mtime, and tree digests without emitting connection values.
- [Phase 03.1]: Exact project-root files require an exact managed-root declaration. — This permits Claude .mcp.json while retaining all undeclared-root, traversal, symlink, and special-file refusals.
- [Phase 03.1]: Cursor legacy deletion uses independent authority and private migration evidence. — Exact tree/profile preflight plus journaled backup and compensation protect both project and user-local trees.
- [Phase 03.1]: Cursor remains a Rule, skill, and MCP integration without hook emulation. — Cursor host semantics are intentionally distinct from Codex and Claude Code PreToolUse hooks.
- [Phase 03.1]: Public host dispatch uses one fixed Codex, Claude Code, and Cursor registry. — One selected adapter owns each command, and OpenCode remains deferred without core transaction changes.
- [Phase 03.1]: The Node pre-commit gate snapshots index bytes and staged blob OIDs, refuses partial canonical staging, and never stages or resets files.
- [Phase 03.1]: The pack gate compares one real temporary tgz with the exact expanded allow-list and validates rendered assets without exposing configuration values.
- [Phase 03.1]: Required CI is test-only on Windows/Linux and Node 22/24; build precedes the compiled dependency audit and publication remains separate.
- [Phase 03.1]: The aggregate Node test suite is serialized so repository immutability evidence cannot race root-level test fixtures.
- [Phase 03.1]: Required contract smoke acquires and invokes a real temporary npm package, then requires all eleven Codex/Claude/Cursor lifecycle and MCP evidence bits for PASS.
- [Phase 03.1]: Loopback smoke receipts contain only path, method, tool name, and request id; headers, arguments, configuration, and credentials stay outside evidence output.
- [Phase 03.1]: Optional authenticated smoke is isolated behind workflow_dispatch and an explicit self-hosted runner gate, and cannot replace required contract smoke.
- [Phase 03.1]: Release preparation owns exactly seven version paths and independently proves generator, diff, staged, and committed path equality.
- [Phase 03.1]: Local .planning and .gsd state may be dirty but must remain byte-identical and is never staged by release preparation.
- [Phase 03.1]: Sanitized publish receipts are closed, offline evidence documents binding tag/version, release/workflow SHA, registry metadata, and complete public host evidence.
- [Phase 03.1]: Only v*.*.* tag pushes can reach the minimal-permission npm publish workflow, with NPM_TOKEN scoped to the final step.
- [Phase 03.1]: Plan 15 freezes production at 9819a12; planning-only descendants remain valid but any production-tree drift revokes cleanup authority.
- [Phase 03.1]: Plan 30 exclusively owns removal of the exact 26 authorized cache files and five empty roots; Plan 15 performs no live deletion.
- [Phase 03.1]: The successful five-suite receipt is the final Python invocation; all later retirement and verification work is Node-only.
- [Phase 03.1]: Retained Python parity tests validate current Node products until their ordered retirement rather than preserving obsolete Python runtime expectations.
- [Phase 03.1]: Plan 30 invoked only the compiled, freshly tested cleanup CLI; no independent receipt, path, or deletion implementation was introduced.
- [Phase 03.1]: The exact five cache roots were untracked generated state; Git records no tracked deletion, while canonical receipts preserve path-and-hash evidence.
- [Phase 03.1]: Plan 16 verifies the frozen pre-retirement receipt only before its exact tracked deletions and never reruns it after frozen inventory changes.
- [Phase 03.1]: Plan 16 owns exactly four plugin-src and three QA deletions; Dev, scripts, and remaining tests stay intact for their ordered retirement plans.
- [Phase 03.1]: Partial source retirement uses targeted Node evidence and defers repository-wide generation until Plan 24 completes the matching Dev stage.
- [Phase 03.1]: Plan 24 owns exactly the three Dev Python hook paths and root GitHub-raw update index; later scripts and tests remain intact for ordered retirement. — This preserves the receipt-backed deletion boundary and keeps recovery to a single Git revert.
- [Phase 03.1]: Post-source completion requires source_remaining zero and a mutation-free all-product generate check. — The monotonic audit and read-only generation evidence jointly prevent partial retirement from being treated as complete.
- [Phase 03.1]: Plan 17 removes exactly the seven authorized scripts paths after Node replacement evidence; Python tests remain for their ordered Plan 18/25 retirement. — Keeps the destructive boundary receipt-backed, narrow, and recoverable.
- [Phase 03.1]: Executable package, hook, pre-commit, and CI entrypoints are Node-only before script deletion; historical test and documentation references remain owned by later plans. — Separates live execution retirement from the already-planned test and documentation cleanup.
- [Phase 03.1]: Each responsibility group has its own revertable commit, while the post-scripts audit is the monotonic completion gate. — Preserves focused recovery and machine-verifiable retirement progress.
- [Phase 03.1]: Plan 18 retires exactly six mapped Python tests but advances no retirement audit mode; Plan 25 exclusively owns the remaining five paths and the first post-tests transition.
- [Phase 03.1]: Plan 25 removes exactly the five paths preserved by Plan 18; documentation and marketplace assets remain outside this retirement boundary. — This keeps destructive ownership narrow and recovery to one ordinary revert.
- [Phase 03.1]: The post-tests transition is valid only after all eleven legacy test paths are absent and the compiled Node suite remains fully green. — The audit and 140-case suite jointly prevent file absence from being mistaken for verified retirement.
- [Phase 03.1]: Required-contract NOT_RUN or missing evidence remains a failure; only optional live smoke may remain explicitly NOT_RUN. — Required CI must never convert skipped host evidence into PASS.
- [Phase 03.1]: Root marketplace catalogs are retired; generated compatibility manifests remain package assets rather than user install sources.
- [Phase 03.1]: The product contract is Node.js 22+ CJS deployed by public npx into one selected host native project boundary.
- [Phase 03.1]: Phase 6 pins exact public npx lifecycle evidence; Phase 8 publishes only from package-version-matching vX.Y.Z tags.
- [Phase 03.1]: Public documentation treats kcoderag-nav as a Node.js 22+ npx project integration, not a marketplace plugin or repository-checkout installer.
- [Phase 03.1]: Cursor documentation exposes Rule, skill, and MCP semantics without claiming Codex/Claude Code PreToolUse hook equivalence.
- [Phase 03.1]: Canonical README templates and all three generated README assets commit together under the versioned pre-commit gate.
- [Phase 03.1]: KCodeRag remains the sole owner of MCP_QA_EXPERIENCE_GUIDE.md; kcoderag-nav stores only sanitized cross-repository provenance.
- [Phase 03.1]: Codex, Claude Code, and Cursor share the Node.js 22+ npx lifecycle while Cursor uses Rule, skill, and MCP rather than an equivalent PreToolUse hook.
- [Phase 03.1]: Guide-only sibling commits on a dirty staged index use a normal-hook temporary clone and exact fast-forward, preserving the original index and baseline.
- [Phase 03.1]: Keep failed v0.1.5 immutable and unpublished; user-authorized v0.1.6 is the first successful public npm release.
- [Phase 03.1]: Accept only GitHub Release run 32682791252 because tag, release SHA, push event, and success conclusion all match v0.1.6.
- [Phase 03.1]: Require latest metadata, fresh-cache public npx lifecycle, and exact-version three-host MCP loopback evidence before recording the offline receipt.
- [Phase 04]: Phase 04 supersedes the former public QA/Dev contract with QA-only 0.2.0 behavior while preserving completed history.
- [Phase 04]: Legacy Dev remains exact decode-only input for digest-verified migration or uninstall, never a hidden public product.
- [Phase 04]: Owned user-source cleanup authority is independent and bound to a frozen exact fingerprint.
- [Phase 04]: Public documentation exposes QA as the sole environment while retaining exact legacy Dev migration and uninstall instructions only.
- [Phase 04]: Owned user-source cleanup remains native-command, capability, scope, rescan, and frozen-fingerprint bound; ambiguous sources remain manual-only.
- [Phase 04]: Phase 04 documentation claims lifecycle and Hook/Rule evidence only; authenticated real-host MCP evidence remains Phase 06 ownership.
- [Phase 04]: Current schema v1 is QA-only through parseInstallState; exact Python and Node QA/Dev records remain available only through parseLegacyInstallState.
- [Phase 04]: General confirmation never implies legacy Dev conversion; install/update require independent observation-bound allowLegacyDevMigration authority.
- [Phase 04]: Unsafe target boundaries are canonical and selected-host scoped, preserving ordinary non-VCS and other-host project directories.
- [Phase 04]: Every public host lifecycle renders QA only; Dev identity is retained solely for exact legacy migration and uninstall compatibility.
- [Phase 04]: Cursor user-local legacy ownership is filesystem and digest based, never credential-semantic.
- [Phase 04]: Exactly decoded legacy identity remains attached to drift observations so managed drift is the primary refusal.
- [Phase 04]: The QA-only canonical switch, QA/Cursor regeneration, npm/release inventory update, and complete Dev deletion form one hook-enabled atomic GREEN commit.
- [Phase 04]: A full all/all generation check rejects any retired kcoderag-dev tree, while targeted QA/Cursor generation remains deterministic.
- [Phase 04]: Generated product READMEs transitioned with their canonical templates so the public package never advertises an installable Dev environment.
- [Phase 04]: Exact legacy Dev migration remains source-owned and independent of deleted generated bytes or credential values.
- [Phase 04]: Only ENOENT permits Hook ancestor traversal; every other nearest state-path result is a silent non-skippable boundary.
- [Phase 04]: Codex, Claude, and generated compatibility registration share one canonical rootless command renderer with no absolute project identity.
- [Phase 04]: The rootless Hook validates exact current QA metadata and a contained launcher digest before execution.
- [Phase 04]: The Windows rootless command remains below cmd.exe's 8192-character boundary.
- [Phase 04]: Cursor product evidence is restricted to member names, versions, sizes, hashes, booleans, and stable non-content failure codes.
- [Phase 04]: Codex cleanup capability requires supported runtime observation, exact native schemas, complete inventory, and fixed non-shell argv.
- [Phase 04]: Owned source cleanup requires dedicated authority bound to a fresh canonical SHA-256 fingerprint and a complete clean rescan before project rendering.
- [Phase 04]: The degraded Codex route recognizes only the exact owned kcoderag-nav marketplace registration; every ambiguous, raw, or manual source remains manual-only.
- [Phase 04]: Status uses a bounded fast scan, doctor is deep and read-only, and install/update independently run the full selected-host gate.
- [Phase 04]: Plan 04-08 keeps generated QA runtime provenance at atomic commit 022a9d8 when fresh rendering produces zero byte changes.
- [Phase 04]: Nearest-state discovery remains in the registered rootless bootstrap; selected launchers stay self-relative and fail-open.
- [Phase 04]: Claude cleanup requires observed 2.1.241+ exact help and inventory schemas; scoped plugin uninstall is preferred and marketplace removal requires exclusive ownership.
- [Phase 04]: Cursor Rules use manual_rule and remain manual-only without a verified native uninstall capability.
- [Phase 04]: Owned source cleanup and legacy Dev migration are independent, mutually exclusive authorities.
- [Phase 04]: Plan 04-17 preserves absorbed QA product provenance when fresh canonical generation is byte-identical.
- [Phase 04]: Plan 04-17 verifies opaque MCP projections only through safe metadata and digests.
- [Phase 04]: Plan 04-10 keeps public package and Dev discovery retirement attributed to atomic commit 022a9d8.
- [Phase 04]: Public QA-only README and sibling guide commits are proven to precede Dev discovery retirement.
- [Phase 04]: Plan 04-18 preserves exact nine-path Dev deletion provenance at atomic commit 022a9d8 and introduces no alias, shim, or replacement tree.
- [Phase 04]: Legacy Dev compatibility remains source-owned exact decoding and dedicated migration authority independent of retired generated bytes.
- [Phase 04]: Pre-release evidence binds three verdict artifacts to one immutable subject and a separate evidence-only child with exact four-lane CI.
- [Phase 04]: Head acceptance recomputes the canonical Codex cleanup fingerprint and accepts only bounded metadata-only publication, cleanup, Hook, and scope evidence.
- [Phase 04]: Pre-release and Head evidence validators remain repository-only compiled tools excluded from every public package inventory boundary.
- [Phase 04]: The permanent release identity is one frozen code-unit-sorted five-path allow-list: three QA/Cursor compatibility manifests plus package-lock.json and package.json.
- [Phase 04]: Any missing, extra, or retired Dev compatibility manifest is rejected before generator or gate execution with one path-free stable code.
- [Phase 04]: Release preparation remains a local-only helper with explicit write, stage, commit, and tag recovery seams; publication commands are absent.
- [Phase 04]: Required smoke uses isolated synthetic native inventories and closed boolean/digest receipts; optional live keeps its narrower QA-only evidence set.
- [Phase 04]: Codex and Claude smoke executes the acquired package registered Hook command from root and deep cwd; Cursor remains Rule/skill/MCP-only.
- [Phase 04]: Pre-commit separates QA/Cursor generated roots and rejects staged Dev or retired marketplace roots before build without index mutation.
- [Phase 04]: CI and Release expose exact ubuntu/windows Node 22/24 lane tuples bound to github.sha; NPM_TOKEN remains publish-step-only after matrix success.
- [Phase 04]: Generated package guides expose one project-scoped @latest QA lifecycle while keeping Dev solely in exact legacy migration and uninstall prose.
- [Phase 04]: The authoritative KCodeRag guide is pinned to its Plan 14 digest and guide-only commit; audit evidence uses repository fingerprints rather than absolute paths.
- [Phase 04]: Cursor documents Rule, skill, and MCP behavior without claiming a Codex or Claude Code PreToolUse equivalent.
- [Phase 04]: 04-15: preserve distinct immutable implementation, evidence, and release commits in one direct-child chain
- [Phase 04]: 04-15: retire failed attestation forward and refreeze rather than reuse stale evidence
- [Phase 04]: 04-15: public 0.2.0/tag/latest are immutable and defects fix forward as 0.2.1

### Pending Todos

- 更新 `I:\JX3_SVN\Head` 的项目级 QA，并在新 Codex 任务中确认状态健康。
- 在 Phase 5 规划前用 `list_indexes` 复核 QA 当前 semantic/hybrid 实际能力。

### Blockers/Concerns

- Phase 1–3 是基于当前代码、quick history 与测试的回溯完成记录；实现提交仍保留在 quick task 历史中。
- Head 当前项目级 QA 为 `update_available`，差异位于受管 `grep_nudge.py`；全局 QA/Dev 重复来源未检出。
- Head hook launcher 当前仍使用相对 `.codex/...` 路径，从嵌套子目录启动的稳定性尚未保证。
- required CI 只证明 loopback/offline 契约；authenticated real-host smoke 尚未运行。
- GSD runtime 本地补丁当前解析正确，但 GSD 更新可能覆盖，且全局 context monitor 仍注册过宽。
- 当前内置 Bearer 仅接受于内部 QA/Dev 阶段；不得在日志、测试输出或文档中泄露其值。
- Cursor 扩大到公开分发前应移除内置 Bearer 默认值；当前免费 local 安装仅面向内部 QA/Dev，Cloud Agent 仍需单独确认内部网络可达性。

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260820-nhw | QA/Dev 规范源、生成式独立产物、项目级安装生命周期、QA 优先路由、hook 去重与 E2E | 2026-08-20 | fd40d70 | [260820-nhw-kcoderag-nav-qa-dev-qa-dev-qa-hook-e2e](./quick/260820-nhw-kcoderag-nav-qa-dev-qa-dev-qa-hook-e2e/) |
| 260820-p1v | 将 QA/Dev 项目级插件迁移到 kcoderag-nav，并让 KCodeRag 仅保留 QA/Dev MCP 配置 | 2026-08-20 | local-only | [260820-p1v-qa-dev-kcoderag-nav-kcoderag-qa-dev-mcp](./quick/260820-p1v-qa-dev-kcoderag-nav-kcoderag-qa-dev-mcp/) |
| 260820-t66 | Fix installer ownership and cross-host versioning | 2026-08-20 | 0b478fc | [260820-t66-fix-installer-ownership-and-cross-host-v](./quick/260820-t66-fix-installer-ownership-and-cross-host-v/) |
| 260820-thb | Python 3.10+ fail-open runtime、只读 status、stub MCP 双宿主 smoke CI 与 QA 指南 | 2026-08-20 | 4104675 | [260820-thb-python-3-10-hook-fail-open-claude-code-c](./quick/260820-thb-python-3-10-hook-fail-open-claude-code-c/) |
| 260820-umj | 修复管道和复合命令的 scope 误判，补回归测试，并适度缩短 nudge | 2026-08-20 | 9c97596 | [260820-umj-scope-nudge](./quick/260820-umj-scope-nudge/) |
| 260820-vuc | QA/Dev 互斥安装，移除双环境 routing 与跨进程 hook 去重 | 2026-08-20 | 1119e67 | [260820-vuc-make-qa-and-dev-installations-mutually-e](./quick/260820-vuc-make-qa-and-dev-installations-mutually-e/) |
| 260820-wwm | 单环境 Cursor 私有插件、共享 skill、always-on Rule 与 Team Marketplace 分发 | 2026-08-20 | 76fe0e1, 55291ad | [260820-wwm-add-private-cursor-plugin-distribution-w](./quick/260820-wwm-add-private-cursor-plugin-distribution-w/) |
| 260820-w7c | QA/Dev 首次 PreToolUse 延迟更新感知、确定性版本与显式更新命令 | 2026-08-20 | 8cf74e0 | [260820-w7c-add-lazy-first-pretooluse-update-detecti](./quick/260820-w7c-add-lazy-first-pretooluse-update-detecti/) |
| 260821-07f | 将 QA/Dev/Cursor 插件基础版本升至 0.1.2 并发布本地累积改动 | 2026-08-21 | 8774487 | [260821-07f-bump-plugin-base-version-from-0-1-1-to-0](./quick/260821-07f-bump-plugin-base-version-from-0-1-1-to-0/) |
| 260821-0nj | 记录 Cursor Team Marketplace Auto Refresh、手动 Refresh 与本地同步更新路径 | 2026-08-21 | d147f66 | [260821-0nj-document-cursor-team-marketplace-auto-re](./quick/260821-0nj-document-cursor-team-marketplace-auto-re/) |
| 260821-0r6 | 将 Cursor 更新说明同步到 QA 体验指南，并建立同次更新约束 | 2026-08-21 | d711b1a | [260821-0r6-synchronize-cursor-update-guidance-into-](./quick/260821-0r6-synchronize-cursor-update-guidance-into-/) |
| 260821-dlq | 将首次 PreToolUse 更新检查改为后台异步刷新 | 2026-08-21 | 1b30aae, be7994c | [260821-dlq-make-the-kcoderag-first-pretooluse-updat](./quick/260821-dlq-make-the-kcoderag-first-pretooluse-updat/) |
| 260821-ebz | 安全地在 pre-commit 生成 QA/Dev/Cursor 包并拒绝错配暂存 | 2026-08-21 | bbe8810, 57ac336 | [260821-ebz-add-a-safe-repository-pre-commit-hook-th](./quick/260821-ebz-add-a-safe-repository-pre-commit-hook-th/) |
| 260821-eku | 删除本仓库指南副本，并在 KCodeRag 权威指南补齐 Cursor 接入与当前更新流程 | 2026-08-21 | e05aaa5 | [260821-eku-document-the-complete-cursor-onboarding-](./quick/260821-eku-document-the-complete-cursor-onboarding-/) |
| 260821-flg | 为免费 Cursor 用户增加 local 插件 install/status/update/uninstall，并更新权威指南 | 2026-08-21 | b284819 | [260821-flg-add-a-free-cursor-local-plugin-installer](./quick/260821-flg-add-a-free-cursor-local-plugin-installer/) |
| 260821-g07 | 将 QA/Dev/Cursor 基础版本升级到 0.1.3，验证并推送累计本地改动 | 2026-08-21 | 71f6778 | [260821-g07-bump-plugin-base-version-to-0-1-3-regene](./quick/260821-g07-bump-plugin-base-version-to-0-1-3-regene/) |
| 260821-kqa | 修复 Codex bundled MCP direct map，硬停止重复来源，并发布 QA/Dev/Cursor 0.1.4 | 2026-08-21 | 1602284 | [260821-kqa-fix-codex-bundled-mcp-compatibility-with](./quick/260821-kqa-fix-codex-bundled-mcp-compatibility-with/) |
| 260824-ecs | Enable stricter TypeScript compiler checks in source and test configs and verify the build | 2026-08-24 | 7dcbbfa | [260824-ecs-enable-stricter-typescript-compiler-chec](./quick/260824-ecs-enable-stricter-typescript-compiler-chec/) |

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Security | 个人/组织身份、HTTPS 与凭据轮换 | Scheduled in Phase 8 (SEC-01 to SEC-03) | 2026-08-23 |
| Release | CI 发布自动化与宿主版本兼容矩阵 | Scheduled in Phase 8 (REL-01 to REL-02) | 2026-08-23 |

### Roadmap Evolution

- Phase 03.1 inserted after Phase 3: JavaScript 与 npx 安装运行时迁移 (URGENT)
- Phase 4 added: 已部署项目与安装来源可靠性。
- Phase 5 added: 低误报 Hook 与诚实路由。
- Phase 6 added: 真实宿主兼容与发布证据。
- Phase 7 added: GSD 运行时与全局 Hook 整理。
- Phase 8 added: 生产安全与自动化发布。
- Phase 1–3 completed retrospectively with canonical plan, summary, verification, and validation artifacts on 2026-08-23.

## Session Continuity

Last session: 2026-08-25T13:34:06.400Z
Stopped at: Completed 04-15-PLAN.md
Resume file: None
