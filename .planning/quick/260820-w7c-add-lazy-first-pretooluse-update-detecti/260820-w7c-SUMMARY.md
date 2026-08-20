---
phase: quick
plan: 260820-w7c
quick_id: 260820-w7c
subsystem: plugin-distribution
tags: [codex, claude-code, pretooluse, update-check, deterministic-build]
requires:
  - quick: 260820-vuc
    provides: mutually-exclusive QA and Dev installation state
provides:
  - deterministic content-derived QA and Dev plugin versions
  - bounded first-PreToolUse update advisory for Codex and Claude Code
  - checkout-free native Codex and Claude marketplace update commands plus explicit project update
affects: [plugin-generation, project-installation, marketplace-distribution, documentation]
actuals:
  tokens: 50336
  tasks: 3
  commits: 28
tech-stack:
  added: []
  patterns:
    - provisional package render followed by SHA-256 cachebuster render
    - fail-open session marker, remote cache, and refresh-lock state
key-files:
  created:
    - kcoderag-update.json
    - plugin-src/hooks/update_check.py
    - scripts/update_plugin.py
    - tests/test_update_check.py
    - tests/test_plugin_update.py
  modified:
    - scripts/generate_plugins.py
    - scripts/manage_project_install.py
    - plugin-src/hooks/grep_nudge.py
    - README.md
    - MCP_QA_EXPERIENCE_GUIDE.md
key-decisions:
  - "Update detection runs only on the existing first relevant PreToolUse path; no additional lifecycle hook is registered."
  - "Remote data only selects an exact validated version; all AI-facing text is rendered from a local fixed template."
  - "Update application remains an explicit user-confirmed command and never runs inside the hook."
  - "Marketplace notices and ordinary-user docs use native host commands runnable from any directory; the repository updater remains an optional checkout-only safety wrapper."
patterns-established:
  - "Content identity: hash ordered, length-prefixed provisional package bytes and render the final +codex cachebuster afterward."
  - "Lazy update state: claim a hashed session marker before bounded I/O, reuse a 24-hour strict cache, and serialize stale refreshes."
requirements-completed:
  - UPDATE-ID-01
  - UPDATE-CHECK-01
  - UPDATE-CHECK-02
  - UPDATE-CMD-01
  - UPDATE-DOCS-01
  - DELIVERY-01
coverage:
  - id: D1
    description: Deterministic content-sensitive QA and Dev plugin identities and version document
    requirement: UPDATE-ID-01
    verification:
      - kind: unit
        ref: tests/test_generation.py#test_effective_versions_are_deterministic_and_content_sensitive
        status: pass
    human_judgment: false
  - id: D2
    description: First-PreToolUse update checks with bounded session/cache/lock state and silent failures
    requirement: UPDATE-CHECK-01
    verification:
      - kind: unit
        ref: tests/test_update_check.py
        status: pass
      - kind: integration
        ref: python kcoderag-qa/hooks/test_grep_nudge.py and dev equivalent
        status: pass
    human_judgment: false
  - id: D3
    description: Explicit project, Codex, and Claude update commands with safe failure results
    requirement: UPDATE-CMD-01
    verification:
      - kind: unit
        ref: tests/test_project_install.py and tests/test_plugin_update.py
        status: pass
    human_judgment: false
  - id: D4
    description: Root, QA, and generated package update lifecycle documentation
    requirement: UPDATE-DOCS-01
    verification:
      - kind: unit
        ref: tests/test_generation.py#test_manifest_and_install_documentation_contracts
        status: pass
    human_judgment: false
duration: 32min
completed: 2026-08-20
status: complete
---

# Quick Task 260820-w7c Summary

**Content-derived plugin versions with bounded first-PreToolUse update notices and explicit project/Codex/Claude update commands**

## Performance

- **Duration:** 32 min
- **Started:** 2026-08-20T15:33:23Z
- **Completed:** 2026-08-20T16:05:20Z
- **Tasks:** 3
- **Files modified:** 27
- **Commits:** 28

## Accomplishments

- Replaced the stale timestamp cachebuster with deterministic per-environment SHA-256 identities and published the exact QA/Dev identities in `kcoderag-update.json`.
- Added a self-contained checker to both packages and project installations that consumes the first relevant PreToolUse per session, uses a strict 24-hour cache, serializes refreshes, and fails open on all errors.
- Added checkout-free native Codex and Claude marketplace commands to the advisory and ordinary-user documentation; retained the updater script as an optional checkout-only safe wrapper and kept project updates checkout-bound.

Effective generated versions:

- QA: `0.1.1+codex.bd23d4e94e27e346`
- Dev: `0.1.1+codex.6f1864586905ab64`

## TDD Evidence

