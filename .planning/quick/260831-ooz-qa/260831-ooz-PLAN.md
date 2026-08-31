---
quick_id: 260831-ooz
phase: quick-260831-ooz
plan: "01"
type: execute
status: planned
mode: quick
wave: 1
depends_on: []
files_modified:
  - docs/MCP_QA_EXPERIENCE_GUIDE.md
  - src/maintainer/local-guide-audit.cts
  - src/maintainer/docs-check.cts
  - tests/maintainer/local-guide-audit.test.cts
  - tests/maintainer/docs-check.test.cts
  - .planning/quick/260831-ooz-qa/260831-ooz-SUMMARY.md
  - .planning/STATE.md
autonomous: true
requirements: []
---

<objective>
把 QA 项目集成体验指南改成第一次使用者可以直接照做的安装和使用说明，并解除维护审计对内部验收术语的强制要求。

Output: 一份短小的用户指南，以及只检查用户必需信息的文档门禁。
</objective>

<tasks>

<task type="auto">
  <name>Task 1: 重写安装和使用指南</name>
  <files>docs/MCP_QA_EXPERIENCE_GUIDE.md</files>
  <action>删除发布、CI、receipt、digest、phase 和协议验收细节，只保留前置条件、交互/自动安装、安装验证、日常查询示例、更新、卸载和常见问题。保留 capability 与当前代码规范提示支持范围，避免用户选错。</action>
  <verify>从零阅读并逐条模拟安装、验证、查询、更新和卸载命令。</verify>
  <done>第一次使用者无需理解项目内部术语即可完成安装和日常使用。</done>
</task>

<task type="auto">
  <name>Task 2: 让文档门禁服务于用户指南</name>
  <files>src/maintainer/local-guide-audit.cts, src/maintainer/docs-check.cts, tests/maintainer/local-guide-audit.test.cts, tests/maintainer/docs-check.test.cts</files>
  <action>将本地指南审计改为检查安装、宿主、capability、验证、日常查询、更新/卸载与实际支持范围；让通用详细合同继续约束其他产品文档，但不再强迫入门指南重复内部实现和阶段证据。更新回归测试。</action>
  <verify>npm run build; npm run test:local-guide-audit; npm run test:docs; npm run guide:check; npm run docs:check; git diff --check</verify>
  <done>精简指南通过门禁，且其他公共文档原有详细合同没有被削弱。</done>
</task>

</tasks>

<scope_boundary>
不修改产品行为、CLI 参数、生成资产、README、发布状态、远端或用户现有未提交工作。
</scope_boundary>
