---
phase: 02-managed-project-lifecycle
slug: managed-project-lifecycle
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-23
---

# Phase 2 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | Python standard-library `unittest` |
| Config file | none |
| Quick run command | `python -m unittest tests.test_project_install -q` |
| Full suite command | `python -m unittest discover -s tests -p "test_*.py" -q` |
| Estimated runtime | ~20 seconds |

## Per-Task Verification Map

| Requirement | Primary automated evidence | Status |
|-------------|----------------------------|--------|
| PKG-02 | Dev cases in `test_single_environment_installs_are_idempotent` and isolated generated-package execution | ✅ green |
| PKG-06 | `test_cross_environment_and_both_installs_are_refused_without_writes` and `test_environment_switch_requires_uninstall_first` | ✅ green |
| TEST-03 | QA/Dev permutations, idempotency, conflicts, and switch tests in `tests/test_project_install.py` | ✅ green |
| TEST-05 | `test_each_package_runs_without_canonical_parent`, host smoke contracts, and direct Codex MCP generation | ✅ green |
| TEST-06 | `test_install_permutations_preserve_project_and_user_boundaries` and `test_conflicts_and_symlink_escape_fail_before_writes` | ✅ green |

## Wave 0 Requirements

Existing project installer and generation tests cover every Phase 2 requirement.

## Manual-Only Verifications

None within this phase boundary. Authenticated host evidence is Phase 6.

## Validation Sign-Off

- [x] Every requirement has named green automation.
- [x] Conflict tests prove zero writes by byte snapshot.
- [x] Full suite completed after the latest production commit.
- [x] No watch-mode flags.
- [x] `nyquist_compliant: true` set.

**Approval:** approved 2026-08-23