| Contract | RED evidence | GREEN evidence |
|---|---|---|
| Content-derived identity | `030481b` failed on timestamp version `0.1.1+codex.20260820112121` | `13790c8` made repeat/shared/QA-only sensitivity pass |
| Initial QA/Claude notice | `df02a4c` failed because the package lacked `update_check.py` | `cd616aa` connected fixed document → checker → existing hook output |
| Explicit session once | `9aea469` produced two notices and two fetches | `69a32b2` claimed a hashed marker before I/O |
| Fresh cross-session cache | `7566e4c` fetched twice for two new sessions | `66ebcdf` reused a strict 24-hour atomic cache |
| Stale refresh fallback | `3ebffe2` lost a validated stale update on network failure | `8e489f2` added exclusive refresh locking and stale fallback |
| Missing session throttle | `c0e8c1b` skipped the first no-session event | `8dd8e91` added environment/project/hour hash identity |
| Bounded markers and failures | `122fc27` left 140 session markers | `43d55b1` pruned to 128 and covered redirect/schema/oversize/cache/lock/replace failures |
| Project update | `37bd31e` failed because `update_project` did not exist | `e921d8c` preserved the validated active environment and project boundary |
| Codex updater | `e210701` failed because the updater script did not exist | `01914a1` implemented marketplace upgrade then plugin add |
| Claude updater | `01ed475` found Claude unsupported | `2d78c75` implemented marketplace update then scoped plugin update |
| Scope/failure contract | `bd251e6` allowed an invalid Claude scope to reach the runner | `2782d80` added preflight validation and stable stop-at-stage results |
| Documentation | `be9320f` failed on missing lazy-check/update guidance | `1c06cb5` updated root, generated package, and QA guide content |
| Checkout-free notice | `048ffbd` failed because the advisory required a repository-local Python script | `c9cdaf0` rendered exact native Codex and Claude commands within the 600-character bound |
| Ordinary-user update path | `186c3e8` failed because docs made the checkout wrapper primary | `8cf74e0` made native commands primary and documented both checkout-only boundaries |

Concurrency for one explicit session, same-version silence, timeout consumption, lock-loser stale fallback, stale-lock recovery, and the full safe-failure matrix were added as GREEN characterization tests after the underlying general behavior already satisfied them.

## Task Commits

1. **Task 1 — deterministic identity and initial notice:** `030481b`, `13790c8`, `df02a4c`, `cd616aa`
2. **Task 2 — session/cache/lock/failure bounds:** `9aea469`, `69a32b2`, `7566e4c`, `66ebcdf`, `3ebffe2`, `8e489f2`, `c0e8c1b`, `8dd8e91`, `122fc27`, `43d55b1`
3. **Task 3 — explicit updaters and documentation:** `37bd31e`, `e921d8c`, `e210701`, `01914a1`, `01ed475`, `2d78c75`, `bd251e6`, `2782d80`, `be9320f`, `1c06cb5`, `048ffbd`, `c9cdaf0`, `186c3e8`, `8cf74e0`

## Verification

- `python scripts/generate_plugins.py --check` — exit 0
- `python -m unittest discover -s tests -p "test_*.py" -v` — 69 tests passed
- `python kcoderag-qa/hooks/test_grep_nudge.py` — 55/55 passed
- `python kcoderag-dev/hooks/test_grep_nudge.py` — 55/55 passed
- `git diff --check 75f0037..HEAD` — exit 0
- `rg -n 'SessionStart' plugin-src kcoderag-qa kcoderag-dev scripts` — no production matches
- `push: NOT_RUN (not authorized)`

No verification contacted the public version URL; update-check tests used injected responses and generated hook regressions explicitly disabled network checks.

## Deviations from Plan

None - plan behavior was implemented as specified.

## Issues Encountered

- A concurrent quick committed the private Cursor distribution (`76fe0e1`) and left its planning/AGENTS updates in the shared worktree. This plan preserved that commit, adapted final generation verification to the resulting 69-test suite, and did not stage or alter the concurrent planning files.

## Security and Failure Boundaries

- The hook validates one fixed HTTPS raw GitHub URL, exact schema keys, repository/channel constants, response size, final URL, and full version shape.
- Remote bodies, errors, subprocess output, session IDs, cwd values, credentials, and connection configuration are never copied into notices or updater diagnostics.
- The hook never invokes subprocesses or installation code; it only renders fixed native commands, and all changes require explicit user confirmation before a host CLI is run.

## Known Stubs

None.

## User Setup Required

Older installations must be manually updated once with the native marketplace commands to receive the checker. No repository checkout, credentials, or external service setup are required beyond the repository's existing internal-test configuration.

## Next Step

The local commits are ready for the orchestrator/user to decide whether to push. A new Codex thread or Claude session is required after applying an update.

## Self-Check: PASSED

- Created files exist and both generated packages contain their self-contained checker.
- All 28 listed `260820-w7c` commits exist on the current branch.
- Summary intentionally remains uncommitted for the root orchestrator; STATE and `.gsd` were not modified by this executor.
