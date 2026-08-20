---
phase: quick
plan: 01
subsystem: plugin-distribution
tags: [python, codex, claude-code, mcp, hooks, deterministic-generation]
requires: []
provides:
  - One canonical source that deterministically generates independent QA and Dev plugins
  - Project-scoped QA-default installer with explicit Dev/both and independent uninstall
  - QA-first no-fallback routing and cross-process advisory hook deduplication
  - Offline generation, ownership, routing, compatibility, and hook E2E gates
affects: [plugin-release, project-install, environment-routing, hook-runtime]
actuals:
  tokens: 49647
  tasks: 3
  commits: 3
tech-stack:
  added: [Python standard library unittest]
  patterns: [canonical-source generation, atomic managed install, digest conflict guard, O_EXCL hook dedup]
key-files:
  created:
    - plugin-src/environments.json
    - plugin-src/routing.json
    - scripts/generate_plugins.py
    - scripts/manage_project_install.py
    - tests/test_generation.py
    - tests/test_project_install.py
    - tests/test_routing_and_hooks.py
    - README.md
  modified:
    - kcoderag-qa/hooks/grep_nudge.py
    - kcoderag-dev/hooks/grep_nudge.py
    - .claude-plugin/marketplace.json
key-decisions:
  - "Repository canonical inputs generate both complete packages; installed packages have no parent-directory dependency."
  - "Project installation defaults to QA; Dev and both require explicit selection, and uninstall is environment-specific."
  - "Concurrent hooks use path-only SHA-256 marker identities with atomic O_EXCL ownership and fail-open error handling."
patterns-established:
  - "Generated package drift is detected by relative path and bytes without printing MCP values."
  - "Installer ownership is recorded with original bytes and current digests, and all writes are staged before replacement."
requirements-completed: [PKG-01, PKG-02, PKG-03, PKG-04, PKG-05, PKG-06, ROUT-01, ROUT-02, ROUT-03, ROUT-04, HOOK-01, HOOK-02, HOOK-03, HOOK-04, HOOK-05, GEN-01, GEN-02, GEN-03, GEN-04, GEN-05, TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06]
coverage:
  - id: D1
    description: "Canonical inputs deterministically generate two independent, self-contained plugin packages and detect drift read-only."
    requirement: GEN-02
    verification:
      - kind: e2e
        ref: "tests/test_generation.py#GenerationTests"
        status: pass
      - kind: other
        ref: "python scripts/generate_plugins.py --check"
        status: pass
    human_judgment: false
  - id: D2
    description: "Project installer supports default QA, explicit Dev/both, idempotence, independent uninstall, and ownership conflicts."
    requirement: PKG-06
    verification:
      - kind: e2e
        ref: "tests/test_project_install.py#ProjectInstallTests"
        status: pass
    human_judgment: false
  - id: D3
    description: "One executable routing table enforces QA default, explicit Dev/compare, and no fallback on unreachable selections."
    requirement: ROUT-04
    verification:
      - kind: unit
        ref: "tests/test_routing_and_hooks.py#RoutingTests"
        status: pass
    human_judgment: false
  - id: D4
    description: "Concurrent QA and Dev hooks emit at most one advisory context per tool call and remain fail-open."
    requirement: HOOK-02
    verification:
      - kind: e2e
        ref: "tests/test_routing_and_hooks.py#HookDedupTests"
        status: pass
      - kind: unit
        ref: "kcoderag-qa/hooks/test_grep_nudge.py and kcoderag-dev/hooks/test_grep_nudge.py (53/53 each)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Marketplace, Codex manifests, Claude hooks, MCP references, permissions, and install documentation remain compatible."
    requirement: TEST-05
    verification:
      - kind: integration
        ref: "tests/test_generation.py#test_manifest_and_install_documentation_contracts"
        status: pass
    human_judgment: false
duration: 25 min
completed: 2026-08-20
status: complete
---

# Quick Plan 260820-nhw: KCodeRag Nav QA/Dev Plugin Lifecycle Summary

**Deterministic QA/Dev packages with a QA-default project installer, no-fallback routing, and cross-process hook deduplication.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-20T09:09:06Z
- **Completed:** 2026-08-20T09:33:21Z
- **Tasks:** 3
- **Files modified:** 39

## Accomplishments

- Migrated the repaired working-tree hook, tests, manifests, MCP inputs, permissions, skills, agents, and READMEs into `plugin-src/` canonical inputs and deterministic QA/Dev outputs.
- Added a project-only installer with default QA, explicit Dev/both, independent uninstall, original-byte restoration, digest conflict refusal, symlink containment, and transaction rollback.
- Added one executable route table plus atomic SHA-256/O_EXCL hook deduplication and comprehensive offline E2E coverage for Codex and Claude Code paths.

## Task Commits

1. **Task 1: Canonical source to dual packages and default QA install** — `ced772b`
2. **Task 2: Dev/both lifecycle, routing, and hook deduplication** — `1920565`
3. **Task 3: Complete offline lifecycle and compatibility E2E** — `fd40d70`

Planning metadata was intentionally not committed by this executor; the orchestrator owns planning commits.

## Files Created/Modified

