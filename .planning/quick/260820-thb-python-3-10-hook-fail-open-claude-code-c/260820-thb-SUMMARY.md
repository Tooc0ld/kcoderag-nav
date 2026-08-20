---
phase: quick
plan: 260820-thb
subsystem: tooling
tags: [python-3.10, hooks, installer-status, mcp, ci, claude-code, codex]

requires:
  - phase: quick-260820-t66
    provides: project-scoped installer ownership and dual-host hook registration
provides:
  - Python 3.10+ fail-open runtime launchers for generated and project-installed hooks
  - Read-only installer status and drift/update diagnostics with a stable safe schema
  - Loopback MCP stub, isolated Claude/Codex smoke adapters, and layered GitHub CI
  - Redacted QA experience guide and runtime/status/trust documentation
affects: [plugin-generation, project-installation, host-smoke, continuous-integration]

actuals:
  tokens: 21051
  tasks: 3
  commits: 19

tech-stack:
  added: []
  patterns:
    - explicit Python candidate probing with silent fail-open
    - read-only status rendering from ownership digests and deep-copied desired state
    - structured host evidence plus independent loopback receipt gate

key-files:
  created:
    - plugin-src/hooks/run_hook.sh
    - plugin-src/hooks/run_hook.cmd
    - scripts/run_host_smoke.py
    - tests/stub_mcp_server.py
    - tests/test_hook_runtime.py
    - tests/test_host_smoke.py
    - .github/workflows/ci.yml
    - MCP_QA_EXPERIENCE_GUIDE.md
  modified:
    - plugin-src/hooks/hooks.json
    - scripts/generate_plugins.py
    - scripts/manage_project_install.py
    - tests/test_generation.py
    - tests/test_project_install.py
    - README.md

key-decisions:
  - "Runtime launchers accept only Python 3.10+ and suppress all probe/launch diagnostics on failure."
  - "CLI install warns safely when no platform launcher candidate qualifies, while programmatic install remains silent."
  - "Installer status reports only stable code/path metadata and computes source updates against a deep copy."
  - "Active-environment ownership is incomplete unless script plus POSIX and Windows launchers are all represented."
  - "Real-host PASS requires both structured host events and an independent stub tool-call receipt."
  - "Authenticated host smoke remains workflow-dispatch-only and never participates in required offline CI."

patterns-established:
  - "Hook runtime: candidate probe -> qualified execution -> stdout only on success -> always exit 0."
  - "Status precedence: invalid -> drifted -> update_available -> healthy/not_installed."
  - "Smoke evidence: host hook event + host tool event + loopback receipt; model prose is ignored."

requirements-completed:
  - HOOK-RUNTIME-01
  - HOOK-RUNTIME-02
  - INSTALL-STATUS-01
  - INSTALL-STATUS-02
  - HOST-SMOKE-01
  - HOST-SMOKE-02
  - DOCS-01
  - DELIVERY-01

coverage:
  - id: D1
    description: Python 3.10+ launchers select candidates in platform order and fail open silently.
    requirement: HOOK-RUNTIME-01
    verification:
      - kind: unit
        ref: tests/test_hook_runtime.py
        status: pass
    human_judgment: false
  - id: D2
    description: Canonical launchers are generated into both packages and installed/uninstalled with ownership.
    requirement: HOOK-RUNTIME-02
    verification:
      - kind: integration
        ref: tests/test_generation.py and tests/test_project_install.py
        status: pass
    human_judgment: false
  - id: D3
    description: Installer status distinguishes healthy, absent, drifted, update-available, and invalid states without writes.
    requirement: INSTALL-STATUS-01
    verification:
      - kind: unit
        ref: tests/test_project_install.py#status tests
        status: pass
    human_judgment: false
  - id: D4
    description: Status human and JSON output use safe stable fields and documented exit codes.
    requirement: INSTALL-STATUS-02
    verification:
      - kind: unit
        ref: tests/test_project_install.py#test_status_cli_uses_stable_safe_schema_and_exit_codes
        status: pass
    human_judgment: false
  - id: D5
    description: Required smoke contracts use only a loopback synthetic MCP server and structured receipts.
    requirement: HOST-SMOKE-01
    verification:
      - kind: integration
        ref: tests/test_host_smoke.py#StubMCPServerTests
        status: pass
    human_judgment: false
  - id: D6
    description: Optional real-host smoke uses isolated Claude/Codex adapters and evidence gates.
    requirement: HOST-SMOKE-02
    verification:
      - kind: integration
        ref: tests/test_host_smoke.py#HostSmokeHarnessTests
        status: pass
      - kind: other
        ref: real authenticated host invocation
        status: unknown
    human_judgment: true
    rationale: Current executor was not a controlled authenticated host-smoke runner, so real-host evidence remains NOT_RUN.
  - id: D7
    description: README and QA guide document runtime, status, CI, and trust boundaries without canonical sensitive values.
    requirement: DOCS-01
    verification:
      - kind: unit
        ref: tests/test_host_smoke.py#WorkflowAndDocumentationTests
        status: pass
    human_judgment: false
  - id: D8
    description: Plan files were committed atomically and pushed normally on the current branch.
    requirement: DELIVERY-01
    verification:
      - kind: other
        ref: git push
        status: pass
    human_judgment: false

duration: 40 min
completed: 2026-08-20
status: complete
---

# Quick Plan 260820-thb: Python 3.10 Hook and Host Smoke Summary

**Cross-platform fail-open hook runtime, safe installer health inspection, and deterministic loopback MCP CI with optional isolated real-host verification.**

