---
phase: quick
plan: 01
type: tdd
wave: 1
depends_on: []
files_modified:
  - .githooks/pre-commit
  - scripts/pre_commit_generate.py
  - tests/test_pre_commit_generate.py
  - README.md
  - MCP_QA_EXPERIENCE_GUIDE.md
  - .planning/STATE.md
autonomous: true
requirements:
  - PRECOMMIT-GEN-01
  - PRECOMMIT-SAFETY-01
  - CURSOR-UPDATE-DOC-01
estimate:
  tokens: 12000
  raw_tokens: 12000
  tasks: 3
  confidence: high
must_haves:
  truths:
    - "启用仓库 hook 后，git commit 会用统一生成器刷新 QA、Dev 与 Cursor 确定性内容版本。"
    - "生成物变化只会中止提交并要求人工检查和暂存，hook 绝不自动执行 git add。"
    - "规范源存在 partial staging 时必须在生成前拒绝，避免提交中的规范源和分发包错配。"
    - "基础 SemVer 仍需显式修改，Cursor 已安装用户仍依赖 Team Marketplace Auto Refresh 或手动 Refresh。"
  artifacts:
    - path: ".githooks/pre-commit"
      provides: "Git for Windows/POSIX 可执行的 Python 3.10+ pre-commit launcher"
    - path: "scripts/pre_commit_generate.py"
      provides: "credential-safe 生成、暂存边界检查与最终 generation check"
    - path: "tests/test_pre_commit_generate.py"
      provides: "隔离真实 Git lifecycle 与文档边界回归"
    - path: "README.md"
      provides: "维护者启用、重试与 Cursor 更新说明"
  key_links:
    - from: ".githooks/pre-commit"
      to: "scripts/pre_commit_generate.py"
      via: "Python 3.10+ launcher"
      pattern: "pre_commit_generate.py"
    - from: "scripts/pre_commit_generate.py"
      to: "scripts/generate_plugins.py"
      via: "先 --write，再检查 index 差异和 --check"
      pattern: "--write|--check"
    - from: "tests/test_pre_commit_generate.py"
      to: "kcoderag-cursor/.cursor-plugin/plugin.json"
      via: "真实 staged Cursor 规范变化生成内容哈希且不自动暂存"
      pattern: "kcoderag-cursor"
---

<objective>
提供一个可版本控制、可显式启用的 Git pre-commit：提交前运行 QA/Dev/Cursor 统一生成器；若生成物变化则中止提交，让开发者检查并暂存后重试；禁止自动 git add，并防止 partial staging 产生规范源与生成包不一致的提交。
</objective>

<context>
@AGENTS.md
@.planning/STATE.md
@scripts/generate_plugins.py
@tests/test_generation.py
@README.md
@MCP_QA_EXPERIENCE_GUIDE.md
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: RED→GREEN 增加安全的生成式 pre-commit</name>
  <files>tests/test_pre_commit_generate.py, scripts/pre_commit_generate.py, .githooks/pre-commit</files>
  <action>先增加失败合同，覆盖 clean pass、规范源变化触发生成后 abort、generated 文件暂存后 pass、规范源 partial staging 在生成前拒绝、无 git add、Cursor 生成目录纳入检查与安全诊断；再实现跨 Git for Windows/POSIX 的轻量 launcher 和标准库 Python helper。helper 只检查规范源与已知生成目录，不输出 MCP 内容或凭据。</action>
  <verify>python -m unittest tests.test_pre_commit_generate -v</verify>
  <done>hook 不会偷偷暂存文件；规范源与生成包不能错配提交；QA/Dev/Cursor 均由同一生成器刷新。</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: 文档化启用方式与 Cursor 更新边界</name>
  <files>README.md, MCP_QA_EXPERIENCE_GUIDE.md, tests/test_pre_commit_generate.py</files>
  <action>补充开发者一次性 git config core.hooksPath .githooks、生成物改变时 review/stage/recommit 流程、基础 SemVer 仍需显式修改，以及 Cursor 内容哈希由同一 hook 生成、已安装用户仍由 Team Marketplace Auto Refresh/Refresh 感知更新且无需自定义运行时 hook。</action>
  <verify>python -m unittest tests.test_pre_commit_generate tests.test_generation -v</verify>
  <done>README 与 QA 指南对本地提交、Cursor 本地生成和远端用户更新的职责划分一致。</done>
</task>

<task type="auto">
  <name>Task 3: 启用本 checkout 并完成离线验证</name>
  <files>.planning/quick/260821-ebz-add-a-safe-repository-pre-commit-hook-th/260821-ebz-SUMMARY.md, .planning/STATE.md</files>
  <action>在当前 checkout 设置 core.hooksPath=.githooks，运行全量 unittest、QA/Dev hook 自测、generation check、pre-commit clean gate 和 diff check；写 SUMMARY、更新 STATE 并原子提交代码与 quick 文档。不自动 push。</action>
  <verify>python -m unittest discover -s tests -p "test_*.py" -v &amp;&amp; python scripts/generate_plugins.py --check &amp;&amp; .githooks/pre-commit &amp;&amp; git diff --check</verify>
  <done>当前 checkout 自动触发 pre-commit，所有本地门禁通过，提交可审计且未修改 Cursor 运行时 hook 或 GSD 全局 hook。</done>
</task>

</tasks>
