---
status: resolved
trigger: "先对本机 Codex、Claude Code、Cursor 做真实安装验收，收集三个宿主与 doctor 的问题，统一修复后再发布新包"
created: 2026-08-25
updated: 2026-08-26
---

# Debug Session: Real Host Acceptance 0.2.1

## Symptoms

- expected: Public package installs project-scoped QA successfully for Codex, Claude Code, and Cursor in I:\\JX3_SVN\\Head; status/doctor are machine-readable and healthy; Codex/Claude Hooks and Cursor Rule/skill/MCP load in the real hosts.
- actual: Public 0.2.2 and all three project integrations are healthy; the Windows concurrent launcher collision is fixed. The live QA endpoint remains behind the source contract and negotiates 2025-03-26 with content-only tool results.
- errors: Product installation and Hook errors are resolved. Live QA protocol conformance remains pending a separately authorized service deployment.
- timeline: Discovered during Phase 04 real Head acceptance after immutable kcoderag-nav@0.2.0 publication.
- reproduction: Run exact public project-scoped status/doctor/install or update flows for each selected host against I:\\JX3_SVN\\Head, then exercise the installed host-native integration without reading or exposing MCP credential values.

## Current Focus

- bug_class: environment/config plus host contract drift
- hypothesis: nav product resolved; external QA deployment drift confirmed
- test: focused parser regressions, full automated gates, exact project-scoped mutation, real host doctor/launcher/native inventory, and authenticated MCP protocol calls.
- expecting: Codex, Claude Code, and Cursor report healthy project state; Codex/Claude launchers emit valid advisory protocol; Cursor Rule/skill/MCP contract is present; QA initializes, lists tools, and executes search_code without exposing credentials.
- candidate_causes: []
- and_gate: no remaining nav product-code gate; live QA deployment is outside the npm package mutation boundary
- next_action: request explicit authority before rebuilding/restarting the external QA Docker service, then rerun protocol 2025-11-25 initialize/list/call acceptance.
- reasoning_checkpoint: accepted
- tdd_checkpoint: accepted

## Evidence

- timestamp: 2026-08-26
  checked: Windows process ownership after the human reported repeated Python/MCP windows.
  found: Three acceptance-owned uv/mcp-server-time/Python trees were identified by root PID, start time, and ancestry, then terminated recursively; 17 older mcp-server-time services were preserved. Resuming a subagent immediately created another uvx/uv/mcp-server-time/Python tree because subagents inherit the user's global MCP configuration.
  implication: The visible Python processes came from subagent runtime initialization of existing user MCPs, not from the Node-only kcoderag-nav package. Real acceptance must remain sequential and avoid subagents on this configured machine.
- timestamp: 2026-08-26
  checked: Active global Codex GSD hook configuration and launchers.
  found: gsd-context-monitor.cmd was registered across nine lifecycle events even though its output is useful only for PostToolUse; every Windows .cmd launch can flash a console. The active user configuration was narrowed to SessionStart only, removing the high-frequency context monitor while preserving the once-per-session update check.
  implication: Repeated transient command windows were an independent global GSD configuration issue, not a kcoderag-nav hook. The installed GSD generator still needs an upstream durable Windows design; the immediate machine-level mitigation is active.
- timestamp: 2026-08-26
  checked: Secret-safe Claude cleanup and post-cleanup doctor.
  found: With four recoverable user-config backups, Claude's official CLI removed two exact project-scoped kcoderag-qa@kcoderag-nav registrations, exact local kcoderag-qa/dev MCP entries, and the exact kcoderag-nav marketplace. Fresh doctor is healthy/not-installed with only one informational cache residue.
  implication: Every active legacy Claude source is gone without editing or exposing unrelated configuration; installation may proceed.
- timestamp: 2026-08-26
  checked: Fresh fingerprint-bound Codex cleanup plus legacy QA project migration.
  found: The exact sha256 fingerprint authorized native marketplace removal, full rescan, and one transactional update in I:\\JX3_SVN\\Head. Fresh doctor is healthy, state is QA/0.2.0, and both legacy Python hook files are absent from disk and managed state.
  implication: Codex cleanup and Python-to-Node migration satisfy ownership, post-rescan, and project transaction gates.
