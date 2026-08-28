---
phase: quick
plan: 01
type: tdd
wave: 1
depends_on: []
files_modified:
  - plugin-src/hooks/grep_nudge.py
  - scripts/generate_plugins.py
  - tests/test_generation.py
  - tests/test_routing_and_hooks.py
  - kcoderag-qa/hooks/grep_nudge.py
  - kcoderag-dev/hooks/grep_nudge.py
autonomous: true
requirements:
  - HOOK-SCOPE-01
  - HOOK-NUDGE-01
  - DIST-PARITY-01
estimate:
  tokens: 22000
  raw_tokens: 22000
  tasks: 3
  confidence: low
must_haves:
  truths:
    - "管道或复合命令后续 token 不再把已限定到一个源码文件的 rg/grep 搜索误判成仓库级结构检索。"
    - "解析器只把未引用且未转义的 shell 控制符当作分隔符；引用/转义后的同字符仍属于搜索参数，后续命令段中的真实结构搜索仍可触发 nudge。"
    - "hook 始终只返回 advisory additionalContext 或静默放行；任何新解析异常、超限输入或异常分段都 fail-open，不 deny/block 原工具。"
    - "生成包中的完整 NUDGE 不超过 320 个字符，同时保留 search_code/context/get_call_chain、本地精确文本用途、双装 QA 默认、显式 Dev/compare 与不可静默回退语义。"
    - "所有行为只在 plugin-src 规范源和生成器中实现，再生成 QA/Dev 自包含产物；generate --check 与两环境回归均通过。"
  artifacts:
    - path: "plugin-src/hooks/grep_nudge.py"
      provides: "quote/escape-aware 的复合命令分段、逐段 scope 分类与精简后的 host-neutral nudge 主体"
    - path: "tests/test_routing_and_hooks.py"
      provides: "QA/Dev 生成 hook 的管道/复合命令 observable regressions"
    - path: "scripts/generate_plugins.py"
      provides: "从 routing.json 派生的紧凑双环境路由提示"
    - path: "tests/test_generation.py"
      provides: "nudge 字符预算和保留语义合同"
    - path: "kcoderag-qa/hooks/grep_nudge.py"
      provides: "由规范源生成的 QA hook"
    - path: "kcoderag-dev/hooks/grep_nudge.py"
      provides: "由规范源生成的 Dev hook"
  key_links:
    - from: "tests/test_routing_and_hooks.py"
      to: "kcoderag-qa/hooks/grep_nudge.py and kcoderag-dev/hooks/grep_nudge.py"
      via: "同一命令对两个独立生成包执行 shell_lookup_patterns/hook_output 行为断言"
      pattern: "shell_lookup_patterns|hook_output"
    - from: "plugin-src/hooks/grep_nudge.py"
      to: "shell_lookup_patterns"
      via: "先按 quote/escape-aware 控制符切成 simple-command segments，再复用现有 option/pattern/scope 分类"
      pattern: "shell_lookup_patterns"
    - from: "scripts/generate_plugins.py"
      to: "kcoderag-qa/hooks/grep_nudge.py and kcoderag-dev/hooks/grep_nudge.py"
      via: "render_routing_nudge 填充 routing_nudge 模板，generate --write 同步两个包"
      pattern: "render_routing_nudge|routing_nudge"
---

<objective>
修复 shell 管道与复合命令让后续 token 扩大搜索 scope 的误判，补齐双环境生成 hook 的回归覆盖，并把高频 nudge 从当前实测 506 字符适度压缩到不超过 320 字符。

Purpose: 保持图优先提示的准确性与低打扰特性，同时不改变 advisory、fail-open、QA 优先和独立生成包边界。

Output: 规范源 parser 与 nudge、生成器路由短句、QA/Dev 同步产物，以及可重复的 RED→GREEN 回归证据。
</objective>

<execution_context>
@gsd-core/workflows/execute-plan.md
@gsd-core/templates/summary.md
@gsd-core/references/tdd.md
</execution_context>

<context>
@AGENTS.md
@.planning/STATE.md
@.agents/skills/kcoderag-nav/SKILL.md
@plugin-src/hooks/grep_nudge.py
@scripts/generate_plugins.py
@tests/test_generation.py
@tests/test_routing_and_hooks.py

