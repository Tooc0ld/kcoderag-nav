---
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - README.md
  - plugin-src/version.txt
  - plugin-src/environments.json
  - plugin-src/environments/qa.mcp.json
  - plugin-src/environments/dev.mcp.json
  - plugin-src/routing.json
  - plugin-src/hooks/grep_nudge.py
  - plugin-src/hooks/hooks.json
  - plugin-src/hooks/test_grep_nudge.py
  - plugin-src/skills/code-lookup-discipline/SKILL.md
  - plugin-src/agents/kcode-explorer.md.tmpl
  - plugin-src/README.md.tmpl
  - scripts/generate_plugins.py
  - scripts/manage_project_install.py
  - tests/test_generation.py
  - tests/test_project_install.py
  - tests/test_routing_and_hooks.py
  - .claude-plugin/marketplace.json
  - kcoderag-qa/.codex-plugin/plugin.json
  - kcoderag-qa/.mcp.json
  - kcoderag-qa/settings.json
  - kcoderag-qa/README.md
  - kcoderag-qa/hooks/grep_nudge.py
  - kcoderag-qa/hooks/hooks.json
  - kcoderag-qa/hooks/test_grep_nudge.py
  - kcoderag-qa/skills/code-lookup-discipline/SKILL.md
  - kcoderag-qa/agents/kcode-explorer.md
  - kcoderag-dev/.codex-plugin/plugin.json
  - kcoderag-dev/.mcp.json
  - kcoderag-dev/settings.json
  - kcoderag-dev/README.md
  - kcoderag-dev/hooks/grep_nudge.py
  - kcoderag-dev/hooks/hooks.json
  - kcoderag-dev/hooks/test_grep_nudge.py
  - kcoderag-dev/skills/code-lookup-discipline/SKILL.md
  - kcoderag-dev/agents/kcode-explorer.md
autonomous: true
requirements:
  - PKG-01
  - PKG-02
  - PKG-03
  - PKG-04
  - PKG-05
  - PKG-06
  - ROUT-01
  - ROUT-02
  - ROUT-03
  - ROUT-04
  - HOOK-01
  - HOOK-02
  - HOOK-03
  - HOOK-04
  - HOOK-05
  - GEN-01
  - GEN-02
  - GEN-03
  - GEN-04
  - GEN-05
  - TEST-01
  - TEST-02
  - TEST-03
  - TEST-04
  - TEST-05
  - TEST-06
estimate:
  tokens: 60000
  raw_tokens: 60000
  tasks: 3
  confidence: low