- `plugin-src/` — canonical version, environment MCP inputs, metadata, routing, hook, tests, skill, agent, and README templates.
- `scripts/generate_plugins.py` — deterministic `--write` and read-only `--check` renderer with path-only diagnostics.
- `scripts/manage_project_install.py` — project-scoped managed install/uninstall with conflict and containment checks.
- `kcoderag-qa/`, `kcoderag-dev/` — generated, independently copyable Claude Code/Codex packages.
- `tests/` — generation, installation ownership, routing, dual-host, and concurrent hook E2E.
- `README.md` — QA-default project installation, explicit Dev/both, independent uninstall, optional user-level plugin, and credential-boundary guidance.

## Decisions Made

- QA remains first in marketplace metadata and is the only implicit project-install choice.
- A dual installation keeps two real hook registrations so tests exercise the host's concurrent behavior instead of hiding it at install time.
- Selected environment failures never add an alternate route; availability errors are explicit.
- Sensitive values may exist only in the two canonical and two generated MCP JSON files required by the accepted internal distribution model.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Preserved generated Claude plugin manifests**
- **Found during:** Task 1
- **Issue:** Existing `.claude-plugin/plugin.json` files were required for Claude compatibility but omitted from the plan's file list and expected output set.
- **Fix:** Added both manifests to deterministic generation and self-contained package checks.
- **Files modified:** `scripts/generate_plugins.py`, `tests/test_generation.py`, both package manifest paths
- **Verification:** Manifest and standalone package E2E passed.
- **Committed in:** `ced772b`

**2. [Rule 1 - Bug] Initialized an empty project hook collection**
- **Found during:** Task 1 GREEN
- **Issue:** A target without `.codex/hooks.json` raised `KeyError` before installation.
- **Fix:** Initialized `hooks.PreToolUse` through the same structured merge path used for existing hook documents.
- **Files modified:** `scripts/manage_project_install.py`
- **Verification:** Default QA byte-for-byte round trip passed.
- **Committed in:** `ced772b`

**3. [Rule 1 - Bug] Corrected the scoped unittest invocation**
- **Found during:** Task 1 verification
- **Issue:** `unittest -k "generation or default_qa_round_trip"` treats the text as one substring and ran zero tests.
- **Fix:** Used explicit test modules for the scoped gate; the final gate uses full `discover`.
- **Files modified:** None (verification command adjustment only)
- **Verification:** Scoped modules ran 3 tests; final discovery ran 15 tests.
- **Committed in:** N/A

**4. [Rule 1 - Bug] Isolated package regression dedup state**
- **Found during:** Task 3 standalone package E2E
- **Issue:** Sequential QA and Dev self-tests shared a default fallback marker, so the second package's synthetic CLI case was suppressed.
- **Fix:** The shared regression script assigns a per-run temporary dedup namespace while production hooks retain the shared default namespace.
- **Files modified:** `plugin-src/hooks/test_grep_nudge.py` and both generated copies
- **Verification:** Both standalone package tests and both direct 53/53 regressions passed sequentially.
- **Committed in:** `fd40d70`

**5. [Rule 2 - Missing Critical] Ignored generated Python cache files and enabled module-style tests**
- **Found during:** Task 2 verification
- **Issue:** Offline imports produced untracked caches, and the plan's module test command required package initializers.
- **Fix:** Added focused Python cache ignore rules plus empty `scripts` and `tests` package initializers.
- **Files modified:** `.gitignore`, `scripts/__init__.py`, `tests/__init__.py`
- **Verification:** Module and discovery commands passed with no new untracked runtime artifacts.
- **Committed in:** `1920565`

**Total deviations:** 5 auto-fixed (3 Rule 1, 2 Rule 2).
**Impact on plan:** All changes were necessary for correctness, compatibility, or executable verification; no external service or dependency scope was added.

## Verification

- `python scripts/generate_plugins.py --check` — PASS, no tracked output drift.
- `python -m unittest discover -s tests -p "test_*.py" -v` — PASS, 15/15.
- `python kcoderag-qa/hooks/test_grep_nudge.py` — PASS, 53/53.
- `python kcoderag-dev/hooks/test_grep_nudge.py` — PASS, 53/53.
- `git diff --check` — PASS.
- Credential value scan outside the four expected MCP JSON files — PASS, 0 matches.
- Live internal QA/Dev MCP connectivity — **NOT_RUN**; the plan's required gate is offline and must not connect to or print internal service configuration.

## Known Stubs

None. Stub-pattern scan matches only deliberate `TODO`/`FIXME` negative regression inputs and the generator's unresolved-placeholder detector; no runtime or rendered-content stub remains.

## Authentication Gates

None.

## Issues Encountered

The two implementation bugs and one verification-command issue are documented under deviations and were resolved before completion. No deferred issue remains.

## User Setup Required

None. The current internal QA/Dev stage intentionally bundles its MCP connection configuration.

## Next Phase Readiness

The repository now has deterministic package outputs and offline lifecycle gates. Production identity, HTTPS, credential rotation, and release automation remain the explicitly deferred v2 scope.

## Self-Check: PASSED

- All key implementation, test, generated package, and SUMMARY files exist.
- Task commits `ced772b`, `1920565`, and `fd40d70` exist in repository history.
- SUMMARY frontmatter contains `status: complete` and no bundled credential value.

---
*Quick task: 260820-nhw*
*Completed: 2026-08-20*
