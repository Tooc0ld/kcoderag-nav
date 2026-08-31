---
quick_id: 260831-ooz
phase: quick-260831-ooz
plan: "01"
subsystem: documentation
tags: [user-guide, onboarding, documentation-audit]
requires:
  - quick: 260831-nb1
    provides: repository-local authoritative QA guide
provides:
  - concise installation and daily-use guide for all five hosts
  - user-guide-specific documentation contract without maintainer-only evidence requirements
affects: [documentation, ci, packaging]
actuals:
  tasks: 2
  commits: 1
tech-stack:
  added: []
  patterns: [task-focused user guide, separate maintainer and onboarding documentation contracts]
key-files:
  created: [.planning/quick/260831-ooz-qa/260831-ooz-SUMMARY.md]
  modified: [docs/MCP_QA_EXPERIENCE_GUIDE.md, src/maintainer/local-guide-audit.cts, src/maintainer/docs-check.cts, tests/maintainer/local-guide-audit.test.cts, tests/maintainer/docs-check.test.cts]
key-decisions:
  - "The guide serves a first-time user whose goal is to install, verify, query, update, or uninstall."
  - "Detailed lifecycle and evidence contracts remain enforced for the other canonical product documents, but not repeated in the onboarding guide."
requirements-completed: []
completed: 2026-08-31
status: complete
---

# Quick 260831-ooz: 精简安装和使用指南

## 完成内容

- 将指南从 233 行缩短到 103 行。
- 正文只保留前置条件、交互与自动安装、验证、自然语言使用示例、更新、卸载和常见问题。
- 删除 Phase、CI、receipt、digest、readiness、publish 和协议验收等维护者内容。
- 保留五宿主、两个 capability 和 Claude Code 2.1.241 代码规范提示范围，避免用户安装错误。
- 将指南从通用详细产品合同中分离，改为 7 项用户操作合同；其他 README 的详细合同保持不变。

## 实现提交

- 指南、门禁与回归测试：`88c531d`

## 验证

- `npm run build`：PASS
- `npm run test:local-guide-audit`：PASS，6/6
- `npm run test:docs`：PASS，11/11
- `npm run guide:check`：PASS，7 个用户主题
- `npm run docs:check`：PASS，6 个规范文档
- `npm run deps:audit`：PASS
- `npm run pack:audit`：PASS，0.3.0，77 entries
- `git diff --check`：PASS

## 边界

- 产品运行时、CLI 参数、README、生成资产、发布状态、标签和远端均未修改。
- 既有未提交和未跟踪文件未纳入提交。
