---
phase: 02-managed-project-lifecycle
plan: 01
subsystem: project-installer
tags: [installer, lifecycle, ownership, qa, dev]
requires:
  - phase: 01-qa-repeatable-package
    provides: Independent generated QA and Dev packages
provides:
  - Mutually exclusive QA/Dev project installation
  - Explicit uninstall-before-switch lifecycle
  - Project and user configuration ownership boundaries
affects: [phase-03, deployment-reliability, host-evidence]
actuals:
  tokens: 0
  tasks: 2
  commits: 0
tech-stack:
  added: []
  patterns: [digest-verified ownership, write-before-conflict gate, explicit environment switching]
key-files:
  created: []
  modified: []
key-decisions:
  - "Mutual exclusion is explicit; the installer never auto-uninstalls the other environment."
  - "Native user-level misinstallation diagnostics are Phase 4 hardening."
requirements-completed: [PKG-02, PKG-06, TEST-03, TEST-05, TEST-06]
duration: retrospective
completed: 2026-08-23
status: complete
---

# Phase 2: 受管项目安装与环境生命周期 Summary

**Existing installer code and tests satisfy the original managed lifecycle and isolation goal.**

## Evidence Reused

- `260820-nhw`, `260820-vuc`, `260820-t66`, and `260821-kqa` provide independent Dev,
  mutual exclusion, ownership validation, status/update, and external-source hard stops.
- `tests/test_project_install.py` covers QA/Dev permutations, idempotency, explicit switching,
  drift, user/project preservation, symlink escape, and zero-write conflicts.
- Generation and host-smoke contract tests verify separate Codex and Claude package metadata.

## Deferred Without Blocking Phase 2

- User-level `doctor` for users who never invoke the project installer is DEP-03 in Phase 4.
- Authenticated real-host install/update/uninstall evidence is Phase 6.

## Next Phase Readiness

Phase 3 can assume exactly one selected environment and explicit failure rather than implicit
environment switching.