must_haves:
  truths:
    - "维护者只改一份共享 hook、skill、agent/template 与共享测试规范源，就能确定性生成 QA、Dev 两个无父目录依赖、无符号链接的自包含插件包。"
    - "普通用户不带环境参数执行项目安装时只安装 QA；Dev 与 QA+Dev 必须显式选择，且任一环境都能单独安装、运行和卸载。"
    - "项目安装与卸载只改变目标仓库中安装器拥有的 .codex/ 与 .agents/ 内容，保留另一个环境、用户级 Codex 配置/缓存和所有无关项目文件。"
    - "QA+Dev 同时可用时默认查询 QA，显式 Dev 只查 Dev，显式比较才查两者；选中环境不可达时明确报告且不切换环境。"
    - "Codex 并发启动 QA 与 Dev 的匹配 hook 时，同一工具调用至多输出一次导航提示；解析、标识、原子去重或输入异常都以退出码 0 静默放行原工具。"
    - "现有 working tree 中已修复的 hook parser、两份 Codex manifest 和每环境 MCP/Bearer/权限字段被迁入规范源并由回归测试保护，不从 HEAD 或旧副本还原。"
    - "只读 generation check、重复生成哈希、插件结构检查以及 QA-only、Dev-only、dual、独立卸载、路由和并发 hook E2E 均可离线执行。"
  artifacts:
    - path: "plugin-src/hooks/grep_nudge.py"
      provides: "共享、跨宿主、跨进程去重且 fail-open 的 hook 规范实现"
    - path: "plugin-src/skills/code-lookup-discipline/SKILL.md"
      provides: "单环境和双环境一致的 QA 优先路由规范"
    - path: "plugin-src/environments.json"
      provides: "QA/Dev 名称、命名空间、展示字段和环境输入映射"
    - path: "scripts/generate_plugins.py"
      provides: "确定性 write/check 生成器与产物漂移检测"
    - path: "scripts/manage_project_install.py"
      provides: "默认 QA、显式 Dev/both、按环境卸载的项目级兼容安装器"
    - path: "tests/test_generation.py"
      provides: "双环境自包含、manifest/path/secret-presence 与生成重复性检查"
    - path: "tests/test_project_install.py"
      provides: "项目安装、独立卸载、幂等与所有权边界 E2E"
    - path: "tests/test_routing_and_hooks.py"
      provides: "路由矩阵、parser 保留、跨进程 hook 去重和 fail-open E2E"
    - path: "kcoderag-qa/.codex-plugin/plugin.json"
      provides: "可独立安装的 QA Codex 插件 manifest"
    - path: "kcoderag-dev/.codex-plugin/plugin.json"
      provides: "可独立安装的 Dev Codex 插件 manifest"
  key_links:
    - from: "plugin-src/"
      to: "kcoderag-qa/ and kcoderag-dev/"
      via: "scripts/generate_plugins.py renders every tracked distribution file from explicit canonical inputs"
      pattern: "generate_plugins"
    - from: "scripts/manage_project_install.py"
      to: "<target>/.codex/config.toml, <target>/.codex/hooks.json, <target>/.agents/skills/kcoderag-nav/SKILL.md"
      via: "managed blocks/handlers plus an ownership-and-digest state file under <target>/.codex/kcoderag-nav/"
      pattern: "install|uninstall"
    - from: "plugin-src/routing.json"
      to: "generated SKILL.md and project-installed SKILL.md"
      via: "one routing matrix renders the QA-default, Dev-only, compare, and no-fallback instructions"
      pattern: "qa|dev|compare"
    - from: "PreToolUse identity"
      to: "OS temporary dedup marker"
      via: "SHA-256 key and atomic O_CREAT|O_EXCL ownership across QA/Dev Python processes"
      pattern: "session_id|turn_id|tool_use_id"
    - from: "tests/test_routing_and_hooks.py"
      to: "kcoderag-qa/hooks/grep_nudge.py and kcoderag-dev/hooks/grep_nudge.py"
      via: "simultaneous subprocess invocations with one shared Codex tool-call payload"
      pattern: "subprocess"
---

<objective>
把当前两棵存在未提交修复的 QA/Dev 插件树迁移为“一份规范源、两个确定性自包含产物”，并一次性交付 QA 默认的项目级安装、显式 Dev/双装、独立卸载、QA 优先路由和并发 hook 去重。

Purpose: 消除两份行为源码的维护漂移，同时让普通用户获得不污染用户级 Codex 环境的 QA 项目安装路径，让测试人员仍可安全地单装 Dev 或双装并验证环境路由。

Output: 规范源、确定性生成器、项目级安装器、更新后的 QA/Dev 分发树、默认 QA 文档以及离线 generation/install/routing/hook E2E。
</objective>

<execution_context>
@gsd-core/workflows/execute-plan.md
@gsd-core/templates/summary.md
</execution_context>

<context>
@AGENTS.md
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/codebase/ARCHITECTURE.md
@.planning/codebase/CONCERNS.md
@.claude-plugin/marketplace.json
@kcoderag-qa/.codex-plugin/plugin.json
@kcoderag-dev/.codex-plugin/plugin.json
@kcoderag-qa/hooks/grep_nudge.py
@kcoderag-qa/hooks/test_grep_nudge.py
@kcoderag-qa/hooks/hooks.json
@kcoderag-qa/skills/code-lookup-discipline/SKILL.md
@kcoderag-qa/agents/kcode-explorer.md
@kcoderag-dev/hooks/grep_nudge.py
@kcoderag-dev/hooks/test_grep_nudge.py
@kcoderag-dev/hooks/hooks.json
@kcoderag-dev/skills/code-lookup-discipline/SKILL.md
@kcoderag-dev/agents/kcode-explorer.md
</context>

<source_coverage>

