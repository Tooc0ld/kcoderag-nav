---
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - plugin-src/hooks/hooks.json
  - plugin-src/hooks/run_hook.sh
  - plugin-src/hooks/run_hook.cmd
  - scripts/generate_plugins.py
  - scripts/manage_project_install.py
  - scripts/run_host_smoke.py
  - tests/test_generation.py
  - tests/test_project_install.py
  - tests/test_hook_runtime.py
  - tests/stub_mcp_server.py
  - tests/test_host_smoke.py
  - .github/workflows/ci.yml
  - README.md
  - MCP_QA_EXPERIENCE_GUIDE.md
  - kcoderag-qa/hooks/hooks.json
  - kcoderag-qa/hooks/run_hook.sh
  - kcoderag-qa/hooks/run_hook.cmd
  - kcoderag-dev/hooks/hooks.json
  - kcoderag-dev/hooks/run_hook.sh
  - kcoderag-dev/hooks/run_hook.cmd
autonomous: true
requirements:
  - HOOK-RUNTIME-01
  - HOOK-RUNTIME-02
  - INSTALL-STATUS-01
  - INSTALL-STATUS-02
  - HOST-SMOKE-01
  - HOST-SMOKE-02
  - DOCS-01
  - DELIVERY-01
estimate:
  tokens: 45000
  raw_tokens: 45000
  tasks: 3
  confidence: low
must_haves:
  truths:
    - "QA/Dev plugin hook 和项目安装 hook 在 Python 3.10+ 可用时正常运行；只有旧 Python、找不到 Python 或 probe/launch 失败时均静默退出 0，不阻断原工具。"
    - "hook 配置不再直接硬编码 `python grep_nudge.py`，而是通过两个包都携带的 POSIX/Windows runtime launcher 做版本选择；Python source 继续明确要求 3.10+。"
    - "项目安装器可用 `status --target PATH` 和 `status --target PATH --json` 只读区分 healthy、not_installed、managed drift、source update available 与 invalid state，并只报告安全的 code/path。"
    - "必过 CI 使用 Python 3.10+ 矩阵和本地 stub MCP 验证生成、安装、hook launcher、status 与 MCP 协议，不访问内部 QA/Dev endpoint，也不需要 Claude/Codex 模型凭据。"
    - "可选真实宿主 smoke 在隔离且已认证的 runner 上用同一个 stub MCP 启动 Claude Code/Codex；Codex headless 明确处理 hook trust，并以结构化事件/receipt 证明 hook 与 stub tool 被实际调用。"
    - "README 与目标仓库新增的 MCP_QA_EXPERIENCE_GUIDE.md 说明 Python 3.10、fail-open、status、CI 分层与 headless trust 边界，且不出现 Bearer、Authorization header 或内部 endpoint 值。"
    - "所有验证通过后仅提交计划内目标仓库文件并正常 push 当前分支；现有未跟踪 `.gsd/` 和任何用户改动不被暂存、覆盖或提交。"
  artifacts:
    - path: "plugin-src/hooks/run_hook.sh"
      provides: "POSIX Python 3.10+ probe/launch 与静默 fail-open"
    - path: "plugin-src/hooks/run_hook.cmd"
      provides: "Windows Python 3.10+ probe/launch 与静默 fail-open"
    - path: "scripts/manage_project_install.py"
      provides: "只读 status/--json 漂移诊断"
    - path: "tests/stub_mcp_server.py"
      provides: "仅绑定 loopback 的标准库 MCP initialize/tools/list/tools/call stub 与安全 receipt"
    - path: "scripts/run_host_smoke.py"
      provides: "Claude Code/Codex 隔离宿主 smoke harness"
    - path: ".github/workflows/ci.yml"
      provides: "必过 deterministic matrix 与可选 authenticated host smoke jobs"
    - path: "MCP_QA_EXPERIENCE_GUIDE.md"
      provides: "归属 kcoderag-nav 且已脱敏的 QA 使用/诊断指南"
  key_links:
    - from: "plugin-src/hooks/hooks.json"
      to: "plugin-src/hooks/run_hook.sh and run_hook.cmd"
      via: "command/commandWindows invoke the platform launcher before loading grep_nudge.py"
      pattern: "run_hook"
    - from: "scripts/generate_plugins.py"
      to: "kcoderag-qa/hooks and kcoderag-dev/hooks"
      via: "both launchers and hooks.json are canonical SHARED_FILES rendered into each self-contained package"
      pattern: "SHARED_FILES"
    - from: "scripts/manage_project_install.py"
      to: "<target>/.codex/hooks.json and <target>/.codex/kcoderag-nav/<env>/hooks"
      via: "project hook registration references installed launchers, and status inspects the same ownership state/digests without writing"
      pattern: "status|run_hook"
    - from: ".github/workflows/ci.yml"
      to: "tests/stub_mcp_server.py and scripts/run_host_smoke.py"
      via: "required contract job uses stub protocol tests; opt-in authenticated job runs preinstalled host CLIs against loopback stub only"
      pattern: "workflow_dispatch|host-smoke"
