---
quick_id: 260902-fyg
phase: quick-260902-fyg
plan: "01"
type: execute
status: planned
mode: quick
wave: 1
depends_on: []
files_modified:
  - src/hooks/update-check.cts
  - src/cli/commands.cts
  - kcoderag-qa/hooks/update-check.cjs
  - tests/hooks/update-check.test.cts
  - tests/cli/commands.test.cts
  - .planning/quick/260902-fyg-expose-installed-and-latest-kcoderag-nav/260902-fyg-SUMMARY.md
  - .planning/STATE.md
autonomous: true
requirements: []
---

<objective>
让用户在 `status` 和 `doctor` 输出中确认 KCodeRag Nav 是否完整安装、当前安装版本以及缓存所知的 npm 最新版本。

Output: secret-safe、只读、三态的版本状态 JSON/文本输出及覆盖其行为的回归测试。
</objective>

<tasks>

<task type="auto">
  <name>Task 1: 暴露缓存版本状态并接入观察命令</name>
  <files>src/hooks/update-check.cts, src/cli/commands.cts</files>
  <action>从现有有界更新缓存派生 `up_to_date`、`update_available`、`unknown` 三态结果，包含 nullable installed/latest/checkedAt 元数据；让 status/doctor 输出这些字段，并且仅在安装健康且确认有更新时把聚合状态提升为 update_available。保持观察命令只读、无前台网络访问、异常 fail-open，且 capability 健康状态不因存在更新而降级。</action>
  <verify>`npm run build`; focused update-check and CLI command tests</verify>
  <done>JSON 与人类可读输出都能区分已安装版本、最新版本、有更新、已最新和未知。</done>
</task>

<task type="auto">
  <name>Task 2: 增加三态和无写入回归覆盖</name>
  <files>tests/hooks/update-check.test.cts, tests/cli/commands.test.cts</files>
  <action>覆盖 fresh equal/newer、missing/stale/invalid cache、未安装状态、status/doctor JSON 和文本输出，并证明观察命令不修改项目文件。隔离测试缓存根，避免开发机缓存影响测试结果。</action>
  <verify>`npm run build`; `node --test dist-tests/hooks/update-check.test.cjs dist-tests/cli/commands.test.cjs`; `git diff --check`</verify>
  <done>版本展示具有确定性，离线或坏缓存不会误报最新，也不会改变项目内容。</done>
</task>

</tasks>

<scope_boundary>
不增加前台网络请求，不改变 npm 发布、宿主 adapter 所有权、安装状态 schema 或受管文件；不修改当前已有未提交变更的体验指南和 planning 文件。
</scope_boundary>

<success_criteria>
- 健康安装显示 installedVersion；新鲜缓存显示 latestVersion 和 checkedAt。
- 版本相等时为 up_to_date；缓存版本更高时为 update_available；不能证明时为 unknown。
- update_available 仍然 ok:true，已安装 capability 保持 healthy。
- status/doctor 保持 secret-safe、只读且无前台网络依赖。
- 聚焦测试、构建和 diff hygiene 通过。
</success_criteria>
