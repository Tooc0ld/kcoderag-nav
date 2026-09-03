---
status: investigating
trigger: "排查修复"
created: 2026-08-27
updated: 2026-08-27
---

# Debug Session: Codex Hook and MCP Protocol

## Symptoms

- expected: A trusted Codex project installed with `kcoderag-navigation` receives model-visible advisory context when the real host executes a structural local `rg`, can call the project `kcoderag-qa` `search_code` tool successfully, and records one bounded PostToolUse success marker. Public `kcoderag-nav@latest` exposes the documented capability-aware CLI.
- actual: The local working-tree package installs, reports healthy, updates idempotently, and uninstalls cleanly. Real Codex executes local `rg` but reports no dynamic KCodeRag hint. Codex 0.146.1 and an ephemeral 0.150.1 both fail MCP initialization before `search_code`, so no success marker is created. Public `kcoderag-nav@latest` resolves to 0.2.2 but rejects the documented `--capability` flag while the local same-version build accepts it.
- errors: MCP initialization reports unsupported protocol: the clients request `2025-06-18` while the service accepts only `2025-11-25`. Public package invocation returns `invalid_arguments`. No dynamic PreToolUse hint is observed after project and hook trust.
- timeline: Reproduced during Codex real-machine acceptance on 2026-08-27 after ZCode and OpenCode host work. Earlier direct launcher and authenticated service probes passed different slices but did not prove the full Codex host event path.
- reproduction: Install the local package into `D:\AIProgram\codex-acceptance-20260827-185745`, trust the project and its two hooks in Codex, run `rg -n LoginMgr .` followed by the project MCP `search_code login`, compare Codex 0.146.1 and 0.150.1, inspect only secret-free event summaries and marker metadata, then compare the public 0.2.2 tarball command parser with the local working-tree tarball.

## Current Focus

- bug_class: Windows host command quoting plus external protocol compatibility plus release identity drift
- hypothesis: Codex Hook is fixed. Independently, the QA service rejects every protocol version currently proposed by Codex; the public/local 0.2.2 mismatch is an immutable-version release process failure rather than a runtime parser defect.
- test: Merge and deploy the isolated KCodeRag compatibility commit, then rerun the Codex real-host MCP query and marker checks. Keep the public/local package identity correction in the already-planned Phase 04.2 forward-version work.
- expecting: The deployed service accepts Codex `2025-06-18` without weakening `2025-11-25`; a forward package version removes the public/local identity collision.
- candidate_causes:
  - QA initialize validation accepts only a non-Codex protocol revision
  - package version was not advanced after capability/ZCode changes
- and_gate: Preserve advisory fail-open behavior, secret-safe diagnostics, project-only ownership, transaction boundaries, and unrelated dirty work. Do not update the sibling authoritative guide; maintain any needed guide copy locally.
- next_action: deploy integrated KCodeRag commit `fdf8f866` from an operator/runtime that actually owns the remote QA Docker target, then rerun authenticated Codex MCP acceptance
- reasoning_checkpoint: Real Codex selects `commandWindows`, accepts the documented Hook fields, and delivers valid context. A raw top-level `& exit /b 0` prevents the native runner from starting the command. An explicit inner `cmd.exe /c` works only when invoked literally as `cmd.exe`; `%ComSpec%` is not expanded by the native runner. The final command uses literal `cmd.exe`, one quoted inner boundary, cmd-escaped Node parentheses, and inner fail-open control flow.
- tdd_checkpoint: Added a launcher contract test that failed against the raw control-operator command, then passed after the nested-cmd rendering fix. The full launcher suite passes 14/14, including moved projects and missing-Node behavior.

## Evidence

- timestamp: 2026-08-27
  checked: Secret-safe Codex real-machine acceptance receipt and fresh post-uninstall verification.
  found: Local package lifecycle passed and final managed residue count is zero. The real host local command passed, dynamic hint was not observed, both tested Codex versions failed protocol negotiation, and no success marker was created. The receipt contains no sensitive patterns and records overall FAIL.
  implication: Keep lifecycle code intact; isolate Hook event compatibility and service protocol negotiation as separate faults.

- timestamp: 2026-08-27
  checked: Acceptance-owned `PreToolUse` probe under real Codex 0.150.1 with trust bypass, matching `^Bash$` and returning a nonce only through `hookSpecificOutput.additionalContext`.
  found: The host emitted one Bash event whose top-level keys are `cwd,hook_event_name,model,permission_mode,session_id,tool_input,tool_name,tool_use_id,transcript_path,turn_id`; `tool_input.command` is a string; the structural `rg` was captured; and the assistant received and reported the nonce.
  implication: Eliminate real Codex payload-schema mismatch, matcher mismatch, and `additionalContext` delivery failure. Focus the product Hook investigation on its registered command/bootstrap/integrity path and the earlier observation oracle.

- timestamp: 2026-08-27
  checked: Field-by-field and command-shape real-host probes against Codex 0.150.1 on Windows.
  found: `commandWindows` is selected; the product matcher, timeout, status message, context limit, and ~5.95KB command length are accepted. A top-level `2>nul & exit /b 0` prevents execution. A literal `cmd.exe /d /s /c` boundary with cmd-escaped Node parentheses executes and delivers context; `%ComSpec%` is not expanded by the native runner.
  implication: Render the Windows bootstrap as one nested literal-cmd command and keep fail-open control flow inside that boundary.