<interfaces>
Use the existing public behavior seams rather than introducing a shell-parser dependency:
- plugin-src/hooks/grep_nudge.py: shell_lookup_patterns(command: str) -> list[str]
- plugin-src/hooks/grep_nudge.py: hook_output(data: Mapping[str, Any]) -> dict[str, Any] | None
- scripts/generate_plugins.py: render_routing_nudge(routing: dict[str, Any]) -> str
- scripts/generate_plugins.py: render_outputs(inputs: CanonicalInputs) -> dict[str, bytes]
- scripts/generate_plugins.py CLI: --write renders both package trees; --check is read-only drift validation
</interfaces>
</context>

<source_coverage>

| Source | Item | Task | Status | Notes |
|---|---|---:|---|---|
| GOAL | 修复管道/复合命令的 single-file scope 误判 | 1, 3 | COVERED | 首个 QA/Dev observable regression 必须先 RED，再修 parser；不同控制符语义后补 |
| GOAL | 补回归测试 | 1, 3 | COVERED | 生成包行为级测试，不只测私有 scanner |
| GOAL | 适度缩短 nudge | 2 | COVERED | 以实测 506 字符为基线，完整生成文本上限 320 字符且保留策略语义 |
| REQ | Roadmap 未给本 quick 分配 requirement IDs | — | N/A | frontmatter 使用 quick-specific contract IDs |
| RESEARCH | 明确不执行 research phase | — | N/A | 沿用标准库和现有生成链，无新依赖/外部 API |
| CONTEXT | 用户要求 parser 修复、测试和 nudge 精简 | 1, 2, 3 | COVERED | 无 CONTEXT.md / D-XX；本计划不加入 enforce、计数器或静音开关 |

本 quick 不修改 tracked MCP 配置内容、不读取或输出其中的 endpoint/header/Bearer，不改变路由表，不新增阻断式 hook 行为，也不把 QA/Dev 生成树当作独立规范源手工维护。
</source_coverage>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: RED→GREEN 打通 single-file pipeline scope 修复到 QA/Dev 生成 hook</name>
  <files>tests/test_routing_and_hooks.py, plugin-src/hooks/grep_nudge.py, kcoderag-qa/hooks/grep_nudge.py, kcoderag-dev/hooks/grep_nudge.py</files>
  <behavior>
    - RED: 对两个生成 hook，`rg KPlayer one.cpp | head -1` 的 shell_lookup_patterns 当前返回结构 pattern；新回归要求返回空列表，hook_output 对该 Bash payload 返回 None。
    - GREEN: `rg KPlayer src | head -1` 仍产生 KPlayer pattern/nudge，因为它不是单文件本地范围；修复不能通过遇到管道就全部放弃提取。
    - INVARIANT: malformed/oversized command、scanner 异常和不受支持命令保持静默 fail-open；PreToolUse 输出不出现 permissionDecision 或阻断语义。
  </behavior>
  <action>
先在 tests/test_routing_and_hooks.py 新建 HookCommandParsingTests，动态加载 HOOKS 中的 QA/Dev 生成脚本；只添加第一个 observable pipeline regression，并运行指定测试确认它因现有 scope 被管道后 token 扩大而失败，不得以 import/syntax error 充当 RED。提交 `test(260820-umj): expose pipeline scope regression` 后再改生产代码。

GREEN 阶段只修改 plugin-src/hooks/grep_nudge.py 的规范实现：把现有单条命令 option/pattern/scope 提取整理为内部 simple-command helper；在 shell_lookup_patterns 入口增加一次线性扫描，识别未引用、未转义的 `|`/`||`、`&amp;&amp;`、`;` 和 CR/LF 边界，并对各 simple-command segment 复用原有 SEARCH_TOOLS、wrapper、option value、glob 和 _is_local_only_scope 规则。单引号、双引号以及 POSIX backslash、cmd caret、PowerShell backtick 转义后的控制字符不得切段。逐段分析必须忽略 downstream 非搜索命令，但继续检查 later search segment，不能只取整串的第一个 token，也不能遇到任一控制符就返回空。保留 MAX_COMMAND_CHARS 前置限制，并给分段数量设置固定上界；超限或解析状态异常返回空列表。