- timestamp: 2026-08-26
  checked: Real project installation and final doctor matrix for Codex, Claude Code, and Cursor.
  found: Claude and Cursor installed successfully beside Codex. All three doctors report healthy; Claude has one informational cache residue and no conflict. Codex/Claude Windows launchers both exit 0, emit one valid PreToolUse advisory object, and write no stderr. Cursor's QA-only MCP, always-on Rule, and shared skill are present.
  implication: The three host adapters and doctor behavior pass real project acceptance.
- timestamp: 2026-08-26
  checked: Authenticated QA MCP protocol through the installed opaque URL/Header values.
  found: initialize returned 200, initialized notification returned 202, tools/list returned 200 with context/cypher/get_call_chain/list_indexes/search_code/submit_feedback, and search_code returned a successful JSON-RPC result with HTTP 200.
  implication: The installed endpoint and built-in Bearer work end-to-end without exposing either value.
- timestamp: 2026-08-26
  checked: Real Codex and Claude host-native loading boundaries.
  found: Codex mcp list parses kcoderag-qa as enabled streamable_http with bearer_token auth and the Authorization header; its rendered URL and Authorization exactly equal Claude's working connection. Claude stream initialization reports MCP connected and both project hooks successful, but model execution ends in a CLI authentication error. Codex model execution encountered a non-MCP transient error and did not call a tool.
  implication: Host registration/loading is proven for both. Claude's remaining model-call blocker is local CLI login, and Codex's model-run error contains no MCP/auth/protocol/config attribution; neither is a package rendering defect. Direct authenticated MCP and launcher evidence cover the integration contract honestly without claiming model-call PASS.

- timestamp: 2026-08-26
  checked: Human safety report after interrupted real-host acceptance.
  found: Real-host probing opened multiple Python/MCP windows and left descendant processes; only three acceptance-owned uv root trees were externally reclaimed, with pre-existing services preserved.
  implication: All real-host actions are paused. The runner must be diagnosed with isolated fixtures and fixed so Windows windows are hidden and only runner-owned process trees are reclaimed on normal completion, timeout, and exception.
- timestamp: 2026-08-26
  checked: Repository-wide child-process source index and scoped git status.
  found: Existing Codex/Claude adapter edits and tests remain modified as expected. Both native runners call execFile with timeout and windowsHide; the acceptance smoke path calls spawnSync with timeout and windowsHide. The live Codex probe includes ignore-user-config, while the live Claude probe does not visibly include an equivalent user-MCP isolation flag.
  implication: windowsHide is already present but process-tree ownership is not evident from the call sites. Read the full abstractions and tests before concluding whether normal/timeout/exception cleanup is absent and whether the live Claude mode can avoid user MCP startup.

- timestamp: 2026-08-25
  checked: Repository status and public CLI documentation/source index.
  found: The repository already contains user-owned dirty planning state; package.json remains version 0.2.0; documented read-only syntax is `npx kcoderag-nav@latest status|doctor --host <host> --target <path> --json`, and source shows doctor selects deep scanning while status selects fast scanning.
  implication: Preserve all unrelated planning changes. The status/doctor differential can isolate the failing deep-scan path without mutating I:\\JX3_SVN\\Head.
- timestamp: 2026-08-25
  checked: Complete src/cli/commands.cts and src/hosts/user-sources.cts.
  found: Read-only commands wrap the entire parse/detect/scan/status path in a catch that writes one safe JSON object whenever `--json` is present. Doctor differs from status only by requesting source-scan mode `deep`; the shared finding constructors reject secret-like strings and output only normalized safe metadata.
  implication: A reproducible exit 1 with zero stdout cannot be explained by an ordinary thrown adapter error inside executeCommand; inspect the bin/bootstrap and process-level behavior next.
- timestamp: 2026-08-25
  checked: Local executable/version metadata and exact public 0.2.0 status/doctor matrix for Codex, Claude Code, and Cursor.
  found: Node v24.14.0; Codex 0.146.1, Claude Code 2.1.241, and Cursor 3.17.8 are all executable. All six public commands exited 1 with stdoutBytes=0, stderrBytes=139, no parsed JSON, identical across hosts and status/doctor.
  implication: The failure is shared and occurs before host-specific fast/deep scan divergence. Adapter-specific doctor hypotheses are not yet testable through the standard public invocation.