- timestamp: 2026-08-27
  checked: Rebuilt and packed local package, clean-installed it into the Codex acceptance project, then ran real Codex 0.150.1 with Hook trust bypass and one structural `rg`.
  found: The host completed the command and accurately reported the first three injected words as `Structural lookup: prefer`. The launcher regression suite passed 14/14.
  implication: Codex PreToolUse deployment is repaired and proven on the real host; proceed to the independent MCP negotiation failure.

- timestamp: 2026-08-27
  checked: KCodeRag MCP initialize and subsequent-session protocol validation in an isolated worktree based on `f4a97d05`.
  found: The exact service gate accepted only `2025-11-25`. Commit `a7307da9` adds Codex `2025-06-18`, binds each session to its negotiated revision, and passes 29 unit tests, 31 combined negotiation tests, 6 protocol contracts, Ruff, canonical mypy, and the read-only preflight gate.
  implication: The protocol defect is fixed at source without relaxing per-session validation. The shared QA deployment was intentionally not mutated, so live `search_code` remains unverified and must not be reported as PASS.

- timestamp: 2026-08-27
  checked: Navigation package generation, five-host smoke, package audit, and real temporary tgz tests after the Windows Hook fix.
  found: Deterministic generation passes, the five-host smoke passes 11/11, package audit reports 74 declared entries, and package tests pass 14/14. Navigation commit `7280095` contains only the Hook source, its test, and regenerated managed Hook JSON.
  implication: The shared installation/update/uninstall and host simulation framework remains green across Codex, Claude Code, Cursor, OpenCode, and ZCode; the remaining Codex MCP result depends on deploying the external service fix.

- timestamp: 2026-08-27
  checked: Current Phase 04.2 planning ownership for the public/local `0.2.2` collision and experience-guide policy.
  found: The checked-in roadmap already assigns a forward `0.3.0` identity and repository-local `docs/MCP_QA_EXPERIENCE_GUIDE.md` to Phase 04.2. The sibling authoritative guide was not modified during this debug session.
  implication: Do not republish or overwrite immutable `0.2.2`, and do not bypass the ordered Phase 04.2 migration merely to fold it into this Hook repair.

- timestamp: 2026-08-27
  checked: Rebased the protocol compatibility changes onto the latest active KCodeRag development baseline and ran repository gates before integration.
  found: The compatibility set was integrated into `codex/dev-main-full-rebuild-data` as commit `fdf8f866`. The exact protocol/baseline set passes 36/36, Ruff passes, full-repository mypy passes, the staged GatePlan passes, and canonical full gate passes with bulk plus canary.
  implication: The service source fix is no longer confined to the old isolated branch; it is present on the active local development branch with its byte-exact integrity baseline updated.

- timestamp: 2026-08-27
  checked: Canonical coverage and QA `deploy check --target main` on integrated commit `fdf8f866`.
  found: Coverage/preflight passes with 7,734 tests passed, 72 skipped, zero failed, and about 81% coverage. QA check then fails at `config_git_image_identity`; service health, MCP auth/tools/contracts, and Neo4j inventory remain NOT_RUN. The active Docker context is local Docker Desktop, while the shared QA service is hosted on another machine.
  implication: Do not run local `qa deploy rebuild` and misrepresent it as the shared deployment. A remote target owner must deploy `fdf8f866`; only then may Phase 06-style authenticated `search_code` and success-marker evidence be collected.

## Eliminated

- hypothesis: Project trust or Hook trust alone explains the MCP and hint failures.
  evidence: The real Codex TUI explicitly trusted the project and both hooks; project MCP registration then appeared enabled, yet the dynamic hint remained absent and initialization failed at protocol negotiation.
  timestamp: 2026-08-27

- hypothesis: Real Codex emits an unsupported PreToolUse event shape or ignores valid advisory `additionalContext`.
  evidence: A minimal real-host probe captured the documented `Bash` plus string `tool_input.command` shape and delivered a nonce through `hookSpecificOutput.additionalContext` to the assistant.
  timestamp: 2026-08-27

- hypothesis: Hook metadata fields, matcher breadth, or command length cause Codex to ignore the installed Hook.
  evidence: Real-host discriminating probes retained the same matcher and metadata and accepted a command of the same length. Only the location of Windows control operators changed the result.
  timestamp: 2026-08-27

## Resolution

- root_cause: The generated Windows `commandWindows` placed `& exit /b 0` at the top level. Codex's native Windows Hook runner did not execute that command shape, so the fail-open suffix prevented the Hook itself from starting.
- fix: Wrap the Node bootstrap and fail-open suffix inside one literal `cmd.exe /d /s /c` boundary and cmd-escape the inline decoder parentheses. Keep only the outer pair of double quotes so native runner parsing remains stable.
- verification: New TDD contract plus 14/14 launcher tests; clean local tarball install; real Codex 0.150.1 structural `rg` received `Structural lookup: prefer`.
- files_changed: `src/core/project-root.cts`, `tests/hooks/launcher.test.cts`, generated `kcoderag-qa/hooks/hooks.json`.
- external_fix: KCodeRag active local branch `codex/dev-main-full-rebuild-data`, integrated commit `fdf8f866`; original isolated proof commit `a7307da9` remains provenance only.
- remaining: Shared QA service deployment and authenticated Codex `search_code`/PostToolUse marker acceptance; public package identity is deferred to the planned forward `0.3.0` phase.
- oracle_type: real-host Hook observation plus deterministic/unit/contract/package/smoke gates
