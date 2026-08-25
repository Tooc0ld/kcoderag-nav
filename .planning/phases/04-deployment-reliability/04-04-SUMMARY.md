---
phase: 04-deployment-reliability
plan: 04
subsystem: hook-project-discovery
tags: [nodejs, codex, claude-code, hooks, project-root, fail-open, windows, posix, tdd]

requires:
  - phase: 04-deployment-reliability
    provides: Plan 03 QA-only Codex and Claude install state, host adapters, and digest-backed lifecycle
provides:
  - Bounded nearest selected-host install-state discovery from the actual session cwd
  - Non-skippable damaged-project boundaries with silent fail-open behavior
  - Canonical rootless Codex and Claude registered commands under the Windows command-line limit
  - Root, deep-child, nested, damaged, moved-copy, Unicode, missing-runtime, and missing-launcher evidence
affects: [phase-04-source-diagnostics, phase-04-smoke, phase-04-head-acceptance, phase-05-hook-precision]

actuals:
  tokens: 12548
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - First existing selected-host state pathname is a non-skippable execution boundary
    - Fixed rootless commands embed bounded metadata-only discovery and invoke only a digest-verified project launcher
    - Compatibility registration is rendered from the same command source as native host settings

key-files:
  created:
    - src/core/project-root.cts
    - .planning/phases/04-deployment-reliability/04-04-SUMMARY.md
  modified:
    - src/hosts/codex.cts
    - src/hosts/claude.cts
    - plugin-src/hooks/hooks.json
    - src/generator/index.cts
    - kcoderag-qa/hooks/hooks.json
    - package.json
    - src/maintainer/pack-audit.cts
    - tests/hooks/launcher.test.cts
    - tests/hosts/codex.test.cts
    - tests/hosts/claude.test.cts

key-decisions:
  - "Only ENOENT permits ancestor traversal; every other result makes the nearest state pathname a silent, non-skippable boundary."
  - "Hook execution trusts only exact current QA state metadata plus a contained regular launcher whose SHA-256 matches managed state."
  - "Codex, Claude, and generated compatibility registration share one canonical rootless command renderer with no absolute project identity."
  - "The Windows command is kept below cmd.exe's 8192-character boundary while retaining full current-state validation."

patterns-established:
  - "Nearest boundary: existence is decided before parsing, so malformed inner projects cannot fall through to a healthy outer project."
  - "Move-safe ownership: state and launcher identities stay project-relative and are re-resolved from cwd after copy, rename, or root change."
  - "Advisory isolation: every discovery, runtime, shell, input, state, and launcher failure exits successfully with empty stdout/stderr."

requirements-completed: [DEP-02]

coverage:
  - id: D1
    description: "Bounded discovery selects the nearest valid selected-host QA state and refuses malformed, incompatible, drifted, symlinked, or missing launchers without outer fallback."
    requirement: DEP-02
    verification:
      - kind: unit
        ref: "tests/hooks/launcher.test.cts#nearest-state discovery matrix; npm run test:launcher (12/12)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Codex and Claude install the same canonical rootless bootstrap and execute it from project root and Unicode/space deep children on Windows and POSIX shells."
    requirement: DEP-02
    verification:
      - kind: integration
        ref: "tests/hooks/launcher.test.cts#installed Codex and Claude commands; tests/hosts/{codex,claude}.test.cts (18/18)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Nested nearest selection, damaged-inner no-fallback, complete copy/rename, malformed input, missing Node, missing state, and missing launcher behavior are proven through exact registered commands."
    requirement: DEP-02
    verification:
      - kind: e2e
        ref: "tests/hooks/launcher.test.cts#schema-damaged and complete project copies; npm run test:launcher (12/12)"
        status: pass
    human_judgment: false

duration: 23min
completed: 2026-08-25
status: complete
---

# Phase 04 Plan 04: Nearest-Project Rootless Hook Discovery Summary

**Codex and Claude now execute one bounded, move-safe rootless Hook command that selects the nearest managed QA project and silently stops at any damaged inner boundary.**

## Performance

- **Duration:** 23 min
- **Started:** 2026-08-25T07:04:32Z
- **Completed:** 2026-08-25T07:27:20Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- Added host-neutral nearest-state discovery with a 256-ancestor bound, exact current QA schema validation, path containment, regular-file checks, and launcher SHA-256 verification.
- Replaced project-relative Codex and Claude hook registration with canonical rootless commands that start at the real session cwd and stay below the Windows command-line limit.
- Made plugin compatibility registration a generated projection of the same Claude command contract rather than a separate plugin-root path.
- Proved exact installed commands at root, Unicode/space deep children, healthy nested projects, schema-damaged nested boundaries, copied/renamed projects, and every required fail-open case.
- Preserved the original Grep/Glob/Bash matcher, advisory payload, five-second timeout, and offline foreground path.