- timestamp: 2026-08-25
  checked: Fixed-pattern classification, npm registry metadata, and explicit npm-exec comparison.
  found: Registry metadata resolves kcoderag-nav 0.2.0 with the expected `kcoderag-nav` bin and Node >=22 contract. Normal npx and explicit npm exec still produce the same 139-byte unclassified stderr with no stdout when routed through the current cmd wrapper.
  implication: The published manifest is present and structurally correct. Differentiate a wrapper quoting artifact from package acquisition/bootstrap before attributing this to product code.
- timestamp: 2026-08-25
  checked: Direct npx.cmd, PowerShell, and unquoted cmd invocation routes.
  found: Direct execution of npx.cmd is unsupported by Node spawn on this Windows host (EINVAL), while both PowerShell and cmd routes reproduce the identical 139-byte stderr and empty stdout.
  implication: Shell target quoting is eliminated. The failure belongs to npx/package startup or the published payload, not the probe wrapper.
- timestamp: 2026-08-25
  checked: Immutable public tarball acquisition, direct published-bin execution, and local-bin comparison.
  found: `npm pack kcoderag-nav@0.2.0` succeeds and contains 48 files. Both the extracted public bin and local dist return the same parseable Codex status JSON: exit 1, `source_conflict`, issue `legacy_migration_available`, finding `source_scan_unavailable`. Only default npx execution produces the two-line 139-byte non-JSON stderr.
  implication: Published payload startup is healthy when invoked directly. The npx failure is an environment/acquisition-path branch, while the Codex source capability failure is a separate product/host-compatibility branch.
- timestamp: 2026-08-25
  checked: Debug knowledge base, common-pattern map, SBFL preconditions, and bug taxonomy.
  found: No project debug knowledge base exists. Failures reproduce deterministically, so class is Bohrbug; matching common categories are Environment/Config and Error Handling. SBFL is skipped because there is no failing regression test with per-test coverage yet.
  implication: Route first through deterministic differential reproduction, then add focused failing tests once the fault sites are known.
- timestamp: 2026-08-25
  checked: Exact public 0.2.0 npx status with a fresh isolated npm cache.
  found: Fresh-cache execution reproduces the identical exit 1, stdoutBytes=0, stderrBytes=139, two-line failure.
  implication: Default cache corruption is eliminated. Focus the environment branch on npm/npx shim generation or argument routing.
- timestamp: 2026-08-25
  checked: Non-secret stderr structure and public/local bin metadata.
  found: The two stderr lines are non-ASCII localized text; the first contains quoted `kcoderag-nav`, one space, and no path/URL, while the second contains no spaces. This structurally matches Windows' two-line “command is not recognized / not executable or batch file” message. The bin has a valid Node shebang; the immutable tarball records it at mode 0644 and direct Node invocation works.
  implication: The package JS is not starting through npx. Trace which npx implementation is resolved and whether it creates/uses the package bin shim correctly.
- timestamp: 2026-08-25
  checked: All resolved npx/npm/node executables and explicit candidate execution.
  found: There is exactly one Node installation at C:\\Program Files\\nodejs. Both npx and npm resolve only to its extensionless launcher and `.cmd` companion; there is no shadow executable. Explicit canonical npx.cmd and npm.cmd execution still fails before JSON.
  implication: Shadowed PATH resolution is eliminated. Inspect npm exec's isolated installation tree and bin-link creation.
- timestamp: 2026-08-25
  checked: npm/npx configuration and isolated cache tree after source-repo-cwd failure.
  found: Node 24.14.0 with npm/npx 11.9.0 and bin-links=true. After failure the isolated cache contains only two files and no kcoderag-nav payload or `.bin` shim.
  implication: npm did not acquire the package at all. Because cwd is the local kcoderag-nav 0.2.0 repository, test the matching-local-package shortcut as the specific cause.
- timestamp: 2026-08-25
  checked: Counterfactual npx execution with only cwd changed to I:\\JX3_SVN\\Head.
  found: Exact public 0.2.0 immediately returns parseable Codex status JSON (source_conflict, legacy_migration_available, source_scan_unavailable) from the real target cwd.
  implication: The original empty-stdout public-command symptom was caused by npm's matching-local-package shortcut in the source-repo cwd, not by kcoderag-nav startup. All real acceptance commands must run with cwd at the target project.