---

<objective>
为 KCodeRag Nav 补齐 Python 3.10+ hook runtime 探测和缺失时静默 fail-open、项目安装状态/漂移诊断，以及不依赖内部环境的 Claude Code/Codex stub MCP CI smoke，随后更新使用文档并安全提交推送。

Purpose: 当前 hook 注册直接调用 `python`，当宿主 PATH 缺 Python、只有旧解释器或 headless hook 尚未信任时，用户无法区分“导航未启用”“安装漂移”和“MCP 不可用”；CI 也尚未验证真实宿主装载边界。

Output: 跨平台 runtime launchers、生成/安装集成、`status --json`、loopback MCP stub、分层 CI、脱敏文档，以及验证后的正常 git push。
</objective>

<execution_context>
@C:/Users/kingsoft/.codex/gsd-core/workflows/execute-plan.md
@C:/Users/kingsoft/.codex/gsd-core/templates/summary.md
</execution_context>

<context>
@AGENTS.md
@.planning/STATE.md
@.agents/skills/kcoderag-nav/SKILL.md
@plugin-src/hooks/hooks.json
@plugin-src/hooks/grep_nudge.py
@plugin-src/hooks/test_grep_nudge.py
@scripts/generate_plugins.py
@scripts/manage_project_install.py
@tests/test_generation.py
@tests/test_project_install.py
@tests/test_routing_and_hooks.py
@README.md
@plugin-src/README.md.tmpl
@D:/AIProgram/KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md
</context>

<source_coverage>

| Source | Item | Task | Status | Notes |
|---|---|---:|---|---|
| GOAL | Python 3.10+ preflight + missing-runtime fail-open | 1 | COVERED | canonical → generated → project install tracer |
| GOAL | installer status/--json drift diagnostics | 2 | COVERED | read-only, path/code-only contract |
| GOAL | Claude/Codex stub MCP host smoke CI | 3 | COVERED | deterministic required + optional authenticated real-host split |
| GOAL | README + MCP_QA_EXPERIENCE_GUIDE.md | 3 | COVERED | guide is created in kcoderag-nav; adjacent KCodeRag copy is read-only source context |
| GOAL | verify, commit, push | 3 | COVERED | no force push; `.gsd/` excluded |
| REQ | No roadmap requirement IDs assigned to this quick task | — | N/A | quick-specific IDs are declared in frontmatter |
| RESEARCH | No RESEARCH.md by explicit constraint | — | N/A | no package-manager dependency added; host CLIs are preinstalled in optional runner |
| CONTEXT | No quick CONTEXT.md / D-XX | — | N/A | calling constraints and current code are authoritative |

