# Codebase Concerns

**Analysis Date:** 2026-08-20

## Tech Debt

**Duplicated environment plugins:**
- Issue: Dev and QA ship near-identical copies of the hook, tests, skill, hook registration, and MCP manifest.
- Files: `kcoderag-dev/hooks/grep_nudge.py`, `kcoderag-qa/hooks/grep_nudge.py`, `kcoderag-dev/hooks/test_grep_nudge.py`, `kcoderag-qa/hooks/test_grep_nudge.py`
- Impact: Bug fixes and heuristic changes can drift between environments; every change must be reviewed twice.
- Fix approach: Extract shared hook/test assets or generate the two environment packages from one source, leaving only endpoint/name/theme metadata environment-specific.

**Hard-coded plugin runtime configuration:**
- Issue: Hook registration embeds a Windows-specific `PLUGIN_ROOT` lookup and a separate Unix `$CLAUDE_PLUGIN_ROOT` command.
- Files: `kcoderag-dev/hooks/hooks.json`, `kcoderag-qa/hooks/hooks.json`
- Impact: Installation hosts that provide only one of these variables can silently skip the hook; failures are fail-open and therefore difficult to notice.
- Fix approach: Validate the plugin host contract in installation tests and use one documented, host-supported root variable per runtime.

## Known Bugs

**Hook command parser has incomplete shell coverage:**
- Symptoms: `shell_lookup_patterns` recognizes a fixed list of commands/options and tokenizes with a deliberately simple regex; aliases, pipelines, PowerShell parameter forms, and nested quoting can be classified incorrectly.
- Files: `kcoderag-dev/hooks/grep_nudge.py`, `kcoderag-qa/hooks/grep_nudge.py`
- Trigger: Use an unsupported search alias or command form, or place the search expression behind shell syntax not covered by `SHELL_WRAPPER_OPTIONS`.
- Workaround: Use the explicitly tested `rg`, `grep`, `git grep`, `findstr`, or `Select-String` forms.

## Security Considerations

**Bearer credentials bundled in plugin manifests:**
- Risk: MCP manifests contain a shared bearer token and an internal HTTP endpoint; distributing or committing the plugin exposes a reusable credential and permits network interception.
- Files: `kcoderag-dev/.mcp.json`, `kcoderag-qa/.mcp.json`, `kcoderag-dev/README.md`, `kcoderag-qa/README.md`
- Current mitigation: The README identifies the endpoint as internal and the plugin advertises read capability, but the credential remains client-side and transport is HTTP.
- Recommendations: Inject tokens at install/runtime, rotate any exposed credentials, use HTTPS with certificate validation, and avoid documenting credentials as bundled installation behavior.

**Untrusted hook input handling:**
- Risk: Hook input is read from stdin and echoed into advisory decisions; although output is JSON and exceptions fail open, oversized or adversarial regex-like strings can consume hook time.
- Files: `kcoderag-dev/hooks/grep_nudge.py`, `kcoderag-qa/hooks/grep_nudge.py`
- Current mitigation: A 65,536-character command limit and an adversarial timing regression test exist.
- Recommendations: Bound pattern length independently, keep regexes linear-time, and add fuzz/property tests around all parser entry points.

## Performance Bottlenecks

**Per-tool invocation process startup:**
- Problem: Every matching PreToolUse event launches a new Python interpreter and imports the hook module.
- Files: `kcoderag-dev/hooks/hooks.json`, `kcoderag-qa/hooks/hooks.json`, `kcoderag-dev/hooks/grep_nudge.py`
- Cause: The integration is command-based rather than a resident process; matching `Bash` broadens invocation frequency.
- Improvement path: Keep the hook lightweight, measure p95 latency on Windows and Unix, and narrow the matcher or use a supported long-lived hook mechanism if startup becomes user-visible.

## Fragile Areas

**Heuristic symbol classification:**
- Files: `kcoderag-dev/hooks/grep_nudge.py`, `kcoderag-qa/hooks/grep_nudge.py`
- Why fragile: A small allow/deny vocabulary (`NON_SYMBOL`, `SILENT_RES`, `KEYWORDS`) determines whether local search is nudged; repository-specific identifiers and language syntax can produce false positives or negatives.
- Safe modification: Add paired positive/negative cases to both `test_grep_nudge.py` files, including the exact host payload shape, before changing heuristics.
- Test coverage: Unit-like cases cover common patterns and one timing guard, but do not cover exhaustive command grammar, Unicode edge cases, or fuzzing.

**Dual-host hook contract:**
- Files: `kcoderag-dev/hooks/hooks.json`, `kcoderag-qa/hooks/hooks.json`, `kcoderag-dev/hooks/test_grep_nudge.py`, `kcoderag-qa/hooks/test_grep_nudge.py`
- Why fragile: Claude and Codex payloads, matcher names, environment variable names, and output schema are coupled across JSON and Python without a schema validation test.
- Safe modification: Add fixture-driven contract tests for each host and validate manifests before publishing either plugin.
- Test coverage: No repository-level install/manifest smoke test is present.

## Scaling Limits

**Plugin distribution and endpoint coupling:**
- Current capacity: Each installed plugin points directly to one fixed Dev or QA MCP URL and shared credential.
- Limit: Network reachability, endpoint availability, and token rotation affect every installation simultaneously; there is no local fallback or endpoint discovery.
- Scaling path: Introduce environment-scoped configuration with health checks, token rotation, and an explicit unavailable-service UX.

## Dependencies at Risk

**Host hook environment contract:**
- Risk: Behavior depends on Claude Code/Codex hook event names and environment variables that are not version-pinned in this repository.
- Impact: Host upgrades can stop hook execution or change payload schemas without a failing project test.
- Migration plan: Maintain a versioned compatibility matrix and run smoke tests against supported host versions before release.

## Missing Critical Features

**Automated packaging/release validation:**
- Problem: No visible build or CI configuration validates JSON manifests, plugin paths, executable hooks, or parity between Dev and QA.
- Blocks: Regressions can reach users through marketplace installation even when Python tests pass locally.

## Test Coverage Gaps

**Installation and integration path:**
- What's not tested: Marketplace discovery, plugin installation, MCP connection/authentication, hook execution from the actual host, and endpoint TLS behavior.
- Files: `.claude-plugin/marketplace.json`, `kcoderag-dev/.codex-plugin/plugin.json`, `kcoderag-qa/.codex-plugin/plugin.json`, `kcoderag-dev/.mcp.json`, `kcoderag-qa/.mcp.json`
- Risk: Broken paths, incompatible manifest schema, unavailable network services, and credential failures remain undetected until installation/runtime.
- Priority: High

**Cross-environment parity:**
- What's not tested: A single test suite running the same cases against both plugin copies and asserting identical hook behavior.
- Files: `kcoderag-dev/hooks/test_grep_nudge.py`, `kcoderag-qa/hooks/test_grep_nudge.py`
- Risk: Dev and QA can silently diverge in advisory behavior or security handling.
- Priority: Medium

---

*Concerns audit: 2026-08-20*