运行 `python scripts/generate_plugins.py --write` 从规范源同步两包，禁止直接编辑 kcoderag-qa/kcoderag-dev hook。执行 targeted test 确认 RED 变 GREEN，再提交 `feat(260820-umj): preserve search scope across pipelines`。不要改动 `.mcp.json` 或打印其内容。
  </action>
  <verify>
    <automated>python -m unittest tests.test_routing_and_hooks.HookCommandParsingTests.test_pipeline_preserves_single_file_scope -v</automated>
  </verify>
  <done>首个 pipeline regression 有可核对的 RED 输出和后续 GREEN 输出；两个生成包对单文件管道静默、对仓库范围管道继续提示，hook 仍 advisory/fail-open。</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: 用字符预算与语义合同精简高频 nudge</name>
  <files>tests/test_generation.py, plugin-src/hooks/grep_nudge.py, scripts/generate_plugins.py, kcoderag-qa/hooks/grep_nudge.py, kcoderag-dev/hooks/grep_nudge.py</files>
  <behavior>
    - RED: test_nudge_is_compact_and_policy_complete 动态加载两个生成 hook，要求完整 NUDGE 长度不超过 320 字符；当前实测 506 字符必须因长度断言失败。
    - Text contract: 完整提示保留 search_code、context、get_call_chain，并明确本地文本搜索用于 exact strings/uncommitted edits。
    - Routing contract: 只有 QA+Dev 双装场景声明 QA default；explicit Dev 只走 Dev、explicit comparison 查两者、selected environment unavailable 时不 fallback。
    - Host contract: 文本不包含环境限定 MCP tool prefix，不把 Dev-only 安装误导为 QA 默认，也不增加 deny/enforce 文案。
  </behavior>
  <action>
先在 tests/test_generation.py 添加 test_nudge_is_compact_and_policy_complete，加载两个 tracked generated hooks 并断言字符上限、三个工具名、local-text 例外、双装限定和无静默回退语义；同时直接调用 render_routing_nudge，确保短路由文本仍由 routing.json 的 required rows 校验后生成。运行该测试并保存因现有 506 字符超限产生的 RED，提交 `test(260820-umj): define compact nudge contract`。

GREEN 阶段压缩 plugin-src/hooks/grep_nudge.py 的 NUDGE 主体为直接、host-neutral 的命令式提示，删除重复解释但保留结构检索工具选择和精确文本/未提交改动例外；压缩 scripts/generate_plugins.py 的 render_routing_nudge 为一条仅针对双装的路由短句，继续先用 resolve_route 验证 default/dev/compare 三条 locked routing rows。这里的 320 字符是完整生成文本上限，不是 additionalContextLimit，也不得通过删除不可回退或双装限定来过线。执行 generator `--write` 同步 QA/Dev，targeted test 变 GREEN 后提交 `feat(260820-umj): shorten graph lookup nudge`。
  </action>
  <verify>
    <automated>python -m unittest tests.test_generation.GenerationTests.test_nudge_is_compact_and_policy_complete -v</automated>
  </verify>
  <done>QA/Dev 完整 nudge 均不超过 320 字符且策略信息完整；测试先以旧 506 字符失败，再随规范源和生成器修改通过。</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: 扩展 materially distinct compound-command 边界并锁定生成一致性</name>
  <files>tests/test_routing_and_hooks.py, plugin-src/hooks/grep_nudge.py, kcoderag-qa/hooks/grep_nudge.py, kcoderag-dev/hooks/grep_nudge.py</files>
  <behavior>
    - Compound separators: 单文件搜索后接 `&amp;&amp;` 或 `;` 的非搜索命令保持静默，CR/LF 后的非搜索命令也不扩大 scope。
    - Later segment: 前一段为非搜索命令、后一段为仓库范围 rg/grep 时仍触发 nudge。
    - Quoting/escaping: 引号内 regex alternation、escaped pipe/semicolon 不被切成 shell segment，结构 pattern 仍按原启发式分类。
    - Wrapper recursion: cmd/pwsh 包装的单文件管道保留 silent scope，包装的仓库范围搜索仍触发。
    - Compatibility: 既有 option-value、`--files -g`、日志目录、单文件、Claude pattern、dedup 和 oversized-input 回归全部保持通过。
  </behavior>
  <action>
