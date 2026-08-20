<!-- GSD:project-start source:PROJECT.md -->

## Project

**KCodeRag Nav Plugins**

KCodeRag Nav Plugins 是 KCodeRag MCP 查询服务的代理导航插件分发仓库，面向 Codex，
并保留 Claude Code 兼容能力。仓库发布 `kcoderag-qa` 与 `kcoderag-dev` 两个可独立安装、
独立卸载、单独完整工作的插件，使代码代理在结构化代码检索时优先使用知识图谱，精确文本
和未提交改动仍使用本地搜索。

普通用户只需要安装 QA 插件；Dev 插件主要用于开发和测试。测试人员可以同时安装两者，
此时默认查询 QA，只有明确指定 Dev 或要求环境对比时才查询 Dev 或双查询。
默认分发路径采用项目级安装器，将 Codex hook、skill 与 MCP 配置部署到目标仓库自己的
`.codex/` 和 `.agents/`；用户级 `codex plugin add` 仅作为显式可选路径。

**Core Value:** 用户安装任一环境插件后即可获得可靠、低打扰、环境选择明确的 KCodeRag 图优先导航体验。

### Constraints

- **独立性**: 两个环境插件必须分别安装、卸载和运行 — Dev 不能只是依赖 QA 的附加包
- **默认环境**: 双装时 QA 优先 — 普通用户路径和验收环境保持一致
- **分发**: 安装产物必须自包含 — 插件缓存不会可靠保留仓库级共享父目录
- **项目边界**: 默认安装与卸载只能修改目标仓库内由安装器管理的文件 — 不污染用户配置或无关项目文件
- **Hook**: 仅提供 advisory context，任何异常都必须 fail-open — 不阻断 `grep`、`glob` 或 shell
- **兼容性**: 支持 Codex，并维持现有 Claude Code marketplace/hook 兼容能力
- **凭据**: 当前 QA/Dev 阶段允许装即用的内置 Bearer — 明确接受内部测试阶段风险
- **变更保护**: 仓库已有未提交修改，初始化和后续实现不得覆盖或回退无关工作

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- Python 3 - `kcoderag-dev/hooks/grep_nudge.py` and `kcoderag-qa/hooks/grep_nudge.py` implement the cross-host lookup hook and use only the standard library.
- JSON - plugin manifests, marketplace metadata, permissions, and hook registration in `.claude-plugin/marketplace.json`, `kcoderag-dev/.codex-plugin/plugin.json`, `kcoderag-qa/.codex-plugin/plugin.json`, `kcoderag-dev/settings.json`, and `kcoderag-qa/settings.json`.
- Markdown - human-facing plugin documentation and skill instructions in `kcoderag-dev/` and `kcoderag-qa/`.

## Runtime

- Python 3.x; the hook is launched by Claude Code/Codex through the configured `python` command. No Python version pin is present.
- Claude Code and Codex plugin hosts provide the lifecycle, tool payload, and MCP execution environment.
- Not detected; no `pyproject.toml`, `requirements*.txt`, `uv.lock`, `package.json`, or other application package manifest is present.
- Lockfile: missing/not applicable.

## Frameworks

- Model Context Protocol (MCP) - external KCodeRag Dev/QA servers are registered by each plugin's `.mcp.json` (file existence noted; contents are not read because it may contain credentials).
- Claude Code/Codex plugin interfaces - manifests in `kcoderag-dev/.codex-plugin/plugin.json`, `kcoderag-qa/.codex-plugin/plugin.json`, and `.claude-plugin/marketplace.json`.
- Python standard-library test scripts in `kcoderag-dev/hooks/test_grep_nudge.py` and `kcoderag-qa/hooks/test_grep_nudge.py`; no pytest configuration or dependency was detected.
- None detected. Installation is performed with `codex plugin marketplace add` / `codex plugin add` or Claude Code marketplace commands documented in the READMEs.

## Key Dependencies

- Python standard library (`json`, `re`, `subprocess`, `typing`, and related modules) - implements parsing, heuristic classification, JSON hook output, and self-tests without third-party packages (`kcoderag-dev/hooks/grep_nudge.py`).
- KCodeRag MCP service - supplies `search_code`, `context`, `get_call_chain`, `list_indexes`, `cypher`, and `submit_feedback` as described in `kcoderag-dev/README.md` and `kcoderag-qa/README.md`.
- Claude Code/Codex hook runtime - invokes `PreToolUse` handlers configured in `kcoderag-dev/hooks/hooks.json` and `kcoderag-qa/hooks/hooks.json`.

## Configuration

