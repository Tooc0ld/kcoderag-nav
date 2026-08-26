---
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/core/contracts.cts
  - src/core/state.cts
  - src/hooks/mcp-call-marker.cts
  - src/hosts/opencode.cts
  - src/hosts/index.cts
  - src/hosts/codex.cts
  - src/hosts/claude.cts
  - src/hosts/cursor.cts
  - src/generator/index.cts
  - src/bin/kcoderag-nav.cts
  - src/cli/commands.cts
  - plugin-src/hooks/hooks.json
  - plugin-src/hooks/run_marker.cmd
  - plugin-src/hooks/run_marker.sh
  - plugin-src/opencode/plugin.js
  - package.json
  - tests/
  - D:/AIProgram/KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md
autonomous: true
requirements:
  - OPENCODE-HOST-01
  - MCP-CALL-MARKER-01
estimate:
  tasks: 3
  confidence: medium
---

<objective>
Add project-only OpenCode lifecycle support to the npm CLI and install a bounded, fail-open, secret-free KCodeRag MCP call marker for Codex, Claude Code, Cursor, and OpenCode.
</objective>

<context>
@AGENTS.md
@package.json
@src/hosts/host-adapter.cts
@src/hooks/grep-nudge.cts
@D:/AIProgram/KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add the OpenCode project adapter</name>
  <files>src/core/, src/hosts/opencode.cts, src/hosts/index.cts, src/bin/kcoderag-nav.cts, src/cli/commands.cts, tests/hosts/</files>
  <action>Support install, update, uninstall, status, and doctor for OpenCode using project-native MCP, skill, and plugin files. Preserve unrelated configuration, reject ambiguous or unsafe ownership before writes, and keep the public product QA-only and project-only.</action>
  <verify>npm run build &amp;&amp; node --test dist-tests/hosts/opencode.test.cjs dist-tests/hosts/cross-host.test.cjs dist-tests/cli/commands.test.cjs</verify>
  <done>OpenCode is a selectable host and its complete lifecycle is transactionally managed without touching user-global configuration.</done>
</task>

<task type="auto">
  <name>Task 2: Record KCodeRag MCP calls on all four hosts</name>
  <files>src/hooks/mcp-call-marker.cts, src/hosts/, plugin-src/hooks/, plugin-src/opencode/, tests/hooks/, tests/hosts/</files>
  <action>Add a shared marker runtime that recognizes only KCodeRag QA MCP calls, hashes session and turn identities, writes bounded local cache metadata atomically, stores no tool arguments/results/credentials, and fails open. Wire it through PostToolUse for Codex and Claude Code, afterMCPExecution for Cursor, and tool.execute.after for OpenCode.</action>
  <verify>npm run build &amp;&amp; node --test dist-tests/hooks/mcp-call-marker.test.cjs dist-tests/hooks/launcher.test.cjs dist-tests/hosts/*.test.cjs</verify>
  <done>Each host records successful KCodeRag tool execution with host-native events while preserving existing advisory behavior.</done>
</task>

<task type="auto">
  <name>Task 3: Generate, document, and verify the package</name>
  <files>src/generator/, package.json, generated products, tests/generator/, tests/smoke/, D:/AIProgram/KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md</files>
  <action>Include OpenCode and the marker runtime in deterministic npm assets, extend smoke/pack/CI contracts, and update the sibling authoritative guide with exact OpenCode commands and honest host-event differences.</action>
  <verify>npm run ci:local &amp;&amp; git diff --check</verify>
  <done>The packed artifact contains all four host paths, tests pass on the repository gates, and the authoritative guide matches the implementation.</done>
</task>

</tasks>
