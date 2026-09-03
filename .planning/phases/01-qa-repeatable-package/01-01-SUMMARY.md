---
phase: 01-qa-repeatable-package
plan: 01
subsystem: plugin-distribution
tags: [generation, qa, hooks, codex, claude]
requires: []
provides:
  - Deterministic self-contained QA/Dev package generation
  - Default QA project lifecycle with MCP, skill, and advisory hook
  - Shared fail-open hook and generated-artifact regression coverage
affects: [phase-02, phase-03, deployment-reliability, host-evidence]
actuals:
  tokens: 0
  tasks: 2
  commits: 0
tech-stack:
  added: []
  patterns: [canonical-source generation, fail-open advisory hooks, project-owned installation]
key-files:
  created: []
  modified: []
key-decisions:
  - "Retrospective evidence reuses shipped quick-task implementation; no production code is rewritten."
  - "Real-host smoke and nested-subdirectory root stability are later hardening phases, not original Phase 1 blockers."
requirements-completed: [PKG-01, PKG-03, PKG-04, PKG-05, HOOK-01, HOOK-03, HOOK-04, HOOK-05, GEN-01, GEN-02, GEN-03, GEN-04, GEN-05, TEST-01, TEST-02]
duration: retrospective
completed: 2026-08-23
status: complete
---

# Phase 1: QA 优先的可重复插件包 Summary

**Existing quick-task implementation satisfies the original repeatable QA package MVP without new production edits.**

## Evidence Reused

- `260820-nhw`, `260820-thb`, `260821-ebz`, and `260821-kqa` supply the canonical generator,
  self-contained packages, project QA lifecycle, launcher/runtime checks, direct Codex MCP map,
  and hosted offline matrix.
- `tests/test_generation.py`, `tests/test_project_install.py`,
  `tests/test_routing_and_hooks.py`, and both generated hook suites exercise the mapped behavior.
- Current gates: generator drift check passed; unittest 91 passed with one Windows symlink
  privilege skip; QA and Dev hook regressions each passed 55/55.

## Deferred Without Blocking Phase 1

- Stable project-root launch from nested working directories is DEP-02 in Phase 4.
- Refined fixed-string, narrow-directory, and common Lua false-positive policy is Phase 5.
- Authenticated real-host installation evidence is Phase 6.

## Next Phase Readiness

Phase 2 can rely on independently generated QA/Dev packages and the project ownership model.