在 HookCommandParsingTests 中按行为维度逐个增加用例，而不是为同一分隔符堆叠等价字符串：覆盖 compound separator、later search segment、quoted/escaped control character、nested wrapper 和 multiline 五类。每加一类就运行该类测试；若 Task 1 的通用 scanner 已满足，记录为 GREEN characterization，不为制造 RED 改坏实现；若出现真实失败，保留该失败证据，再对 plugin-src/hooks/grep_nudge.py 做最小范围修正并通过 generator `--write` 同步两个包。所有修正继续使用同一个 scanner/simple-command seam，不引入平台 shell、subprocess 或第三方 parser。

最后运行两包行为回归、generation drift check 和根测试套件。确认生成差异只来自 plugin-src/hooks/grep_nudge.py 与 render_routing_nudge；generated hook 必须由 generator 写入，两个环境 parser 行为和 nudge 文本除模板路由结果外保持一致。按 TDD 记录把新增 distinct edge tests 和必要修正提交为测试/实现提交；若全部由 Task 1 的 GREEN 直接覆盖，则只提交测试扩展，不制造空实现提交。
  </action>
  <verify>
    <automated>python scripts/generate_plugins.py --check &amp;&amp; python kcoderag-qa/hooks/test_grep_nudge.py &amp;&amp; python kcoderag-dev/hooks/test_grep_nudge.py &amp;&amp; python -m unittest discover -s tests -p "test_*.py" -v &amp;&amp; git diff --check</automated>
  </verify>
  <done>五类不同边界均有 QA/Dev 行为级回归；所有既有 hook、routing、generation、install/host tests 继续通过，生成树无 drift。</done>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary | Description |
|---|---|
| Host Bash payload → shell parser | command 是不可信宿主输入，可能含异常引号、转义、大量控制符或超长文本；parser 必须有界且 fail-open。 |
| Parser classification → PreToolUse output | 误判只能产生 advisory context，不能提升为拒绝、rewrite 或 shell 执行。 |
| Canonical source → generated QA/Dev packages | 生成链必须同步两个独立包，且不得把敏感 MCP 配置内容带入测试/诊断。 |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|---|---|---|---|---|---|
| T-quick-01 | Denial of Service | compound-command scanner | medium | mitigate | 保留 MAX_COMMAND_CHARS，使用单次线性扫描和固定 segment 上界；异常/超限返回空，回归继续验证 250ms 有界分类。 |
| T-quick-02 | Tampering | quote/escape boundary classification | medium | mitigate | 只分割未引用且未转义的控制符；QA/Dev 行为测试覆盖 quoted、escaped、wrapper 与 multiline 入口。 |
| T-quick-03 | Elevation of Privilege | PreToolUse response | medium | mitigate | hook_output 继续只产生 additionalContext 或 None；全套回归验证原搜索不被 deny/block。 |
| T-quick-04 | Information Disclosure | generator/test diagnostics | low | accept | 本任务不读取 MCP 配置内容，generation 诊断沿用 path-only 行为；变更仅涉及 hook 文本、parser 和无凭据测试。 |
| T-quick-SC | Tampering | npm/pip/cargo installs | high | mitigate | 计划不执行任何 package-manager install，继续仅用 Python 标准库和仓库已有测试工具，files_modified 不含依赖清单或锁文件。 |
</threat_model>

<verification>
1. TDD evidence shows the first generated-package pipeline regression failing for the scope reason before production changes, then passing after canonical fix and regeneration.
2. Compact-nudge contract shows the measured 506-character generated text failing the 320-character bound before text changes, then passing without losing required semantics.
3. `python scripts/generate_plugins.py --check` reports no drift and both standalone generated hook regressions pass.
4. `python -m unittest discover -s tests -p "test_*.py" -v` and `git diff --check` pass without reading or exposing MCP configuration values.
</verification>

<success_criteria>
- `rg KPlayer one.cpp | head -1` and equivalent local compound forms are silent in both generated environments.
- Repository-wide structural searches in the first or later command segment still trigger the nudge.
- Quoted/escaped control characters retain their argument meaning, while real shell separators isolate scope.
- QA/Dev generated NUDGE text is at most 320 characters and preserves all required routing/tool/local-search semantics.
- Canonical source is the only hand-edited hook source; generated outputs are synchronized and the complete automated suite is green.
- TDD SUMMARY records RED/GREEN evidence and commits in execution order.
</success_criteria>

<output>
Create `.planning/quick/260820-umj-scope-nudge/260820-umj-SUMMARY.md` when done.
</output>