- Plugin-local MCP connection/auth configuration is declared in `kcoderag-dev/.mcp.json` and `kcoderag-qa/.mcp.json` (contents intentionally not inspected).
- Host permissions allow the plugin MCP namespace through `kcoderag-dev/settings.json` and `kcoderag-qa/settings.json`.
- Hook launch uses `CLAUDE_PLUGIN_ROOT` on Unix-like hosts and `PLUGIN_ROOT` in the Windows command in both `hooks.json` files.
- Marketplace metadata: `.claude-plugin/marketplace.json`.
- Codex plugin manifests: `kcoderag-dev/.codex-plugin/plugin.json`, `kcoderag-qa/.codex-plugin/plugin.json`.
- No compile or bundling configuration detected.

## Platform Requirements

- A Claude Code or Codex installation with plugin marketplace support.
- Python available as `python` for hook execution.
- Access to the internal Dev or QA network and its corresponding KCodeRag MCP endpoint; README states the endpoints are intended for their respective internal networks (`kcoderag-dev/README.md`, `kcoderag-qa/README.md`).

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

- Python modules use lowercase `snake_case`, for example `kcoderag-dev/hooks/grep_nudge.py`.
- Tests use the `test_*.py` naming form, for example `kcoderag-dev/hooks/test_grep_nudge.py`.
- Functions use lowercase `snake_case` (`looks_like_symbol_lookup`, `shell_lookup_patterns`, and `hook_output` in `kcoderag-dev/hooks/grep_nudge.py`).
- Private implementation helpers use a leading underscore (`_unquote`, `_is_single_file_scope`, and `_is_local_only_scope`).
- Module constants use uppercase `SCREAMING_SNAKE_CASE` (`NUDGE`, `SILENT_RES`, `MAX_COMMAND_CHARS`).
- Local collections and flags use descriptive lowercase `snake_case` names.
- Type annotations use built-in generics and union syntax compatible with modern Python (`list[str]`, `dict[str, Any]`, and `dict[...] | None`).
- Mapping-shaped inputs are typed with `collections.abc.Mapping`; heterogeneous hook payloads use `Any` at the boundary (`kcoderag-dev/hooks/grep_nudge.py`).

## Code Style

- No formatter configuration (`pyproject.toml`, `.prettierrc`, or equivalent) is present. Preserve the existing readable PEP 8-style layout and approximately 100-character lines.
- Use a shebang and module docstring for executable Python scripts, as in `kcoderag-dev/hooks/grep_nudge.py`.
- No lint configuration or enforced lint command is detected. Keep imports standard-library-only where possible and avoid unused imports.

## Import Organization

- Not detected. Tests load the adjacent implementation explicitly with `importlib.util.spec_from_file_location` (`kcoderag-dev/hooks/test_grep_nudge.py`).

## Error Handling

- Hook boundaries fail open: `main()` catches malformed JSON and unexpected exceptions, returns exit code `0`, and emits no output (`kcoderag-dev/hooks/grep_nudge.py`).
- Classification helpers return neutral empty/false values for invalid input rather than raising.
- Keep the hook advisory and non-blocking; do not turn lookup nudges into command rejection.

## Logging

- The hook writes only its JSON protocol response to stdout; tests print human-readable pass/fail diagnostics (`kcoderag-dev/hooks/test_grep_nudge.py`).
- Do not print diagnostics from the hook protocol path, because consumers interpret stdout as JSON.

## Comments

- Use module and function docstrings to explain host payloads, fail-open behavior, and non-obvious parsing rules (`kcoderag-dev/hooks/grep_nudge.py`).
- Comments should document policy boundaries such as local-file exceptions and shell normalization, not restate simple expressions.
- Not applicable; no JavaScript/TypeScript source is present.

## Function Design

## Module Design

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Overview

```text

```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Marketplace manifest | Publishes the two plugin names, local sources, and descriptions | `.claude-plugin/marketplace.json` |
| Dev package | Dev MCP permission scope and navigation assets | `kcoderag-dev/` |
| QA package | QA MCP permission scope and navigation assets | `kcoderag-qa/` |
| MCP permission policy | Allows only the package's environment-qualified MCP namespace | `kcoderag-dev/settings.json`, `kcoderag-qa/settings.json` |
| Hook registration | Runs the advisory lookup hook before search tools | `kcoderag-dev/hooks/hooks.json`, `kcoderag-qa/hooks/hooks.json` |
| Lookup hook | Detects likely structural searches and emits guidance; fails open | `kcoderag-dev/hooks/grep_nudge.py`, `kcoderag-qa/hooks/grep_nudge.py` |
| Navigation skill | Defines graph-first search/context/call-chain workflow | `kcoderag-dev/skills/code-lookup-discipline/SKILL.md`, `kcoderag-qa/skills/code-lookup-discipline/SKILL.md` |
| Explorer agent | Provides read-only graph-first exploration instructions (Dev package) | `kcoderag-dev/agents/kcode-explorer.md` |

