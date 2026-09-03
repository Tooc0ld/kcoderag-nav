---
quick_id: 260902-fyg
phase: quick-260902-fyg
plan: "01"
subsystem: cli-status
tags: [status, doctor, versions, update-cache]
requires:
  - quick: 260826-uvk
    provides: bounded offline update cache shared by supported hosts
provides:
  - installed and cached latest version metadata in status and doctor
  - explicit up_to_date, update_available, and unknown version states
  - human-readable version confirmation after mutations and in observation output
affects: [cli, hooks, generated-qa-runtime, packaging]
actuals:
  tasks: 2
  commits: 1
tech-stack:
  added: []
  patterns: [cache-only foreground status, nullable version evidence, capability health separated from update availability]
key-files:
  created: [.planning/quick/260902-fyg-expose-installed-and-latest-kcoderag-nav/260902-fyg-SUMMARY.md]
  modified: [src/cli/commands.cts, src/hooks/update-check.cts, kcoderag-qa/hooks/update-check.cjs, tests/cli/commands.test.cts, tests/hooks/update-check.test.cts]
key-decisions:
  - "status and doctor read only the validated local update cache and never add foreground registry latency."
  - "Only a fresh cache with a strictly newer version promotes healthy to update_available; stale, invalid, missing, or ahead-of-cache evidence is unknown."
  - "An available package update does not degrade the health of installed capabilities."
requirements-completed: []
completed: 2026-09-02
status: complete
---

# Quick 260902-fyg: 在状态界面展示安装与最新版本

## 完成内容

- `status` 和 `doctor` JSON 新增 `installedVersion`、`latestVersion`、`versionStatus`、`versionCheckedAt`。
- 人类可读输出新增安装版本、最新版本、三态结论和 ISO 检查时间。
- 新鲜缓存发现更高版本时顶层状态为 `update_available` 且仍返回 `ok:true`；capability 保持 `healthy`。
- 缺失、过期、损坏、禁用或无法比较的版本证据统一为 `unknown`，不误报“已是最新”。
- install/update/uninstall 的人类可读成功回执追加当前执行包版本。
- QA 自包含 `update-check.cjs` 通过生成器同步，发布清单不变。

## 实现提交

- CLI、缓存状态、生成资产和回归测试：`88f557c`

## 验证

- `npm run build`：PASS
- `node --test dist-tests/hooks/update-check.test.cjs dist-tests/cli/commands.test.cjs`：PASS，42/42
- `npm run generate:check`：PASS，无漂移
- `npm run pack:audit`：PASS，0.3.1，81 entries
- `git diff --check`：PASS

## 边界

- 没有增加前台网络请求、生产依赖、命令或安装状态 schema。
- 没有修改宿主 adapter 所有权、发布流程、远端或用户已有未提交的体验指南与 planning 内容。