| Source | IDs/items | Task | Status | Notes |
|---|---|---:|---|---|
| GOAL | quick description: 规范源、独立产物、项目安装、独立卸载、路由、去重、E2E | 1-3 | COVERED | 单计划交付完整 quick scope |
| REQ | PKG-01, PKG-03, PKG-04, PKG-05 | 1, 3 | COVERED | QA 默认、自包含、装即用、项目级安装 |
| REQ | PKG-02, PKG-06 | 2, 3 | COVERED | Dev/双装显式选择与按环境卸载 |
| REQ | ROUT-01, ROUT-02, ROUT-03, ROUT-04 | 2, 3 | COVERED | QA 默认、Dev-only、compare、不可达不回退 |
| REQ | HOOK-01, HOOK-03, HOOK-04, HOOK-05 | 1-3 | COVERED | 现有 parser 工作树修复完整迁移并继续 fail-open |
| REQ | HOOK-02 | 2, 3 | COVERED | 同一调用的并发跨进程原子去重 |
| REQ | GEN-01, GEN-02, GEN-03, GEN-04, GEN-05 | 1, 3 | COVERED | 规范源、双产物、环境隔离、只读检查、重复性 |
| REQ | TEST-01, TEST-02 | 1, 3 | COVERED | 共享测试与 manifest/path 校验 |
| REQ | TEST-03, TEST-04, TEST-05, TEST-06 | 2, 3 | COVERED | 安装/卸载、路由、双宿主、用户边界 E2E |
| RESEARCH | 无 quick RESEARCH.md | — | N/A | 仅使用仓库事实与当前官方 Codex project hook/config/skill 契约 |
| CONTEXT | 无 quick CONTEXT.md / D-XX | — | N/A | 本计划直接落实 PROJECT.md 决策和调用方 constraints |

明确排除 v2 SEC-01..03、REL-01..02，以及 REQUIREMENTS.md Out of Scope 中的自动互卸、第三个 core 插件、不可达自动回退、MCP 服务修改、生产凭据治理和“原生 Codex project-scope plugin install”声明。
</source_coverage>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: 从当前 working tree 打通规范源 → 双环境产物 → 默认 QA 项目安装的端到端路径</name>
  <files>plugin-src/version.txt, plugin-src/environments.json, plugin-src/environments/qa.mcp.json, plugin-src/environments/dev.mcp.json, plugin-src/hooks/grep_nudge.py, plugin-src/hooks/hooks.json, plugin-src/hooks/test_grep_nudge.py, plugin-src/skills/code-lookup-discipline/SKILL.md, plugin-src/agents/kcode-explorer.md.tmpl, plugin-src/README.md.tmpl, scripts/generate_plugins.py, scripts/manage_project_install.py, tests/test_generation.py, tests/test_project_install.py, .claude-plugin/marketplace.json, kcoderag-qa/.codex-plugin/plugin.json, kcoderag-qa/.mcp.json, kcoderag-qa/settings.json, kcoderag-qa/README.md, kcoderag-qa/hooks/grep_nudge.py, kcoderag-qa/hooks/hooks.json, kcoderag-qa/hooks/test_grep_nudge.py, kcoderag-qa/skills/code-lookup-discipline/SKILL.md, kcoderag-qa/agents/kcode-explorer.md, kcoderag-dev/.codex-plugin/plugin.json, kcoderag-dev/.mcp.json, kcoderag-dev/settings.json, kcoderag-dev/README.md, kcoderag-dev/hooks/grep_nudge.py, kcoderag-dev/hooks/hooks.json, kcoderag-dev/hooks/test_grep_nudge.py, kcoderag-dev/skills/code-lookup-discipline/SKILL.md, kcoderag-dev/agents/kcode-explorer.md</files>
  <read_first>在改动前读取并以当前 working tree（不是 HEAD）为迁移权威：两份 grep_nudge.py/test_grep_nudge.py、两份 .codex-plugin/plugin.json、两份 .mcp.json、settings.json、hooks.json、SKILL.md、agent、README 和 marketplace。MCP 文件允许读取以迁移，但 Bearer、完整 header 和 endpoint 不得出现在日志、异常、快照名或测试输出。</read_first>
  <behavior>
    - Test 1: 未带环境参数的临时项目安装只得到 QA MCP、QA hook 和一个项目 skill；卸载 QA 后回到安装前字节状态。
    - Test 2: 规范源生成的 QA 与 Dev 目录各自包含完整 manifest、MCP、permission、hook、skill、agent、README，所有引用都留在自身目录且不存在符号链接。
    - Test 3: 两份生成 hook 继续通过当前 53/53 parser 回归，包括 attached -e/-g、findstr /C:、--、positional Get-ChildItem、PowerShell/cmd wrapper、单文件/日志抑制、输入长度和恶意 substitution 时限。
    - Test 4: 生成器不读取当前时间；相同 version、metadata、MCP 和模板输入连续生成的相对路径、内容字节及顺序一致。
    - Test 5: --check 只比较临时渲染与 tracked outputs；检测漂移时返回非零并列出路径，不写任何文件，也不输出敏感字段内容。
  </behavior>
  <action>