- timestamp: 2026-08-25
  checked: Exact public 0.2.0 status/doctor matrix from the real target cwd.
  found: Codex status and doctor both report source_conflict with legacy_migration_available plus source_scan_unavailable. Claude status reports raw_mcp_source, source_scan_unavailable, and manual_hook_source; doctor adds two informational cache_residue findings. Cursor status and doctor both return ok=true, not_installed, with no findings.
  implication: Cursor's read-only adapter is healthy. Codex/Claude share a native capability-probe failure; Claude also has user-owned manual conflicts that cannot be auto-cleaned and must remain outside code mutation.
- timestamp: 2026-08-25
  checked: Codex/Claude adapter source-scan implementations and focused tests.
  found: Fast mode checks strict version then always runs native plugin and marketplace JSON inventory; deep/gate additionally requires four help commands with exact flags. Tests synthesize Codex plugin JSON as `{installed,available}` plus `{marketplaces}` and Claude JSON as exact arrays with fixed field sets, but no real-host fixture/evidence test exists.
  implication: The code can fail closed at version, help, command execution, or strict schema parsing. Probe those exact stages against the installed CLIs before changing policy.
- timestamp: 2026-08-25
  checked: Metadata-only real native capability probe.
  found: Both hosts' version and all four help predicates pass exactly. Codex plugin and marketplace inventory commands both exit 1 with no stdout. Claude inventory commands exit 0 and parse as arrays (7 plugins, 3 marketplaces) but both fail the adapter's exact item-schema contracts.
  implication: Codex fails at native inventory execution, not capability/help. Claude fails at strict schema parsing, confirming a real contract-drift code bug.
- timestamp: 2026-08-25
  checked: Codex actual failure attribution and degraded-path counterfactual.
  found: Both failing inventory stderr bodies satisfy the adapter's marketplace_load attribution regex. With identical real metadata but injected attributed failures, degraded cleanup still returns only source_scan_unavailable and no plan; no raw/manual/ambiguous metadata finding is present.
  implication: Failure attribution is correct. The missing gate is exact registration presence or its `exclusiveUserMarketplace` flag; distinguish those with a healthy empty inventory.
- timestamp: 2026-08-25
  checked: Codex healthy-empty-inventory counterfactual with the real metadata reader.
  found: The scanner returns ambiguous_source, proving one exact recognized kcoderag-nav registration exists. Since attributed inventory failure produced no raw/manual/ambiguous metadata findings yet no degraded plan, the remaining condition is `exclusiveUserMarketplace === false` because unrelated marketplaces coexist.
  implication: Codex root cause is the over-broad global exclusivity gate; exact-name cleanup is blocked solely by unrelated marketplace coexistence despite exact owned provenance and stderr attribution.
- timestamp: 2026-08-25
  checked: Claude Code 2.1.241 real inventory field/type signatures.
  found: Five plugin entries match the expected fields; two valid entries add `projectPath:string` and `mcpServers:object`. Two marketplace entries match; one valid entry uses `url:string` instead of `repo:string`. The parser rejects all inventory if any one entry has either variant.
  implication: Claude root cause is exact-key schema intolerance. Accept only these observed optional/alternative bounded shapes while continuing to discard their values from findings and plans.
- timestamp: 2026-08-25
  checked: Agent-authored regression tests against unchanged source.
  found: Build succeeds; 29 neighboring host tests pass; both new tests fail at cleanupPlans length 0 versus expected 1, exactly reproducing the Codex exclusivity and Claude schema-rejection mechanisms.
  implication: RED state is established with derived-contract oracles and minimal boolean/schema boundary neighbors; apply targeted source fixes.
- timestamp: 2026-08-25
  checked: Targeted source fixes and Codex/Claude neighboring host suites.
  found: Build succeeds and all 31 host tests pass, including both new regressions and the prior 29 tests. The Claude sentinel remains absent from scan serialization.
  implication: Target tests are GREEN and immediate neighbors show no regression; proceed through remaining guardrail signals.