本 quick 不实现真实 QA/Dev endpoint CI、不新增 production credential/HTTPS 方案、不把 headless trust bypass 写成普通用户默认，也不修改相邻 `D:/AIProgram/KCodeRag` 仓库。
</source_coverage>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: 打通 Python 3.10 runtime probe → generated package → project-installed hook</name>
  <files>plugin-src/hooks/hooks.json, plugin-src/hooks/run_hook.sh, plugin-src/hooks/run_hook.cmd, scripts/generate_plugins.py, scripts/manage_project_install.py, tests/test_generation.py, tests/test_project_install.py, tests/test_hook_runtime.py, kcoderag-qa/hooks/hooks.json, kcoderag-qa/hooks/run_hook.sh, kcoderag-qa/hooks/run_hook.cmd, kcoderag-dev/hooks/hooks.json, kcoderag-dev/hooks/run_hook.sh, kcoderag-dev/hooks/run_hook.cmd</files>
  <behavior>
    - Test 1: POSIX launcher 依次探测明确候选，只在 candidate 的 `sys.version_info >= (3, 10)` 时把 stdin 原样交给 hook；Python 3.9、command missing、probe failure、exec failure 均 exit 0 且 stdout/stderr 为空。
    - Test 2: Windows launcher 对 `py -3`、`python3`、`python` 做等价 3.10+ 检查；缺失/旧版本静默 exit 0，合格解释器执行 hook 并保留 JSON stdout。
    - Test 3: canonical hooks.json 的 command/commandWindows 均调用 launcher，不直接调用 grep_nudge.py；两个 generated package 的 launcher、registration 和 source 完整自包含。
    - Test 4: 默认 QA 与 explicit both 项目安装把每环境 grep_nudge.py + 两个 launcher 写入受管目录，项目 hooks.json 指向对应 launcher；卸载后精确恢复原字节。
    - Test 5: Python 3.10 上 canonical/generated hook 与现有 parser/dedup 回归可导入运行，生成 `--check` 无 drift。
  </behavior>
  <action>
先为 shell/batch runner 写合成 PATH 与 fake interpreter 回归，再实现两个无第三方依赖的 canonical launcher。POSIX runner 使用 `sh` 兼容语法，按明确候选探测 `python3` 后 `python`；Windows runner 使用 `cmd` 兼容语法，探测 `py -3`、`python3`、`python`。probe 代码必须能被旧 Python 解析，只检查 `sys.version_info >= (3, 10)`；只有合格 candidate 才启动 grep_nudge.py。所有找不到命令、版本过旧、probe/launch 异常都吞掉诊断并退出 0，不输出 advisory、不返回 deny/block。合格 candidate 下 hook 的 stdout 原样传给宿主，stderr 仍保持协议干净。不要降低 canonical hook 的 Python 3.10 syntax 或恢复第三方依赖。

把 hooks.json 改为 plugin-root 相对的 launcher 命令：Claude/Codex POSIX 用 `${CLAUDE_PLUGIN_ROOT}`，Windows 用 `PLUGIN_ROOT`，路径引用必须留在插件根。扩展 `SHARED_FILES` 生成两份 launcher，并让 generation self-contained/path tests 断言两包内容和 command wiring。项目安装器的 `_private_payloads` 同时安装 grep_nudge.py、run_hook.sh、run_hook.cmd；`_project_hook` 生成项目受管 launcher command，而不是当前硬编码 `python`。项目命令必须从显式 target 得到安全、正确引用且继续受 `_assert_managed_path`/digest/state 管理；双装保留两个 handler 以继续覆盖现有跨进程去重。升级已有 state 时为新 launcher 捕获 original/ownership，不能删除未受管同名文件；独立卸载仍只删除对应环境资产。
  </action>
  <verify>
    <automated>python scripts/generate_plugins.py --check &amp;&amp; python -m unittest tests.test_hook_runtime tests.test_generation tests.test_project_install -v</automated>
  </verify>
  <done>Python 3.10+ 能从插件与项目安装两条路径执行现有 hook；旧/缺失 runtime 静默放行；QA/Dev 产物无 drift，安装所有权与独立卸载契约保持。</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: 增加只读 status/--json 安装健康与 drift 诊断</name>
  <files>scripts/manage_project_install.py, tests/test_project_install.py, README.md</files>
  <behavior>
    - Test 1: `status --target fresh` 返回 `not_installed`；完整安装且 bytes/digests/current source 一致返回 `healthy` 和有序 active environments。
    - Test 2: 缺失/修改任一受管文件返回 `drifted`，issue 只含稳定 code 与仓库相对 path；不输出 expected/actual bytes、hash input、MCP URL、header 或 Bearer。
    - Test 3: 安装内容仍匹配 install-state，但当前 canonical render 已变化时返回 `update_available`，与用户本地 drift 明确区分。
    - Test 4: state JSON 损坏、symlink/path escape、孤儿受管目录或 ownership 不一致返回 `invalid`/`drifted`，且 status 前后 target tree 完全相同。
    - Test 5: `status --json` stdout 恰为一个稳定 JSON object：schema_version、status、active_environments、issues；human mode 与 JSON 使用相同 inspection result。
  </behavior>
  <action>