先运行两份现有 hook 回归脚本并记录其 53/53 基线，然后把当前 working tree 中完全相同的 parser 和测试复制为唯一共享规范源；严禁从 Git 基线恢复文件或丢掉现有未提交 parser/Codex manifest 修复。将环境不变量放入共享 hook/hooks/skill/template，将 QA/Dev 名称、展示字段、MCP source、permission namespace、agent tool prefix 和显式 version 输入放入环境 metadata；version 必须来自 version.txt，生成器不得读取 wall clock。环境 MCP 规范源要保留当前工作树中的地址与内置 Bearer，但任何检查、diff 摘要或异常只能报告文件路径/字段名，不能打印值。

实现仅依赖 Python 标准库的 generate_plugins.py：`--write` 以规范化 JSON、固定 UTF-8/LF、稳定 key/order 和原子替换生成 marketplace 与两个完整插件树；`--check` 渲染到临时位置或内存后逐路径/逐字节比较，发现缺失、额外或漂移文件时非零退出但不落盘。产物不得使用父目录 import、运行时共享文件或 symlink；QA 与 Dev 必须都能被单独复制后运行自己的 hook regression。marketplace 保持 QA 第一，当前两份 Codex interface 字段、Claude hooks.json 兼容路径、每环境 MCP/permission namespace 均由 metadata 精确重建。

在同一 tracer 中建立 manage_project_install.py 的 QA happy path：`install --target PATH` 默认等价于 `--environment qa`，在目标仓库受管地写入 `.codex/config.toml` 的 QA MCP marker block、`.codex/hooks.json` 的 QA handler、`.codex/kcoderag-nav/qa/` 的自包含 hook 资产、`.agents/skills/kcoderag-nav/SKILL.md` 和 `.codex/kcoderag-nav/install-state.json`。安装器只解析显式 target，不访问或修改用户级 Codex config/cache；对既有项目 config/hooks 进行结构化合并并保留非受管字节/对象。uninstall 只移除 state 声明拥有且 digest 未冲突的 QA 资产/块；若目标文件已被用户修改或同名未受管 MCP table 已存在，应在任何写入前失败并给出路径级冲突。所有多文件变化先 staging 再原子提交，异常时回滚到原字节。
  </action>
  <verify>
    <automated>python scripts/generate_plugins.py --check &amp;&amp; python -m unittest discover -s tests -p "test_*.py" -k "generation or default_qa_round_trip" -v &amp;&amp; python kcoderag-qa/hooks/test_grep_nudge.py &amp;&amp; python kcoderag-dev/hooks/test_grep_nudge.py</automated>
  </verify>
  <done>一条生产质量的 QA 默认路径已从当前修复过的规范源贯穿两个可复制产物、只读 drift check、目标项目安装与卸载；两个生成 hook 均保留原 53/53 parser 行为，目标项目和用户环境边界有自动化证明。</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: 扩展显式 Dev/双装、独立卸载、QA 优先路由与跨进程 hook 去重</name>
  <files>plugin-src/routing.json, plugin-src/hooks/grep_nudge.py, plugin-src/hooks/test_grep_nudge.py, plugin-src/skills/code-lookup-discipline/SKILL.md, plugin-src/agents/kcode-explorer.md.tmpl, plugin-src/README.md.tmpl, scripts/generate_plugins.py, scripts/manage_project_install.py, tests/test_project_install.py, tests/test_routing_and_hooks.py, kcoderag-qa/hooks/grep_nudge.py, kcoderag-qa/hooks/test_grep_nudge.py, kcoderag-qa/skills/code-lookup-discipline/SKILL.md, kcoderag-qa/agents/kcode-explorer.md, kcoderag-qa/README.md, kcoderag-dev/hooks/grep_nudge.py, kcoderag-dev/hooks/test_grep_nudge.py, kcoderag-dev/skills/code-lookup-discipline/SKILL.md, kcoderag-dev/agents/kcode-explorer.md, kcoderag-dev/README.md</files>
  <behavior>
    - Test 1: install --environment dev 安装可独立工作的 Dev；install --environment both 安装两套 MCP/hook 资产；重复安装幂等。
    - Test 2: dual 状态卸载 qa 后 Dev 仍完整且项目 skill 切为 Dev-only；卸载 dev 后 QA 仍完整且默认 QA；最后一个环境卸载后仅删除安装器拥有的空容器。
    - Test 3: installed={qa,dev} + default 路由到 qa，intent=dev 只到 dev，intent=compare 到 qa+dev；选中环境 unreachable 返回该环境错误且 routes 中不增加另一环境。
    - Test 4: 两个生成 hook 接收相同 Codex session_id/turn_id/tool_use_id/tool_input 并发运行时，两进程均退出 0、合计恰有一个合法 additionalContext；不同 tool_use_id 各自得到一次。
    - Test 5: malformed identity/input、不可创建 dedup 目录、原子 marker/清理异常和 oversized input 均不产生 deny/block，不抛异常，退出 0；敏感 query 不出现在 marker 文件名/内容或输出中。
  </behavior>
  <action>
