---
phase: 03-single-environment-routing
slug: single-environment-routing
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-23
---

# Phase 3 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | Python standard-library `unittest` plus generated hook regressions |
| Config file | none |
| Quick run command | `python -m unittest tests.test_routing_and_hooks tests.test_update_check -q` |
| Full suite command | `python -m unittest discover -s tests -p "test_*.py" -q` |
| Estimated runtime | ~20 seconds |

## Per-Task Verification Map

| Requirement | Primary automated evidence | Status |
|-------------|----------------------------|--------|
| ROUT-01 | cross/both environment zero-write rejection tests | ✅ green |
| ROUT-02 | `test_generated_guidance_comes_from_routing_table` and nudge dual-environment omission | ✅ green |
| ROUT-03 | `test_environment_switch_requires_uninstall_first` | ✅ green |
| ROUT-04 | `test_routing_rules_and_unreachable_behavior` and unavailable-index fallback assertions | ✅ green |
| HOOK-02 | bounded marker/cache/lock tests in `tests/test_update_check.py` plus no dual ownership logic in nudge | ✅ green |
| TEST-04 | routing, scope, malformed input, fallback, update failure, concurrency, and pruning matrix | ✅ green |

## Wave 0 Requirements

Existing routing, generated-hook, and update-check tests cover all Phase 3 requirements.

## Manual-Only Verifications

None in Phase 3. Live index capability truthfulness is ROUT-05 in Phase 5.

## Validation Sign-Off

- [x] Every requirement has named green automation.
- [x] Marker semantics are reconciled with bounded asynchronous update state.
- [x] Full suite completed after the latest production commit.
- [x] No watch-mode flags.
- [x] `nyquist_compliant: true` set.

**Approval:** approved 2026-08-23