- timestamp: 2026-08-25
  checked: Scoped source/test diff and no-op/deletion guard.
  found: Four tracked files changed; source delta is 19 additions/8 removals in Claude and one predicate removal in Codex, with additive tests. No behavior is short-circuited or deleted; ignored metadata remains bounded and discarded.
  implication: no_op_deletion signal passes. Add invalid boundary neighbors before broader regression testing.
- timestamp: 2026-08-25
  checked: Hardened Codex/Claude target and boundary-neighbor suites.
  found: All 32 tests pass. Valid real Claude variants are accepted; non-string projectPath, non-record mcpServers, and simultaneous repo+url remain source_scan_unavailable and leak no sentinel.
  implication: Target oracle and adjacent schema boundaries pass; run the full suite.
- timestamp: 2026-08-25
  checked: Full compiled project test suite.
  found: All 283 tests pass with zero failures in 130.6 seconds, including lifecycle, transaction, source safety, packaging, release, and smoke acquisition coverage.
  implication: adjacent_tests signal passes; run revert-and-reconfirm before accepting the fix.
- timestamp: 2026-08-25
  checked: Revert half of revert-and-reconfirm with regression tests retained.
  found: Reversing only the source fixes restores exactly the two target failures (cleanupPlans 0 instead of 1); the other 30 host tests, including malformed boundary neighbors, remain green.
  implication: Both code changes are causally necessary for their regressions; reapply to complete the guardrail signal.
- timestamp: 2026-08-25
  checked: Reapply half of revert-and-reconfirm.
  found: Reapplying only the two source fixes restores all 32 Codex/Claude host tests to green.
  implication: revert_and_reconfirm signal passes with bug_returned_on_revert=true and fixed_on_reapply=true.
- timestamp: 2026-08-25
  checked: Real-target read-only matrix through the fixed local build.
  found: Codex doctor now reports owned_marketplace_source with cleanupEligible=true and a fingerprint; Cursor remains clean/not_installed. Claude still reports source_scan_unavailable alongside the genuine raw_mcp_source and manual_hook_source, so the first schema fix is incomplete for real data.
  implication: Codex real symptom is fixed, but Claude verification fails. Return to investigation and locate the remaining value-level parser mismatch.
- timestamp: 2026-08-25
  checked: Every Claude plugin/marketplace parser predicate over real inventory, reported as counts only.
  found: All item field, type, bounded-string, scope-enum, optional metadata, and marketplace-shape predicates pass. Seven plugin rows contain six unique ids and six unique id+scope pairs; the parser rejects solely at global id uniqueness. Marketplaces have three valid unique names.
  implication: Test whether the duplicate id represents distinct project/install instances; if so, uniqueness must be keyed by installation identity rather than plugin id alone.
- timestamp: 2026-08-25
  checked: Claude composite uniqueness counts over the real seven-row inventory.
  found: id, id+scope, and id+scope+installPath each have six unique values, while id+scope+projectPath and preferred projectPath identity each have seven.
  implication: The duplicate is one project-scoped plugin installed in two distinct projects sharing an install cache path. Use projectPath to distinguish instances and retain exact-duplicate rejection.
- timestamp: 2026-08-25
  checked: Agent-authored distinct-project and exact-duplicate regressions against current source.
  found: Sixteen Claude tests pass; only the distinct-project test is RED because hasConflict remains true. The exact same-project duplicate remains fail-closed.
  implication: The regression isolates the global uniqueness predicate; implement composite installation identity.
- timestamp: 2026-08-25
  checked: Composite hashed installation identity fix and Claude host suite.
  found: All 17 Claude tests pass, including distinct-project acceptance and exact same-project duplicate rejection.
  implication: Re-run the real host matrix to verify the previously surviving source_scan_unavailable is gone.
- timestamp: 2026-08-25
  checked: Real-target Claude status/doctor through the composite parser fix.
  found: source_scan_unavailable is gone. Status/doctor retain raw_mcp_source, manual_hook_source, and ambiguous_source; doctor also reports two informational cache residues.
  implication: Parser compatibility is fixed. Determine whether ambiguous_source is intentional identity protection or another adapter mismatch before final verification.