先写路由、生命周期和多进程失败测试。用 plugin-src/routing.json 表达唯一决策表，并从同一表渲染两个插件 skill、agent guidance、hook nudge 与项目安装 skill：只有 QA 可用时用 QA，只有 Dev 可用时用 Dev；双装且未指定环境时用 QA；显式 Dev 只用 Dev；显式 compare 才用两者；任何已选择环境不可达都报告该环境且不得静默回退。不要创建第三个运行时 core 插件，也不要让 Dev 依赖 QA。两个插件的同名共享 skill 内容必须基于“当前暴露工具集合”做上述选择，因此各自单装完整、双装时结论一致。

扩展项目安装器支持 `--environment qa|dev|both`，仅缺省 qa；`uninstall --environment qa|dev` 必须显式。state 记录每环境私有文件、共享项目 skill/config/hooks 的受管结构与写入 digest。双装时 `.codex/hooks.json` 保留 QA/Dev 两个 handler 以真实复现 Codex 并发行为；卸载一个环境只删其 MCP marker、handler 和私有目录，并从剩余 active set 重渲染共享 skill。保留现有未受管 hooks、MCP tables、skills、目录与普通文件；用户级 plugin add/remove 不由这个安装器调用。

在共享 grep_nudge.py 增加不等待的跨进程去重：优先用 hook_event_name + session_id + turn_id + tool_use_id 形成稳定 identity；缺少 tool_use_id 时用 host identity、canonical tool_name/tool_input 和短时间桶形成兼容 fingerprint。只把 SHA-256 digest 用作当前用户临时目录下 marker 名，使用 `os.open` 的 `O_CREAT|O_EXCL` 原子争用，winner 才输出 NUDGE，duplicate 静默退出。marker 不保存 raw input/Bearer，设置有限 TTL，并将 stale cleanup 限制为有界数量以避免 hook 延迟；去重目录可由测试专用环境变量定向到临时目录。identity 解析、hash、目录、marker 或 cleanup 的任何异常都返回“不可安全取得输出权”并静默退出 0，不阻断原始工具。保留当前 parser 函数和全部回归案例，再把共享实现重新生成到 QA/Dev。
  </action>
  <verify>
    <automated>python scripts/generate_plugins.py --check &amp;&amp; python -m unittest tests.test_project_install tests.test_routing_and_hooks -v</automated>
  </verify>
  <done>QA、Dev、both 三种项目状态均可安装且按环境独立卸载；路由矩阵可执行验证；双插件真实并发 subprocess 对同一调用只产生一个提示，所有失败路径继续退出 0。</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: 固化生成 drift、安装所有权、路由和双宿主兼容的完整离线 E2E 门禁</name>
  <files>README.md, plugin-src/README.md.tmpl, tests/test_generation.py, tests/test_project_install.py, tests/test_routing_and_hooks.py, kcoderag-qa/README.md, kcoderag-dev/README.md</files>
  <behavior>
    - Test 1: 在临时复制树连续执行两次 --write 后，QA/Dev/marketplace 的路径集和 SHA-256 清单完全相同；篡改任一 generated file 后 --check 非零且工作树字节不变。
    - Test 2: 把 QA 或 Dev 包单独复制到无 plugin-src 的目录后，manifest 相对路径全部可解析，hook regression 可运行，MCP endpoint/Bearer 与 permission namespace 均为对应环境且测试不打印其值。
    - Test 3: 预置无关 config.toml tables、hooks handlers、skills、普通文件以及 fake user CODEX_HOME/config/cache sentinels，覆盖 QA-only、Dev-only、both、qa→dev、dev→qa 的安装/独立卸载排列；所有非受管字节和 user sentinels 保持相同。
    - Test 4: 并发去重 E2E 重复多轮且每轮使用新 tool_use_id，恰好一份输出；Claude pattern payload 和 Codex Bash payload 都保留结构搜索提示与本地机械搜索静默行为。
    - Test 5: marketplace QA-first、两个 Codex manifest、Claude default hooks/hooks.json、settings permission、MCP path 和项目安装命令均通过结构校验。
  </behavior>
  <action>