在现有 installer ownership/digest 逻辑上增加纯只读 `inspect_status(target, source_root)`，不得复用会写盘、prune 或就地修改 state 的路径；需要计算 current desired state 时先 deep-copy 已加载 state并只在内存渲染。定义稳定结果 schema：`schema_version: 1`、`status`、按 qa/dev 顺序的 `active_environments`、按 path/code 排序的 `issues`。状态至少区分 `healthy`、`not_installed`、`drifted`、`update_available`、`invalid`：installed bytes 对 state digest 不同属于 drift，state digest 健康但当前 canonical desired bytes 不同属于 update available；无 state 却存在 `.codex/kcoderag-nav` 受管痕迹要报告 orphan issue，而不是称未安装。

CLI 增加 `status --target PATH [--json]`。exit code 契约固定为 0=healthy，1=not_installed/drifted/update_available，2=invalid input/state；human 与 JSON 都只打印 safe code、relative path、environment 和 status，不打印 digests 或配置内容。status 在 target 不存在/不可信时沿用安全 target/path guard。安装与卸载现有成功/失败输出和行为保持兼容。测试对每种状态做 before/after tree snapshot，覆盖双装与独立卸载后 status，并用合成 MCP source 触发 update_available，绝不改动或读取用户真实 Codex home。
  </action>
  <verify>
    <automated>python -m unittest tests.test_project_install -v</automated>
  </verify>
  <done>用户和 CI 可通过 human/JSON status 无副作用地区分未安装、健康、本地 drift、可升级源和无效状态，诊断保持 credential-safe。</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: 建立 stub MCP 双宿主 CI、脱敏体验文档并验证提交推送</name>
  <files>tests/stub_mcp_server.py, scripts/run_host_smoke.py, tests/test_host_smoke.py, .github/workflows/ci.yml, README.md, MCP_QA_EXPERIENCE_GUIDE.md</files>
  <precondition>`git remote get-url origin` 成功、当前分支不是 detached HEAD，且执行环境对该分支具有普通 push 权限；若不满足，完成代码与验证后报告 push NOT_RUN，不改写 remote、不 force-push。</precondition>
  <behavior>
    - Test 1: loopback stub 完成 MCP initialize、notifications/initialized、tools/list、tools/call，暴露合成只读工具并写 path/method/tool-name receipt；未知 method、坏 JSON 和非 loopback bind 安全失败。
    - Test 2: deterministic harness 用合成 MCP 配置证明 QA/Dev package 与项目 install 的 host config 指向 stub，任何执行/receipt/config 均不含内部 endpoint 或真实 Authorization 值。
    - Test 3: Codex command adapter 使用 headless `codex exec --ephemeral --ignore-user-config --dangerously-bypass-hook-trust --json` 和隔离 workspace/config；Claude adapter 使用 `-p`、`--plugin-dir`、`--strict-mcp-config`、stub config 与 stream JSON hook events。
    - Test 4: fake-host contract tests 断言两个 adapter 都要求一次结构搜索 hook 与一次 stub MCP tool call，并只根据结构化 event + stub receipt 判定，不解析模型自然语言成功句。
    - Test 5: required GitHub CI 在 Python 3.10+ 的 Linux/Windows matrix 跑 generation、unittest、generated hook regressions；authenticated host smoke 仅由显式 workflow_dispatch 在预装/已认证隔离 runner 上运行并可报告 NOT_RUN。
  </behavior>
  <action>
实现只绑定 `127.0.0.1` 随机端口的标准库 stub MCP，支持 Streamable HTTP 所需 initialize、initialized、tools/list、tools/call 最小协议和固定合成返回；工具名可使用 `list_indexes`/`search_code` 但响应必须标明 synthetic。receipt 使用临时 JSONL，仅记录 protocol method、tool name、request id 和时间，不记录 Authorization、prompt 或 arguments 原文。测试启动/停止 server、验证协议与 receipt，并扫描本任务新增的 workflow/harness/guide，确保不存在 canonical environment 中的 endpoint/header 值。