- timestamp: 2026-08-25
  checked: Safe identity counts for the remaining Claude ambiguous_source.
  found: Two KCodeRag-related plugin rows are both exact owned identities, both active, and one exact owned marketplace exists; no ownership predicate fails.
  implication: ambiguous_source is intentional multi-active-source protection, not a parser defect. It requires human cleanup under the single exact-plan policy.
- timestamp: 2026-08-25
  checked: Focused revert of Claude composite uniqueness with regressions retained.
  found: The distinct-project regression returns to RED (hasConflict true versus false) when uniqueness-by-id is restored.
  implication: The composite uniqueness hunk is causally required; reapply it to complete revert-and-reconfirm.
- timestamp: 2026-08-25
  checked: Reapplied complete source fixes and both host suites.
  found: All 33 Codex/Claude tests pass after reapply.
  implication: Complete revert_and_reconfirm passes for all current source hunks; run final automated gates.
- timestamp: 2026-08-25
  checked: Final automated verification gates.
  found: Full suite passes 284/284; dependency audit, generation check, pack audit (48 entries), docs check, and required-contract smoke all PASS for Codex, Claude, and Cursor.
  implication: Automated fix-acceptance signals pass. Mutation testing is unavailable because no Stryker package/config exists; record a transparent skip and proceed to the human-action boundary.
- timestamp: 2026-08-25
  checked: Final path/code-only real doctor summaries and scoped repository status.
  found: Codex reports one fingerprinted cleanup-eligible owned_marketplace_source at .codex/config.toml plus legacy_migration_available; Claude reports manual-only raw_mcp_source at .claude.json, manual_hook_source at .claude/settings.json, ambiguous_source at .claude/plugins, and two informational cache residues; Cursor is healthy and not_installed. Repository changes remain the four authored tracked code/test files plus pre-existing user-owned planning state.
  implication: The code fixes are accepted, but real acceptance cannot proceed safely until the user handles Claude's manual/ambiguous sources and explicitly authorizes a freshly rescanned Codex cleanup and project mutation.
- timestamp: 2026-08-26
  checked: Human checkpoint response for real-host cleanup and project mutation.
  found: The user explicitly authorized exact KCodeRag-only Claude source removal, fresh fingerprint-bound Codex owned-source cleanup, and subsequent project-scoped Codex/Claude/Cursor mutations in I:\\JX3_SVN\\Head, with recoverable backups, exact ownership, and fail-closed ambiguity handling.
  implication: Resume at secret-safe preflight and execute the already-authorized cleanup/acceptance workflow; publication remains a separate irreversible checkpoint.
- timestamp: 2026-08-26
  checked: Secret-safe path/type and repository-boundary preflight.
  found: The four exact user-source paths are ordinary non-link files/directories; I:\\JX3_SVN\\Head resolves exactly and is not a Git worktree; the nav repository still contains only the four authored code/test edits plus pre-existing user-owned planning dirtiness.
  implication: No symlink/special-file or repository-overwrite hazard is present, but Claude cleanup must preserve unrelated JSON/plugin state and the target acceptance must treat the SVN working copy as user-owned dirty state.
- timestamp: 2026-08-26
  checked: Claude user-source classifier and native cleanup authority implementation.
  found: Raw MCP detection is limited to exact KCodeRag-family keys under mcpServers; Hook detection is limited to KCodeRag signatures under hooks; native plugin identities must be exact name@kcoderag-nav with bounded scope, and the CLI permits only one freshly issued exact cleanup plan followed by a complete rescan.
  implication: Manual JSON cleanup can be restricted to exact MCP keys and exact KCodeRag Hook objects, while plugin cleanup must use the observed exact id/scope pairs and preserve every unrelated registry entry.
- timestamp: 2026-08-26
  checked: Claude plugin registry topology and value-silent native inventory summary.
  found: Registry files are ordinary files; exactly two enabled exact-owned kcoderag-qa@kcoderag-nav registrations exist, both project-scoped, plus exactly one kcoderag-nav marketplace. KCodeRag cache/data/marketplace directories exist, while five unrelated plugins and two unrelated marketplaces coexist.
  implication: Cleanup must execute the exact project-scoped uninstall once from each distinct registered project before removing the exact marketplace; whole-directory deletion is unsafe and prohibited.