## Task Commits

Each TDD task retained RED and GREEN evidence:

1. **Task 1: Implement bounded nearest-state Hook discovery** - `1491e8e` (RED), `72e9b6b` (GREEN)
2. **Task 2: Register the rootless bootstrap for Codex and Claude Code** - `a445e8b` (RED), `24a9cb9` (GREEN)
3. **Task 3: Prove nested, moved, Unicode, and damaged-project boundaries end to end** - `c3b29b8` (RED), `103d16a` (GREEN)

## Files Created/Modified

- `src/core/project-root.cts` - Readable discovery contract plus compact fixed bootstrap renderer.
- `src/hosts/codex.cts`, `src/hosts/claude.cts` - Native host settings now use canonical rootless commands.
- `plugin-src/hooks/hooks.json`, `src/generator/index.cts`, `kcoderag-qa/hooks/hooks.json` - Compatibility registration is deterministically rendered from the same command source.
- `package.json`, `src/maintainer/pack-audit.cts` - The compiled discovery module is present and required in the public archive.
- `tests/hooks/launcher.test.cts` - Pure and real-command root/deep/nested/damaged/moved/failure matrix.
- `tests/hosts/codex.test.cts`, `tests/hosts/claude.test.cts` - Installed command metadata is project-relative and contains no target binding.

## Decisions Made

- State pathname existence is evaluated before parsing. Only ENOENT may continue upward; malformed JSON, incompatible schema, permission/type errors, symlinks, drift, or missing launchers stop silently.
- The rootless command carries only fixed host and safe relative paths. It never interpolates MCP/config data and performs no foreground network work.
- The compact embedded program remains behaviorally covered by exact rendered-command tests and is limited to roughly 4.4K characters on Windows, below cmd.exe's hard boundary.
- Project movement relies on relative managed paths and digests; no absolute installation root, Git, or SVN identity was added.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Closed the public-package dependency introduced by the new host import**
- **Found during:** Task 2 (Register the rootless bootstrap for Codex and Claude Code)
- **Issue:** The declared file list did not include the package and pack inventories, but both host adapters import `dist/core/project-root.cjs`; omitting it would make the installed npm CLI fail even though repository tests passed.
- **Fix:** Added the compiled module to `package.json`, required it in `pack-audit`, and verified a real temporary tgz.
- **Files modified:** `package.json`, `src/maintainer/pack-audit.cts`
- **Verification:** `npm run test:pack` passed 10/10 after the exact inventory update.
- **Committed in:** `24a9cb9`

---

**Total deviations:** 1 auto-fixed missing-critical dependency boundary.
**Impact on plan:** The change is required for the planned rootless host integration to work from the public npm package; no product surface or dependency was added.

## Issues Encountered

- The first rootless source rendering exceeded the Windows command-line ceiling. The fixed embedded source was reduced below the limit and a permanent `< 8192` assertion was added.
- The first compact bootstrap checked the launcher digest but accepted malformed `originals` metadata. A RED real-command nested fixture exposed the gap, and GREEN aligned originals/digests/sections validation with the readable state contract.
- Windows exact-command tests initially passed a whole shell command as a normal argv element. The harness now uses the platform shell execution path that matches host behavior.

## Authentication Gates

None.

## Known Stubs

None.

## User Setup Required

None - no external authority, live MCP service, credential, or user configuration was required.

## Next Phase Readiness

- Source diagnostics, package smoke, and Head acceptance can now use the installed command from any project descendant and compare project-relative state/launcher identity.
- Phase 05 hook precision and Phase 06 authenticated real-host MCP evidence remain deliberately unchanged.
- No blocker remains for the next Phase 04 plan.

## Self-Check: PASSED

- All declared production, generated, test, package, and summary artifacts exist.
- All six RED/GREEN task commits are present in Git history.
- Fresh launcher 12/12, Codex 9/9, Claude 9/9, pack 10/10, build, and generation checks passed.
- No known stub, skipped test, unrun verification, authentication gate, or unexpected tracked deletion remains.

---
*Phase: 04-deployment-reliability*
*Completed: 2026-08-25*