补齐三个标准库 unittest 模块，测试必须使用 tempdir 和合成 token/endpoint fixture 验证结构，不连接内部 MCP、不读取用户真实配置，也不将当前内置 Bearer 写入 assertion message、subprocess stdout 或 failure diff。generation E2E 应先记录完整 tree manifest，再验证第二次生成相同；drift test 在隔离副本中篡改产物，断言 `--check` 只报告相对路径、返回非零且不修复文件。自包含测试把每个环境目录单独复制后运行其中 hook regression，并拒绝 symlink、父目录 import、缺失相对引用、错误环境名/namespace 或动态 timestamp。

安装 E2E 要为 target repo、fake user config/cache 和 dedup temp 分别建立哨兵，覆盖 default QA、explicit Dev、both、重复安装、从 dual 分别卸载 QA/Dev、最后环境卸载、未受管冲突和受管文件被用户修改后的安全拒绝；逐字节比较 user-level config/cache 与无关项目文件。路由 E2E 从 routing.json 同一权威输入驱动期望，不能在测试中复制第二份决策表。hook E2E 同时调用两个生成脚本而非只测 canonical module，验证同调用一次、不同调用各一次、异常静默且无阻塞输出。

新增根 README，把 `python scripts/manage_project_install.py install --target PATH` 作为普通用户默认 QA 路径；显式记录 `--environment dev` 和 `--environment both` 是开发/测试路径，以及 `uninstall --environment qa|dev` 的独立边界。把 `codex plugin marketplace add` / `codex plugin add` 标为显式用户级可选路径，并保留 Claude Code marketplace 安装说明；不得宣称 Codex 原生 project-scope plugin install。文档说明项目必须受信任才加载 `.codex/` hook/config、双装 QA 默认、不可达不回退、内置 Bearer 仅限当前内部阶段，但不得展示 Bearer 值。最后先执行 --write 固化产物，再以 --check 和全套 unittest 作为只读收尾门禁。
  </action>
  <verify>
    <automated>python scripts/generate_plugins.py --check &amp;&amp; python -m unittest discover -s tests -p "test_*.py" -v &amp;&amp; python kcoderag-qa/hooks/test_grep_nudge.py &amp;&amp; python kcoderag-dev/hooks/test_grep_nudge.py</automated>
  </verify>
  <done>完整离线门禁证明生成无漂移且可重复、两包独立自包含、项目安装/卸载不越权、QA 优先路由和 no-fallback 可预测、双 hook 并发只提示一次，并同时保留 Codex 与 Claude Code 分发路径。</done>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary | Description |