实现 run_host_smoke.py 的 `--host codex|claude` adapter。每次 smoke 创建临时 git workspace、临时 host config/cache、synthetic source 文件和 loopback MCP config，调用项目安装或隔离 plugin copy；不得读取用户 config/cache或修改 tracked `.mcp.json`。Codex 是 headless：仅在这个已经 vet 过 hook source 的隔离自动化命令中显式传 `--dangerously-bypass-hook-trust`，同时使用 `--ephemeral`、`--ignore-user-config`、JSONL 和 read-only sandbox；不得传 blanket approvals/sandbox bypass。Claude 使用 `--plugin-dir`/`--mcp-config`/`--strict-mcp-config` 和 stream-json hook events。prompt 要求先做一次结构搜索触发 hook，再调用 stub tool；成功必须同时看到宿主结构化 hook/tool event 和 stub receipt，CLI missing/auth missing 分别产出稳定 NOT_RUN reason，而非伪造 PASS。单元测试用 fake executables 验证 argv、event parser、timeout/cleanup 与 receipt gate；实际 host invocation 不进入普通必过 job。

新增唯一 `.github/workflows/ci.yml`，使用 commit SHA 固定的 checkout/setup-python actions。required jobs 在 push/PR/workflow_dispatch 上运行 Python 3.10 和一个较新版本，并覆盖 Ubuntu + Windows，从而真实执行 `.sh`/`.cmd` launcher、generation check、全套 unittest 和两份 generated hook regression；不安装 npm/pip/cargo 包，不访问内部 MCP。另设仅在显式 workflow_dispatch 输入开启、运行于带 `kcoderag-host-smoke` label 且预装/已认证 Claude/Codex 的隔离 self-hosted job；它仍只连接 loopback stub，缺 CLI/auth 时输出 NOT_RUN receipt，不得让 required contract job借此变绿。

更新 README：声明 installer 与 hook source 的 Python 3.10+ 要求、launcher candidate 顺序、旧/缺失 runtime 静默 fail-open、`status`/`status --json` 命令与 exit codes、required vs optional CI、Codex headless trust bypass 只限已 vet 自动化。把相邻 `D:/AIProgram/KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md` 作为内容参考，在本仓库新建同名指南并更新安装/诊断/host smoke 流程；不得修改相邻仓库。新指南删除/替换原文中的明文 Bearer、Authorization 和内部 endpoint/curl 示例，链接本仓库配置和 status 说明，用“由受控插件携带”描述凭据。README 链接该指南。

完成后运行全套验证与 `git diff --check`，检查 `git status --short`，只显式 stage 本计划文件清单；不得使用 `git add -A`，不得暂存 `.gsd/`、planning artifacts 或其他用户文件。按 quick executor 的原子提交协议创建任务提交；所有任务提交和最终验证完成后，以普通 fast-forward `git push` 推送当前分支（没有 upstream 时 `git push --set-upstream origin HEAD`），绝不 force-push。push 失败要保留本地提交并在 SUMMARY 记录命令/category/NOT_RUN 或 failure，不得改写历史或凭据。
  </action>
  <verify>
    <automated>python scripts/generate_plugins.py --check &amp;&amp; python -m unittest discover -s tests -p "test_*.py" -v &amp;&amp; python kcoderag-qa/hooks/test_grep_nudge.py &amp;&amp; python kcoderag-dev/hooks/test_grep_nudge.py &amp;&amp; git diff --check</automated>
    <optional-host>python scripts/run_host_smoke.py --host codex --json &amp;&amp; python scripts/run_host_smoke.py --host claude --json；只在预装且已认证隔离 runner 上执行，其他环境记录 NOT_RUN。</optional-host>
  </verify>
  <done>required CI 可离线重复验证 runtime/status/stub contracts；可选真实宿主 smoke 有结构化证据；两份文档已脱敏更新；计划内提交已正常 push，或因明确 remote/auth 前置条件记录 push NOT_RUN。</done>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary | Description |
