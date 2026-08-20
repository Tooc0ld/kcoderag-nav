# Technology Stack

**Analysis Date:** 2026-08-20

## Languages

**Primary:**
- Python 3 - `kcoderag-dev/hooks/grep_nudge.py` and `kcoderag-qa/hooks/grep_nudge.py` implement the cross-host lookup hook and use only the standard library.
- JSON - plugin manifests, marketplace metadata, permissions, and hook registration in `.claude-plugin/marketplace.json`, `kcoderag-dev/.codex-plugin/plugin.json`, `kcoderag-qa/.codex-plugin/plugin.json`, `kcoderag-dev/settings.json`, and `kcoderag-qa/settings.json`.

**Secondary:**
- Markdown - human-facing plugin documentation and skill instructions in `kcoderag-dev/` and `kcoderag-qa/`.

## Runtime

**Environment:**
- Python 3.x; the hook is launched by Claude Code/Codex through the configured `python` command. No Python version pin is present.
- Claude Code and Codex plugin hosts provide the lifecycle, tool payload, and MCP execution environment.

**Package Manager:**
- Not detected; no `pyproject.toml`, `requirements*.txt`, `uv.lock`, `package.json`, or other application package manifest is present.
- Lockfile: missing/not applicable.

## Frameworks

**Core:**
- Model Context Protocol (MCP) - external KCodeRag Dev/QA servers are registered by each plugin's `.mcp.json` (file existence noted; contents are not read because it may contain credentials).
- Claude Code/Codex plugin interfaces - manifests in `kcoderag-dev/.codex-plugin/plugin.json`, `kcoderag-qa/.codex-plugin/plugin.json`, and `.claude-plugin/marketplace.json`.

**Testing:**
- Python standard-library test scripts in `kcoderag-dev/hooks/test_grep_nudge.py` and `kcoderag-qa/hooks/test_grep_nudge.py`; no pytest configuration or dependency was detected.

**Build/Dev:**
- None detected. Installation is performed with `codex plugin marketplace add` / `codex plugin add` or Claude Code marketplace commands documented in the READMEs.

## Key Dependencies

**Critical:**
- Python standard library (`json`, `re`, `subprocess`, `typing`, and related modules) - implements parsing, heuristic classification, JSON hook output, and self-tests without third-party packages (`kcoderag-dev/hooks/grep_nudge.py`).
- KCodeRag MCP service - supplies `search_code`, `context`, `get_call_chain`, `list_indexes`, `cypher`, and `submit_feedback` as described in `kcoderag-dev/README.md` and `kcoderag-qa/README.md`.

**Infrastructure:**
- Claude Code/Codex hook runtime - invokes `PreToolUse` handlers configured in `kcoderag-dev/hooks/hooks.json` and `kcoderag-qa/hooks/hooks.json`.

## Configuration

**Environment:**
- Plugin-local MCP connection/auth configuration is declared in `kcoderag-dev/.mcp.json` and `kcoderag-qa/.mcp.json` (contents intentionally not inspected).
- Host permissions allow the plugin MCP namespace through `kcoderag-dev/settings.json` and `kcoderag-qa/settings.json`.
- Hook launch uses `CLAUDE_PLUGIN_ROOT` on Unix-like hosts and `PLUGIN_ROOT` in the Windows command in both `hooks.json` files.

**Build:**
- Marketplace metadata: `.claude-plugin/marketplace.json`.
- Codex plugin manifests: `kcoderag-dev/.codex-plugin/plugin.json`, `kcoderag-qa/.codex-plugin/plugin.json`.
- No compile or bundling configuration detected.

## Platform Requirements

**Development:**
- A Claude Code or Codex installation with plugin marketplace support.
- Python available as `python` for hook execution.

**Production:**
- Access to the internal Dev or QA network and its corresponding KCodeRag MCP endpoint; README states the endpoints are intended for their respective internal networks (`kcoderag-dev/README.md`, `kcoderag-qa/README.md`).

---

*Stack analysis: 2026-08-20*