## Performance

- **Duration:** 40 min
- **Started:** 2026-08-20T13:28:36Z
- **Completed:** 2026-08-20T14:08:00Z
- **Tasks:** 3
- **Files modified:** 20
- **Commits:** 19

## Accomplishments

- Added POSIX and Windows launchers that probe Python 3.10+ in deterministic order, preserve successful hook JSON, and silently exit 0 on every runtime failure.
- Added read-only `status`/`status --json` diagnostics that distinguish installation health, local drift, source updates, and invalid ownership/path state.
- Added a standard-library loopback MCP server and isolated Claude/Codex adapters whose PASS verdict requires structured host events and an independent tool-call receipt.
- Added pinned Ubuntu/Windows offline CI, opt-in authenticated host smoke, and credential-safe operational documentation.
- Closed review gaps by validating full launcher ownership, warning safely on missing CLI runtime, and documenting exact Claude Code project-scope lifecycle commands plus the pure-MCP boundary.

## Task Commits

Task 1 — runtime launcher tracer:

- `d709702`, `91a25b6`, `c2d8520` — TDD RED contracts
- `2729bcc` — launcher, generation, and project-install GREEN implementation

Task 2 — read-only installer status:

- `a6d2856`, `f94c5f5`, `58522cf` — TDD RED contracts
- `315d578` — status API/CLI and documentation GREEN implementation

Task 3 — stub MCP, host adapters, CI, and guide:

- `f32b0a3`, `b1c2338`, `1edd147`, `e004a92` — TDD RED contracts
- `bf647a2`, `88fd9ea`, `4da877a` — stub, adapters, workflow, and docs GREEN implementation

Review-fix follow-up:

- `4ae797e` — TDD RED contracts for complete launcher ownership and missing-runtime warning
- `35de4d0` — ownership validation and credential-safe CLI runtime preflight GREEN implementation
- `ef9a72f` — TDD RED documentation contracts for project scope and pure MCP
- `e0d8371` — exact Claude Code project-scope lifecycle commands and pure-MCP guidance GREEN implementation

## Verification

- `python scripts/generate_plugins.py --check` — PASS
- `python -m unittest discover -s tests -p "test_*.py" -v` — PASS, 38/38
- QA generated hook regression — PASS, 53/53
- Dev generated hook regression — PASS, 53/53
- Credential-safe scan across six public smoke/docs artifacts — PASS
- `git diff --check b6a07a3..HEAD` and working-tree `git diff --check` — PASS
- GitHub-hosted required workflow run — NOT_RUN locally; the exact offline commands above passed and the workflow matrix is contract-tested
- Codex real-host smoke — NOT_RUN (`not_isolated_runner`)
- Claude real-host smoke — NOT_RUN (`not_isolated_runner`)
- Normal current-branch push — PASS

## Files Created/Modified

- `plugin-src/hooks/run_hook.sh`, `plugin-src/hooks/run_hook.cmd` — platform launchers
- `kcoderag-{qa,dev}/hooks/` — generated self-contained launcher registrations/assets
- `scripts/manage_project_install.py` — launcher ownership and read-only status API/CLI
- `tests/test_hook_runtime.py` — candidate-order and silent fail-open runtime contracts
- `tests/stub_mcp_server.py` — loopback-only Streamable HTTP fixture and safe receipts
- `scripts/run_host_smoke.py` — isolated host preparation, adapters, evidence parsing, and verdicts
- `tests/test_host_smoke.py` — protocol, fake-host, CI, and credential-safety contracts
- `.github/workflows/ci.yml` — required offline matrix and optional authenticated job
- `README.md`, `MCP_QA_EXPERIENCE_GUIDE.md` — operational guidance and trust boundaries

## Decisions Made

- Runtime failures remain advisory: no candidate, old candidate, probe error, and hook launch error all return exit 0 with empty protocol output.
- Installer CLI runtime preflight uses the exact platform candidate order and emits one stable warning only after a successful install; direct `install()` calls do not print.
- Status never calls mutating install/uninstall paths; desired current-source bytes are rendered against a deep-copied state only after installed digests pass.
- Ownership completeness covers `grep_nudge.py`, `run_hook.sh`, and `run_hook.cmd` for every active environment before source-update classification.
- Required CI never invokes a model host or internal service. Real hosts are opt-in, isolated, and can honestly return NOT_RUN.
- Normal push was performed only after all task commits and full local verification passed.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None. Remote read authentication and normal push succeeded. Real-host authentication was not probed because this executor was not a controlled isolated host-smoke runner.

## Known Stubs

None. `tests/stub_mcp_server.py` is the intentional deterministic test fixture specified by the plan, not an incomplete production path.

## Issues Encountered

None.

## User Setup Required

None. Optional real-host smoke requires the separately managed `kcoderag-host-smoke` runner described in the workflow and guide.

## Next Phase Readiness

- Required offline CI has deterministic Python 3.10+ Linux/Windows coverage.
- A controlled authenticated runner can now produce real-host evidence without using internal MCP infrastructure.
- No code or push blockers remain; optional real-host evidence remains explicitly NOT_RUN for this local executor.

## Self-Check: PASSED

- All required created/modified key files exist.
- All 19 task/TDD commits resolve in git history and were pushed normally.
- Coverage metadata validates with no schema errors.
- The adjacent KCodeRag guide remains clean and unchanged.
- SUMMARY remains uncommitted for the orchestrator, as required.

---
*Phase: quick*
*Completed: 2026-08-20*