## Pattern Overview

- The marketplace is the composition root; each plugin is independently installable.
- Dev and QA are parallel packages with separate MCP namespace permissions and endpoint configuration files (`kcoderag-dev/.mcp.json`, `kcoderag-qa/.mcp.json`).
- Hooks are advisory and non-blocking. Structural lookup is redirected toward MCP tools, while exact text/local edit searches remain local.
- Runtime behavior is implemented by host plugin systems; this repository contains configuration, prompts, and a standard-library Python hook rather than a server runtime.

## Layers

- Purpose: Declare installable plugin products.
- Location: `.claude-plugin/marketplace.json`
- Contains: Owner, marketplace name, plugin source paths, descriptions.
- Depends on: The two package directories.
- Purpose: Bind each package to its MCP server and host permissions.
- Location: `kcoderag-dev/.mcp.json`, `kcoderag-dev/settings.json`, `kcoderag-qa/.mcp.json`, `kcoderag-qa/settings.json`
- Contains: Environment-specific MCP registration and allow-list namespace.
- Used by: Claude Code/Codex plugin host.
- Purpose: Encode graph-first lookup workflow and tool selection.
- Location: `*/skills/code-lookup-discipline/SKILL.md`, `kcoderag-dev/agents/kcode-explorer.md`
- Contains: Search decision table, fallback rules, and exploration role instructions.
- Used by: Agents operating after plugin installation.
- Purpose: Detect structural search intent and add non-blocking guidance.
- Location: `*/hooks/hooks.json`, `*/hooks/grep_nudge.py`
- Contains: PreToolUse matcher and parser/heuristics for Grep, Glob, Bash, and common shell search commands.
- Used by: Claude Code/Codex hook runner.

## Data Flow

### Plugin Installation and Lookup Guidance

## Key Abstractions

- Purpose: Keep Dev and QA MCP permissions, instructions, hooks, and documentation independently installable.
- Examples: `kcoderag-dev/`, `kcoderag-qa/`
- Pattern: Parallel directory trees with environment-specific names and MCP namespaces.
- Purpose: Classify a local search as symbol/navigation-oriented.
- Examples: `kcoderag-dev/hooks/grep_nudge.py`, `kcoderag-qa/hooks/grep_nudge.py`
- Pattern: Pure functions normalize command input, apply regex/token rules, then produce optional hook JSON.

## Entry Points

- Location: `.claude-plugin/marketplace.json`
- Triggers: `codex plugin marketplace add` or Claude marketplace installation.
- Responsibilities: Resolve `kcoderag-dev` and `kcoderag-qa` source directories.
- Location: `kcoderag-dev/hooks/grep_nudge.py` or `kcoderag-qa/hooks/grep_nudge.py`
- Triggers: Host `PreToolUse` event for `Grep`, `Glob`, or `Bash`.
- Responsibilities: Read JSON stdin, classify lookup patterns, write optional JSON stdout, and fail open.

## Architectural Constraints

- **Runtime ownership:** MCP servers and graph data are external; do not add parser/database behavior to this package repository.
- **Environment isolation:** Dev permissions use the Dev-qualified MCP namespace and QA permissions use the QA-qualified namespace (`kcoderag-dev/settings.json`, `kcoderag-qa/settings.json`).
- **Hook safety:** Hook errors, malformed JSON, and unsupported commands must return success without blocking the user's tool call (`*/hooks/grep_nudge.py`).
- **Secret boundary:** Environment MCP configuration files exist at `kcoderag-dev/.mcp.json` and `kcoderag-qa/.mcp.json`; treat their contents as sensitive and never expose credentials.
- **Duplication boundary:** Dev and QA assets intentionally mirror one another; changes to behavior should be synchronized and tested in both package trees.

## Anti-Patterns

### Treating local grep as the structural source of truth

### Making the hook blocking or stateful

## Error Handling

- `main()` catches malformed input and returns exit code 0 in `*/hooks/grep_nudge.py`.
- `hook_output()` returns `None` for absent or invalid `tool_input`.
- Advisory output is emitted only when a structural lookup heuristic matches.

## Cross-Cutting Concerns

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
