# Phase 5: 统一 Hook 策略与真实宿主验证 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-01
**Phase:** 5-统一 Hook 策略与真实宿主验证
**Areas discussed:** SessionStart 基线、提醒重置与重新触发、工具与 feedback 触发、真实宿主 PASS 矩阵

---

## SessionStart 基线

| Question | Option | Selected |
|----------|--------|----------|
| 提示组合 | 稳定核心 + 条件片段 | ✓ |
| 提示组合 | 固定完整清单 | |
| 提示组合 | 只注入导航 | |
| 更新条件 | 仅新鲜缓存确认有新版时提示 | ✓ |
| 更新条件 | 每次 SessionStart 都要求检查更新 | |
| 更新条件 | 不在 SessionStart 提示更新 | |
| 自动更新 | 自动获知，由用户明确执行 update | ✓ |
| 自动更新 | Hook 后台自动修改项目 | |
| 代码规范 | SessionStart 摘要 + 首次源码写入具体提醒 | ✓ |
| 代码规范 | 仅首次写入提醒 | |
| 上下文恢复 | startup/resume/clear/compact 使用同一有界基线 | ✓ |
| 上下文恢复 | compact 使用缩短版本 | |

**User's choice:** 首题选择方案 1，后续接受严格缓存、通知式更新、代码规范分层和四种 source 同基线。

**Notes:** “确认有新版”要求 24 小时内 schema-valid cache、严格 semver 比较和固定 HTTPS npm Registry worker；首次 SessionStart 缓存过期时只静默刷新，后续 SessionStart 才显示。真正自动更新被明确推迟。

---

## 提醒重置与重新触发

| Question | Option | Selected |
|----------|--------|----------|
| 默认粒度 | 每项目、每 capability、每 session 首次语义命中一次 | ✓ |
| 默认粒度 | 项目安装生命周期只提醒一次 | |
| 默认粒度 | 每次工具调用都提醒 | |
| Context epoch | `clear` 与 `compact` 开启新 epoch，`resume` 不开启 | ✓ |
| Context epoch | 只有 `clear` 开启新 epoch | |
| Context epoch | 同一 session 永不重置 | |
| 纠偏 | 不按时间、次数或违规额外重触发 | ✓ |
| 纠偏 | 时间与语义次数同时满足后再提醒一次 | |
| 清理 | 仅 receipt-proven SessionEnd 自动清理，其余遵循 D-19 人工重置 | ✓ |
| 清理 | 自动 TTL 过期 | |
| 清理 | 无条件 SessionEnd 删除 | |

**User's choice:** 接受 session 范围；追问 compact 后是否提醒，并明确允许 `clear/compact` 新 epoch；要求“简单点，先不考虑纠偏”；接受 receipt-proven cleanup。

**Notes:** epoch 加入 marker key，但仍保持 session 隔离。容量、I/O、锁或 cleanup 失败一律静默，不影响宿主工具。

---

## 工具与 feedback 触发

| Question | Option | Selected |
|----------|--------|----------|
| 导航 | Grep/Glob/Bash 宽 matcher + 窄语义输出 | ✓ |
| 导航 | 每次候选工具调用都提示 | |
| 导航 | 只保留 SessionStart | |
| 代码规范 | 结构化写入工具 + C/C++/Lua 扩展名过滤 | ✓ |
| 代码规范 | 所有写入方式或所有文件都提示 | |
| feedback 触发 | 首次成功 search_code/context/get_call_chain 后提醒 | ✓ |
| feedback 触发 | 任意 KCodeRag 或普通工具事件后提醒 | |
| feedback 状态 | epoch reminded marker + session submitted marker | ✓ |
| feedback 状态 | 只记录提醒或每次成功查询都催促 | |

**User's choice:** 接受宽 matcher、窄输出；接受当前结构化源码写入范围；接受仅真实成功且可评价的 KCodeRag 查询触发；接受 feedback 双 marker。

**Notes:** `list_indexes` 不算可评价结果。失败、取消、超时或宿主无法证明成功时不消费 marker。成功 `submit_feedback` 抑制整个 session；未提交时 `clear/compact` 新 epoch 可以再次提醒。AI 不得虚构用户反馈或提交敏感正文。

---

## 真实宿主 PASS 矩阵

| Question | Option | Selected |
|----------|--------|----------|
| Evidence level | 原生宿主事件才算 LIVE；直接 launcher 只算 PACKAGED | ✓ |
| Evidence level | launcher/替身可算 LIVE 或 skipped 可通过 | |
| 错误模型 | `status + stage + reasonCode` 与独立环境元数据 | ✓ |
| 错误模型 | 单一 `live_failed` | |
| 平台矩阵 | GitHub-hosted Windows/Linux packaged；Windows self-hosted 五宿主 live | ✓ |
| 平台矩阵 | 要求当前不存在的 Linux self-hosted live | |
| MCP evidence | 真实 authenticated query + metadata-only receipt | ✓ |
| MCP evidence | 保存原始结果或仅 loopback stub | |
| Gate | 普通 PR packaged；受保护触发 exact-artifact live | ✓ |
| Gate | 未受信任 fork 自动运行持久 self-hosted runner | |
| 单机并行 | Codex/Claude/OpenCode 并行，Cursor/ZCode 串行 | ✓ |
| 单机并行 | 五宿主无条件全并行 | |
| 单机并行 | 五宿主全部强制串行 | |

**User's choice:** 接受严格 LIVE 定义并要求更丰富错误码；说明当前只有 Windows 自托管 runner；接受 Windows 五宿主 LIVE、Linux PACKAGED。追问单 runner/job 并发后，接受一个 LIVE job 内的混合并行。

**Notes:** GitHub runner 注册实例是一条 job execution lane；单 job 可自行启动并等待多个宿主子进程。混合并行必须隔离 project/cwd/temp/npm cache/marker，并为每宿主提供独立 timeout、进程树回收和 receipt。Cursor/ZCode 在证明独立 profile 与无焦点依赖前不并行。

---

## the agent's Discretion

- Contributor 排序、最终英文提示词和宿主协议范围内的总字符预算。
- Normalized event/receipt schema 的内部类型、细粒度 reasonCode 完整枚举和安全超时值。
- 固定非敏感 canary、验收 feedback 内容与混合并行协调器的具体实现。

## Deferred Ideas

- 真正后台自动更新作为未来显式 opt-in 能力。
- Linux self-hosted LIVE coverage。
- 在真机证明独立 profile 后开放 Cursor/ZCode 并行。
- 全局 GSD Hook 与生产身份、HTTPS、凭据轮换。