|---|---|
| Host hook command → Python runtime | PATH 中解释器可能缺失、过旧或被异常 shim 取代；hook 必须保持 advisory fail-open。 |
| Installer status → managed project files | 目标 state/config/hooks 可能损坏、被用户修改或含 credential；诊断只能读且不能泄露内容。 |
| CI/host harness → MCP | smoke 必须只连 loopback synthetic server，不能误用 tracked QA/Dev 地址或 Bearer。 |
| Headless CI → Claude/Codex | 模型认证和 hook trust 是外部状态；必过合同不能依赖它们，trust bypass 只能用于已 vet 的隔离 smoke。 |
| Executor → git remote | push 改变外部仓库；仅允许当前分支普通 push，禁止 force/history rewrite 和混入用户文件。 |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|---|---|---|---|---|---|
| T-THB-01 | Spoofing | PATH Python candidate | high | mitigate | runner 对每个明确候选执行 version probe，只接受 >=3.10；测试 fake candidates/ordering；失败静默不执行 hook source。 |
| T-THB-02 | Denial of Service | hook launcher | high | mitigate | probe/command/exec 全部有限、无安装/下载、异常 exit 0 且空输出；保留现有 hook timeout/input bounds。 |
| T-THB-03 | Information Disclosure | status JSON/human output | high | mitigate | schema 只允许 status/environment/code/path；测试扫描 stdout/stderr，禁止 byte/hash/config/header/Bearer 内容。 |
| T-THB-04 | Tampering | status implementation | medium | mitigate | before/after tree snapshot 证明纯只读；deep-copy state 后内存渲染；symlink/path guards 复用现有 installer 边界。 |
| T-THB-05 | Information Disclosure | stub MCP / CI logs | high | mitigate | 只用 synthetic token/response，loopback 随机端口，receipt 不记录 headers/arguments；扫描新增 artifacts 不含 canonical secrets/endpoints。 |
| T-THB-06 | Elevation of Privilege | Codex headless trust | high | mitigate | `--dangerously-bypass-hook-trust` 仅可选隔离 smoke、已 vet source；保持 read-only sandbox，不使用 blanket approval/sandbox bypass。 |
| T-THB-07 | Tampering | GitHub Actions supply chain | high | mitigate | checkout/setup-python 固定完整 commit SHA；required job不下载 host CLI或安装 package-manager dependencies；real hosts 来自受控 self-hosted image。 |
| T-THB-08 | Tampering | git delivery | high | mitigate | 仅显式 stage 计划文件，验证 `.gsd/` 未暂存，普通 current-branch push，无 force，无 remote/history rewrite。 |

本计划不新增 npm/pip/cargo 安装任务；Python 测试与 stub 仅使用标准库，Claude/Codex CLI 由可选受控 runner 预装，因此 package legitimacy gate 不适用。
</threat_model>

<verification>
1. `python scripts/generate_plugins.py --check` 返回 0，两个 package 包含 runner 且 registration 不直接硬编码 Python hook source。
2. Python 3.10+ Linux/Windows matrix 通过全套 unittest、两个 generated hook regressions 与 runtime missing/old/candidate tests。
3. status human/JSON 的五类状态、退出码、只读性和 credential-safe schema 全部通过。
4. stub MCP required tests完成 initialize/tools/list/tools/call，所有网络目标均为 loopback；无 host/model auth 时真实宿主 smoke 明确 NOT_RUN。
5. authenticated optional smoke 只有同时具备 host event 与 stub receipt 才 PASS；Codex argv 含显式 hook trust handling 且无 blanket bypass。
6. README 和本仓库 MCP_QA_EXPERIENCE_GUIDE.md 不包含 canonical MCP URL/Bearer/header 值，且相邻 KCodeRag repo 无变更。
7. `git diff --check` 通过，计划外 `.gsd/` 未 staged；普通 push 成功或以准确 external blocker/NOT_RUN 交付。
</verification>

<success_criteria>
- Python 3.10+ hook runtime 可预测；缺失/旧解释器绝不阻断宿主工具。
- QA/Dev generated 与 project-installed hook 使用同一 canonical launcher 合同并保持自包含、独立卸载。
- installer status/--json 能安全、只读地区分安装健康、drift、source update 和 invalid state。
- required CI 完全离线于内部环境；可选 Claude/Codex real-host smoke 只连接 stub 且证据可机读。
- README 与 MCP QA 体验指南准确、脱敏，并说明 Codex headless trust 的安全边界。
- 验证后的计划内提交已普通 push，未覆盖、提交或泄露用户现有工作。
</success_criteria>

<output>
完成后创建 `.planning/quick/260820-thb-python-3-10-hook-fail-open-claude-code-c/260820-thb-SUMMARY.md`，frontmatter 使用 `status: complete`。SUMMARY 记录 required CI、本地验证、optional host smoke 和 push 的实际 verdict/NOT_RUN，但不得包含 host auth、Bearer、Authorization header、内部 endpoint 或完整敏感日志。
</output>
