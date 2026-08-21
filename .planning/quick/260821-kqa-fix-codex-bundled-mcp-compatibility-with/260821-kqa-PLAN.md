---
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/generate_plugins.py
  - scripts/manage_project_install.py
  - tests/test_generation.py
  - tests/test_project_install.py
  - tests/test_pre_commit_generate.py
  - README.md
  - plugin-src/version.txt
  - kcoderag-update.json
  - kcoderag-qa/
  - kcoderag-dev/
  - kcoderag-cursor/
  - .agents/plugins/marketplace.json
  - .claude-plugin/marketplace.json
  - .cursor-plugin/marketplace.json
  - D:/AIProgram/KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md
autonomous: true
requirements:
  - CODEX-MCP-COMPAT-01
  - INSTALL-SOURCE-OWNERSHIP-01
  - RELEASE-VERSION-01
estimate:
  tokens: 9000
  raw_tokens: 9000
  tasks: 3
  confidence: high
must_haves:
  truths:
    - "Codex 专用 .codex.mcp.json 使用官方支持的 direct server map，Claude 根 .mcp.json 保持 mcpServers 包装格式。"
    - "项目安装与更新在同宿主存在用户级同环境 MCP/plugin 或相反环境时写入前硬停止；同一安装器拥有的同环境重复安装仍然幂等。"
    - "status 只读报告重复来源或环境冲突；uninstall 仍可清理当前安装器拥有的项目文件。"
    - "基础 SemVer 升级到 0.1.4，QA、Dev、Cursor 与更新元数据由生成器确定性刷新。"
    - "权威 QA 指南说明 direct-map 兼容边界、冲突处理和新任务重载要求，但 KCodeRag 的无关脏改动不被提交或推送。"
    - "完整本地门禁与 required GitHub Actions 通过后，kcoderag-nav origin/master 与本地 HEAD 一致。"
  artifacts:
    - path: "scripts/generate_plugins.py"
      provides: "Codex direct-map 生成契约"
    - path: "scripts/manage_project_install.py"
      provides: "用户级 Codex 来源只读探测、硬停止与 status 诊断"
    - path: "plugin-src/version.txt"
      provides: "0.1.4 规范基础版本"
    - path: "D:/AIProgram/KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md"
      provides: "唯一权威的安装与兼容体验说明"
  key_links:
    - from: "scripts/generate_plugins.py"
      to: "kcoderag-qa/.codex.mcp.json"
      via: "scripts/generate_plugins.py --write"
      pattern: "kcoderag-qa"
    - from: "scripts/manage_project_install.py"
      to: "CODEX_HOME/config.toml"
      via: "只读 section 扫描，不解析或输出凭据值"
      pattern: "duplicate_same_environment|environment_conflict"
    - from: "plugin-src/version.txt"
      to: "kcoderag-update.json"
      via: "确定性生成器"
      pattern: "0.1.4\\+codex"
---

<objective>
修复 Codex 0.144.4 对插件内嵌 wrapped MCP 的兼容问题，防止项目安装与用户级 Codex MCP/plugin 来源重复掩盖故障；发布 0.1.4 并同步唯一权威 QA 指南。nav 仓库提交并推送，KCodeRag 只增量更新指南且不混入其大量无关本地工作。
</objective>

<context>
@AGENTS.md
@.planning/STATE.md
@scripts/generate_plugins.py
@scripts/manage_project_install.py
@tests/test_generation.py
@tests/test_project_install.py
@D:/AIProgram/KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Codex bundled MCP 改用 direct server map</name>
  <files>scripts/generate_plugins.py, tests/test_generation.py, kcoderag-qa/.codex.mcp.json, kcoderag-dev/.codex.mcp.json</files>
  <action>先把生成回归改为锁定顶层只能是对应的 kcoderag-qa 或 kcoderag-dev server 名并观察 RED；再让 _codex_mcp_document 返回 direct map。保持 Codex 字段 url/http_headers，根 .mcp.json 与 Claude 生成字节完全不变。运行生成器同步 QA/Dev 和所有内容哈希产物。</action>
  <verify>python -m unittest tests.test_generation -q &amp;&amp; python scripts/generate_plugins.py --check</verify>
  <done>QA/Dev Codex 文件均无 mcp_servers 包装，Claude 文件未改变结构，生成器无漂移。</done>
</task>

<task type="auto">
  <name>Task 2: 项目安装器硬停止同宿主重复来源</name>
  <files>scripts/manage_project_install.py, tests/test_project_install.py, README.md</files>
  <action>以 CODEX_HOME/config.toml 或默认 ~/.codex/config.toml 为只读来源，只扫描 kcoderag QA/Dev 的 mcp_servers section 和启用的 marketplace plugin section，不读取或输出字段值。新增 RED 覆盖：同环境用户 MCP、同环境启用 plugin、相反环境、禁用 plugin、同 owner 幂等、update 拒绝、status 诊断、uninstall 可清理、目标树与用户配置零写入。GREEN 时在 install/update 事务前执行检查；同环境返回 duplicate_same_environment，相反环境或 QA/Dev 并存返回 environment_conflict。README 说明 native plugin add 绕过项目安装器，status 可事后诊断。</action>
  <verify>python -m unittest tests.test_project_install tests.test_pre_commit_generate -q</verify>
  <done>重复来源和环境冲突都在任何项目写入前硬停止；幂等与卸载边界保持。</done>
</task>

<task type="auto">
  <name>Task 3: 发布 0.1.4、同步权威指南并交付</name>
  <files>plugin-src/version.txt, kcoderag-update.json, kcoderag-qa/, kcoderag-dev/, kcoderag-cursor/, .agents/plugins/marketplace.json, .claude-plugin/marketplace.json, .cursor-plugin/marketplace.json, D:/AIProgram/KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md, .planning/STATE.md</files>
  <action>把基础版本显式升级为 0.1.4 并重新生成全部自包含产物。增量更新 KCodeRag 权威指南，说明 Codex direct-map 兼容修复、项目安装器冲突错误及清理方法、更新后必须新开任务；不得覆盖其既有未提交改动，也不得提交或推送 KCodeRag。运行全套离线门禁、credential-safe 检查与 pre-commit，原子提交 nav 代码/发布/GSD 记录，普通 push origin master 并等待 required CI；optional host smoke 未运行必须如实记录。</action>
  <verify>python scripts/generate_plugins.py --check &amp;&amp; python -m unittest discover -s tests -p "test_*.py" -q &amp;&amp; python kcoderag-qa/hooks/test_grep_nudge.py &amp;&amp; python kcoderag-dev/hooks/test_grep_nudge.py &amp;&amp; git hook run pre-commit &amp;&amp; git diff --check &amp;&amp; git push origin master</verify>
  <done>0.1.4 发布产物和权威指南同步完成，本地门禁与 required CI 通过，nav 与 origin/master 一致，KCodeRag 无关工作保持原状。</done>
</task>

</tasks>
