---
phase: quick
plan: 01
type: tdd
wave: 1
depends_on: []
files_modified:
  - README.md
  - AGENTS.md
  - .planning/PROJECT.md
  - tests/test_generation.py
  - tests/test_host_smoke.py
  - tests/test_pre_commit_generate.py
  - ../KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md
  - .planning/STATE.md
autonomous: true
requirements:
  - CURSOR-ONBOARD-01
  - CURSOR-VERIFY-01
estimate:
  tokens: 7000
  raw_tokens: 7000
  tasks: 2
  confidence: high
must_haves:
  truths:
    - "kcoderag-nav 删除本地 QA 指南副本，README 只链接 KCodeRag 服务仓库的权威指南。"
    - "KCodeRag 权威指南明确区分团队管理员接入仓库与普通开发者按项目安装两个角色。"
    - "管理员路径覆盖 GitHub App、Import from Repo、访问范围、Default Off、Auto Refresh 与保存。"
    - "开发者路径覆盖打开目标项目、Customize 安装 project scope、接受 QA 默认配置、reload 与 MCP 验证。"
    - "Dev 切换、卸载、更新和本地开发 fallback 都保持单环境与凭据不落文档边界。"
  artifacts:
    - path: "../KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md"
      provides: "从零接入 Cursor 私有插件的角色化操作指南和排障清单"
    - path: "tests/test_generation.py"
      provides: "Cursor 接入步骤与实际 manifest 字段的文档合同"
  key_links:
    - from: "../KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md"
      to: ".cursor-plugin/marketplace.json"
      via: "Import from Repo 后识别 kcoderag-nav 与 project-scope 安装"
      pattern: "Import from Repo|kcoderag-nav|project scope"
    - from: "../KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md"
      to: "kcoderag-cursor/.cursor-plugin/plugin.json"
      via: "QA 默认变量、单一 kcoderag MCP server 与 Dev 成对配置说明"
      pattern: "KCODERAG_MCP_URL|KCODERAG_BEARER_TOKEN|kcoderag"
---

<objective>
删除 kcoderag-nav 中错误归属的 QA 指南副本，把 README/合同改为链接 KCodeRag 服务仓库；只在 D:/AIProgram/KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md 维护完整 Cursor 接入，并同步修正互斥安装、status/update 与异步更新感知等过时说明。
</objective>

<context>
@AGENTS.md
@.planning/STATE.md
@README.md
@.cursor-plugin/marketplace.json
@kcoderag-cursor/.cursor-plugin/plugin.json
@kcoderag-cursor/mcp.json
@plugin-src/cursor/README.md.tmpl
@tests/test_generation.py
@../KCodeRag/AGENTS.md
@../KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: RED→GREEN 迁移 QA 指南所有权并清理本地副本</name>
  <files>README.md, AGENTS.md, .planning/PROJECT.md, tests/test_generation.py, tests/test_host_smoke.py, tests/test_pre_commit_generate.py, MCP_QA_EXPERIENCE_GUIDE.md</files>
  <action>先增加失败所有权合同，要求本仓库不再存在 MCP_QA_EXPERIENCE_GUIDE.md 且 README 链接 KCodeRag 权威文件；再删除本地副本，移除测试的本地文档依赖，并把项目约束改为服务仓库独占维护。历史 quick 记录不重写。</action>
  <verify>python -m unittest tests.test_generation tests.test_host_smoke tests.test_pre_commit_generate -v</verify>
  <done>kcoderag-nav 不再维护 QA 指南副本，CI 不依赖邻接仓库，用户仍可从 README 到达唯一权威文档。</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: 补齐 KCodeRag 权威指南并修正过时项</name>
  <files>../KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md</files>
  <action>只修改 KCodeRag 的权威指南：新增 Cursor 管理员 Team Marketplace 接入、开发者 project-scope QA 安装与验收、Dev 成对配置、卸载/本地 fallback/更新；同时把 QA/Dev 双装改为互斥，Codex 项目更新改为 status/update，补充 Python 3.10+ 与异步 fail-open 更新感知。不得暂存或改动 KCodeRag 现有其他大量用户修改。</action>
  <verify>用只读 Python 文档合同检查角色步骤、manifest 名称、互斥语义、status/update、异步 checker 与无新增凭据值。</verify>
  <done>KCodeRag 指南成为唯一且当前的 QA/Codex/Claude/Cursor/纯 MCP 使用入口。</done>
</task>

<task type="auto">
  <name>Task 3: 全量验证并记录 quick 交付</name>
  <files>.planning/quick/260821-eku-document-the-complete-cursor-onboarding-/260821-eku-SUMMARY.md, .planning/STATE.md</files>
  <action>运行 kcoderag-nav generation check、全量 unittest、pre-commit 和 diff check；确认 KCodeRag 仅权威指南出现新 diff且其他用户修改未被暂存；写 SUMMARY、更新 STATE 并提交 kcoderag-nav 清理与 quick 记录。不自动 push，不提交 KCodeRag 脏工作树。</action>
  <verify>python scripts/generate_plugins.py --check &amp;&amp; python -m unittest discover -s tests -p "test_*.py" -v &amp;&amp; git hook run pre-commit &amp;&amp; git diff --check</verify>
  <done>文档合同与全套离线门禁通过，工作树干净且 GSD quick 记录完整。</done>
</task>

</tasks>