- timestamp: 2026-08-26
  checked: Exact-owned project-root and direct JSON candidate classification.
  found: The two Claude registrations belong to two distinct ordinary project directories and one is the Head target. No direct top-level exact KCodeRag MCP key or top-level Hook child signature remains in the two user JSON files.
  implication: The earlier manual findings may have changed or may be nested elsewhere in the bounded JSON documents; obtain a fresh adapter doctor result before choosing any manual edit.
- timestamp: 2026-08-26
  checked: Fresh fixed-build doctor matrix from I:\\JX3_SVN\\Head.
  found: Claude still has raw_mcp_source at .claude.json, manual_hook_source at .claude/settings.json, and ambiguous_source at .claude/plugins; Codex exposes one fresh exact cleanup-eligible marketplace plan with fingerprint sha256:adde494eb44f2d7806f0de92a41048340b00d1821377c1b382c1ff38ad293cde plus exact legacy migration; Cursor remains clean and not installed.
  implication: JSON matches are nested rather than absent. Preserve the fresh Codex fingerprint but do not execute it until Claude manual cleanup removes every non-eligible conflict.
- timestamp: 2026-08-26
  checked: Structural candidate classification for the two manual Claude JSON findings.
  found: .claude.json contains exactly one object-only mcpServers container at a hashed depth-two location with exact keys kcoderag-dev and kcoderag-qa; no unsupported array path exists. In settings.json, no Hook entry or Hook child structurally contains any classifier signature, despite doctor reporting manual_hook_source.
  implication: Raw MCP cleanup is exact and safe, but settings deletion would be unsupported. Investigate a likely cross-object regex false positive before any mutation.
- timestamp: 2026-08-26
  checked: Hashed JSON-path attribution for every KCodeRag signature in settings.json.
  found: The actual top-level hooks subtree has seven event arrays and zero KCodeRag signatures. Exactly two signatures exist elsewhere: one KCodeRag-named setting key and one nested repo string value, both outside hooks ancestry; the current lexical classifier nevertheless reports manual_hook_source.
  implication: The hypothesis is confirmed: containsKCodeRagHookSignature crosses the closing hooks object and misclassifies unrelated non-hook configuration. Fix the classifier before cleanup so unrelated settings remain untouched.
- timestamp: 2026-08-26
  checked: Agent-authored cross-boundary Hook classifier regression against unchanged source.
  found: Build succeeds and 17 neighboring Claude tests pass; the new valid-JSON test alone is RED because an unrelated KCodeRag setting after hooks makes hasConflict true.
  implication: The deterministic regression reproduces the exact real mechanism with a derived-contract oracle; apply the minimal structural-boundary fix.
- timestamp: 2026-08-26
  checked: Parse-first hooks-subtree classifier fix and focused Claude suite.
  found: All 18 Claude tests pass; the cross-boundary fixture is now clean while all prior inventory, source-safety, lifecycle, and transaction tests remain green.
  implication: Target test is GREEN. Add the positive Hook neighbor to prove the classifier still detects a true structurally nested source before broader verification.
- timestamp: 2026-08-26
  checked: Positive structural Hook boundary neighbor.
  found: All 18 Claude tests pass after extending the regression: out-of-hooks KCodeRag settings remain clean, while an exact KCodeRag command nested under hooks.PreToolUse still emits manual_hook_source.
  implication: The fix narrows only the false-positive boundary and preserves true Hook detection; verify against the real settings document.
- timestamp: 2026-08-26
  checked: Public 0.2.2 exact/latest artifact, CI/Release, and Head three-host update.
  found: Exact and latest resolve to the same 0.2.2 Registry artifact; both public three-host lifecycle smokes pass. Linux/Windows on Node 22/24 CI and Release pass, and Head Codex, Claude, and Cursor doctors are healthy at project-scoped QA version 0.2.2.
  implication: npm acquisition, project ownership, QA-only lifecycle, and host registration are complete for 0.2.2.
- timestamp: 2026-08-26
  checked: Real simultaneous Codex and Claude Windows launchers from a deep Head directory.
  found: The 0.2.1 shared `%RANDOM%` stdout file collided under concurrent cmd startup. Version 0.2.2 atomically allocates an exclusive temporary directory; both real launchers now exit 0 with valid advisory JSON and zero stderr bytes.
  implication: The launcher concurrency defect and its visible file-in-use noise are resolved without weakening fail-open buffering.