|---|---|
| canonical source → generated packages | 生成器把含环境 MCP/Bearer 的规范输入复制到公开安装产物，必须防止漂移、错环境和日志泄密。 |
| installer → target repository | 安装器可修改目标 `.codex/` 与 `.agents/`，但目标已有内容不受信任且不得被覆盖。 |
| hook stdin → advisory stdout | Claude/Codex 工具 payload、命令和 pattern 都是不受信任输入，hook 只能输出非阻塞 context。 |
| QA hook process ↔ Dev hook process | 两个独立进程争用同一 dedup identity，不能依赖启动顺序、进程内状态或阻塞锁。 |
| generated package → internal MCP | 当前包含内置 Bearer 并使用内部 HTTP；这是明确接受的内部阶段风险，不在本 quick 中扩张为身份/HTTPS 项目。 |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|---|---|---|---|---|---|
| T-Q-01 | Tampering | scripts/generate_plugins.py / generated trees | high | mitigate | 所有产物只从显式 canonical inputs 确定性渲染；--check 逐路径逐字节 fail closed；重复生成清单和环境字段交叉校验防错包。 |
| T-Q-02 | Information Disclosure | MCP/Bearer canonical inputs and tests | high | mitigate | 生成器/安装器/测试仅报告相对路径和字段名，禁止输出值；测试使用合成 secret，marker/hash/异常不包含原始 payload 或 Bearer。 |
| T-Q-03 | Tampering | target `.codex/` / `.agents/` | high | mitigate | 受管 marker、结构 identity、ownership manifest、digest conflict guard、staging + atomic replace/rollback；冲突先检查后写入。 |
| T-Q-04 | Denial of Service | PreToolUse parser/dedup | medium | mitigate | 输入长度上限、线性解析、无等待 O_EXCL、有限 TTL cleanup；任意异常静默退出 0，不返回 deny/block。 |
| T-Q-05 | Repudiation | independent uninstall | medium | mitigate | install-state 按环境记录拥有的路径、handler/table identity 和 digest；卸载输出路径级摘要并拒绝删除 digest 不匹配内容。 |
| T-Q-06 | Spoofing | dedup tool-call identity | medium | mitigate | 优先使用宿主 session/turn/tool_use identity 并加入 event；缺字段 fallback 仅使用 hash + 短时间桶，所有 marker 位于用户 temp namespace 且不信任 marker 内容。 |
| T-Q-07 | Elevation of Privilege | project installer target path | high | mitigate | 解析并验证显式 target，所有写入的 resolved path 必须位于 target/.codex 或 target/.agents；拒绝 symlink escape 和不受管同名配置。 |
| T-Q-08 | Information Disclosure | bundled Bearer over internal HTTP | high | accept | PROJECT.md 明确接受当前内部 QA/Dev 装即用阶段；文档限定内部使用且测试不连接/打印。身份、HTTPS、轮换保持 SEC-01..03 v2，不在本 quick 中伪装解决。 |

本计划不新增 npm/pip/cargo 依赖；生成器、安装器和测试仅使用 Python 标准库，因此 package legitimacy gate 不适用。
</threat_model>

<verification>
1. `python scripts/generate_plugins.py --check` 在未修改工作树的情况下返回 0；隔离副本 drift case 返回非零且不写回。
2. `python -m unittest discover -s tests -p "test_*.py" -v` 覆盖 generation、project lifecycle、routing 与并发 hooks。
3. 两个 generated hook 自带 regression 脚本均通过，现有 53 个 parser cases 全部仍在并继续通过，新去重 cases 由 repository tests 补充。
4. 测试输出和版本库 diff 不包含新增的明文 credential 副本；环境 MCP source 与对应 generated `.mcp.json` 逐字节/结构一致。
5. `git diff --check` 通过；`git status --short` 显示原有未提交修改被纳入生成产物而非重置，计划范围外文件不变。
</verification>

<success_criteria>
- 一个显式规范源确定性生成 QA/Dev 两个可单独复制、安装、卸载和运行的完整包，且 `--check` 能只读检测任何 drift。
- 普通项目安装默认 QA；Dev/both 只能显式选择；任何环境均可从单装或双装状态独立卸载而不伤及另一环境。
- 项目级兼容安装器只管理目标 `.codex/` 与 `.agents/`，用户级 Codex config/cache 和无关项目内容具有字节级 E2E 保护。
- 双装路由严格为 default→QA、Dev intent→Dev、compare→QA+Dev、unreachable→显式错误且不回退。
- QA/Dev 并发 hook 对同一 tool call 至多一个 additionalContext，异常全部 fail-open；原 53/53 parser 修复完整保留。
- marketplace、Codex manifest、Claude hooks、MCP/permission 路径以及默认 QA 文档均由自动化验证覆盖。
</success_criteria>

<output>
完成后创建 `.planning/quick/260820-nhw-kcoderag-nav-qa-dev-qa-dev-qa-hook-e2e/260820-nhw-SUMMARY.md`，frontmatter 使用 `status: complete`，并逐项记录实际命令、结果和任何 NOT_RUN；不得在 summary 中复制 MCP secret。
</output>
