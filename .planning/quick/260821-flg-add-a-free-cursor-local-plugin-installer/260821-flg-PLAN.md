---
phase: quick
plan: 01
type: tdd
wave: 1
depends_on: []
files_modified:
  - scripts/manage_cursor_local_install.py
  - tests/test_cursor_local_install.py
  - tests/test_generation.py
  - tests/test_pre_commit_generate.py
  - README.md
  - AGENTS.md
  - .planning/PROJECT.md
  - plugin-src/cursor/README.md.tmpl
  - kcoderag-cursor/README.md
  - kcoderag-cursor/.cursor-plugin/plugin.json
  - .cursor-plugin/marketplace.json
  - kcoderag-qa/hooks/__pycache__/grep_nudge.cpython-314.pyc
  - kcoderag-dev/hooks/__pycache__/grep_nudge.cpython-314.pyc
  - ../KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md
  - .planning/STATE.md
autonomous: true
requirements:
  - CURSOR-LOCAL-01
  - CURSOR-LIFECYCLE-01
estimate:
  tokens: 9000
  raw_tokens: 9000
  tasks: 3
  confidence: high
must_haves:
  truths:
    - "Cursor Free/Pro 用户无需 Team Marketplace，即可把生成的自包含插件安装到官方本地插件目录。"
    - "install/status/update/uninstall 是幂等且所有权安全的，不覆盖未托管目录，也不静默丢弃用户修改。"
    - "默认安装 QA 配置，Reload Window 后暴露一个 kcoderag MCP server、Rule 与 skill。"
    - "仓库 README、生成包 README 与 KCodeRag 权威 QA 指南以免费本地安装为普通用户主路径。"
  artifacts:
    - path: "scripts/manage_cursor_local_install.py"
      provides: "Cursor 本地插件的四命令生命周期管理器"
    - path: "tests/test_cursor_local_install.py"
      provides: "安装所有权、状态、更新、漂移和安全卸载回归合同"
    - path: "../KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md"
      provides: "无需 Cursor Team 的从零接入与更新说明"
  key_links:
    - from: "scripts/manage_cursor_local_install.py"
      to: "kcoderag-cursor/.cursor-plugin/plugin.json"
      via: "复制确定性生成包到 ~/.cursor/plugins/local/kcoderag-nav"
      pattern: "kcoderag-cursor|plugins/local/kcoderag-nav"
    - from: "plugin-src/cursor/README.md.tmpl"
      to: "kcoderag-cursor/README.md"
      via: "scripts/generate_plugins.py --write"
      pattern: "manage_cursor_local_install.py"
---

<objective>
为不购买 Cursor Team 的用户提供可靠的免费本地插件安装路径：从当前仓库的生成包复制到 Cursor 官方本地插件目录，并提供安全的 install/status/update/uninstall；同步更新生成文档和 KCodeRag 权威 QA 指南。
</objective>

<context>
@AGENTS.md
@.planning/STATE.md
@README.md
@scripts/manage_project_install.py
@plugin-src/cursor/README.md.tmpl
@kcoderag-cursor/.cursor-plugin/plugin.json
@../KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: RED→GREEN 实现 Cursor 本地安装生命周期</name>
  <files>tests/test_cursor_local_install.py, scripts/manage_cursor_local_install.py</files>
  <action>先写失败合同，覆盖默认目录、首次安装、幂等、status、source update、托管内容漂移、未托管目录、路径逃逸与卸载；再实现仅依赖标准库的 CLI。状态只输出路径与原因码，不打印 MCP URL、Bearer 或文件内容。删除前解析并校验目标严格位于 ~/.cursor/plugins/local/kcoderag-nav。</action>
  <verify>python -m unittest tests.test_cursor_local_install -v</verify>
  <done>四个命令在 Windows/POSIX 路径模型下可测试运行，更新只覆盖未漂移的管理安装，卸载只删除精确所有者目录。</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: 把免费本地路径设为 Cursor 主文档流程</name>
  <files>tests/test_generation.py, tests/test_pre_commit_generate.py, README.md, AGENTS.md, .planning/PROJECT.md, plugin-src/cursor/README.md.tmpl, kcoderag-cursor/README.md, kcoderag-cursor/.cursor-plugin/plugin.json, .cursor-plugin/marketplace.json, kcoderag-qa/hooks/__pycache__/grep_nudge.cpython-314.pyc, kcoderag-dev/hooks/__pycache__/grep_nudge.cpython-314.pyc, ../KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md</files>
  <action>先更新文档合同使旧 Team-only 文案失败；再把 clone、install、status、update、uninstall、Developer: Reload Window、Python 3.10+ 与 QA 默认写入根 README、生成模板/生成包及 KCodeRag 唯一权威指南。Team Marketplace 只保留为付费可选项，不再是必需路径。同步项目约束，删除被 .gitignore 排除但历史误提交、会在测试后污染生成门禁的两份 pyc。运行生成器刷新 Cursor 内容哈希版本，不触发 QA/Dev 版本变化。</action>
  <verify>python scripts/generate_plugins.py --write &amp;&amp; python -m unittest tests.test_generation tests.test_cursor_local_install -v</verify>
  <done>免费用户按复制式本地插件流程可从零安装和升级，所有生成产物与模板一致，权威指南不新增凭据值。</done>
</task>

<task type="auto">
  <name>Task 3: 全量验证并记录 quick 交付</name>
  <files>.planning/quick/260821-flg-add-a-free-cursor-local-plugin-installer/260821-flg-SUMMARY.md, .planning/STATE.md</files>
  <action>运行生成检查、全量 unittest、原生 pre-commit 和 diff check；验证临时 HOME 安装往返；确认 KCodeRag 只修改权威指南且不暂存；写 SUMMARY、更新 STATE 并提交 kcoderag-nav 变更。不自动 push，也不提交 KCodeRag 脏工作树。</action>
  <verify>python scripts/generate_plugins.py --check &amp;&amp; python -m unittest discover -s tests -p "test_*.py" -v &amp;&amp; git hook run pre-commit &amp;&amp; git diff --check</verify>
  <done>全部离线门禁通过，nav 的 GSD 记录完整，KCodeRag 权威指南保留为单一未暂存修改。</done>
</task>

</tasks>