- timestamp: 2026-08-26
  checked: Authenticated live QA protocol using requested revision 2025-11-25 and opaque installed credentials.
  found: The endpoint returns initialize protocolVersion 2025-03-26 and content-only tool results. It lists the six expected tools and returns HTTP 200 without JSON-RPC error, but omits structuredContent and isError required by current KCodeRag source.
  implication: This is external QA deployment drift, not a nav rendering failure. Live protocol acceptance is not PASS until the current service source is deployed and retested.

## Eliminated

- hypothesis: Stale or corrupt default npm exec cache causes the public npx failure.
  evidence: A newly created isolated npm cache reproduced the identical two-line 139-byte failure.
  timestamp: 2026-08-25
- hypothesis: A shadow npx executable earlier on PATH invokes the wrong package manager.
  evidence: `where` finds only the active Node installation's canonical npx/npm launchers; invoking those exact `.cmd` paths still fails.
  timestamp: 2026-08-25
- hypothesis: The public tarball's 0644 bin mode prevents npm from creating or executing its Windows shim.
  evidence: With the same public package and npm version, changing only cwd to the real target produces valid CLI JSON; the tarball bin also runs directly under Node.
  timestamp: 2026-08-25
- hypothesis: Codex source_scan_unavailable is caused by a missing or unrecognized owned registration.
  evidence: With successful empty inventories, the real metadata reader yields ambiguous_source, which only occurs here when the exact registration exists but native marketplace inventory omits it.
  timestamp: 2026-08-25

## Resolution

- root_cause:
  - "Environment: running npx from the matching kcoderag-nav 0.2.0 source repo makes npm 11.9 skip acquisition and then miss the root package bin; target cwd avoids it."
  - "Codex code + data: degraded cleanup requires exclusiveUserMarketplace although exact owned kcoderag-nav registration coexists safely with unrelated marketplaces."
  - "Claude code + data: exact-key parsing rejects valid 2.1.241 projectPath/mcpServers and URL marketplace shapes, and global id uniqueness conflates distinct project-scoped instances."
- fix:
  - "Codex degraded cleanup no longer requires unrelated marketplace exclusivity after exact provenance, exact attribution, clean metadata, fingerprint authority, and post-rescan gates already pass."
  - "Claude parsers accept only bounded `projectPath`/record `mcpServers` metadata and exactly one of the bounded repo or URL marketplace shapes, while discarding those values."
  - "Claude inventory uniqueness uses a non-exported hash of id, scope, and projectPath so distinct projects are accepted while exact same-project duplicates still fail closed."
- verification:
    target_test:
      result: pass
      evidence: "All 33 focused Codex/Claude host tests pass, including valid real-schema/coexistence cases and malformed boundary neighbors."
    mutation_check:
      result: skipped
      reason_if_skipped: "No Stryker dependency or configuration exists in the project."
    no_op_deletion:
      result: pass
      evidence: "Scoped diff is targeted and additive; no source gate is short-circuited, and all newly accepted metadata remains bounded and discarded."
    adjacent_tests:
      result: pass
      evidence: "Full test suite passes 284/284; dependency audit, generation, pack audit, docs check, and required-contract smoke all pass."
    revert_and_reconfirm:
      result: pass
      bug_returned_on_revert: true
      fixed_on_reapply: true
      evidence: "Reverting each source fix restored only its focused regression; reapplying restored all 33 focused tests."
    guardrail_verdict: accepted
    real_environment:
      result: partial
      evidence: "Exact legacy sources were removed with recoverable backups; Codex, Claude, and Cursor are installed project-scoped at public 0.2.2 in I:\\JX3_SVN\\Head and all report healthy. Concurrent Codex/Claude launchers, Cursor assets, and native registration discovery pass. Authenticated live QA lists the expected tools but fails the current 2025-11-25/structuredContent contract because the deployed service is stale."
- files_changed:
  - src/hosts/codex.cts
  - src/hosts/claude.cts
  - tests/hosts/codex.test.cts
  - tests/hosts/claude.test.cts
  - plugin-src/hooks/run_hook.cmd
  - kcoderag-qa/hooks/run_hook.cmd
  - tests/hooks/launcher.test.cts
- oracle_type: derived
