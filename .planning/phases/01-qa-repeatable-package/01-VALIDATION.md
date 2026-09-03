---
phase: 01-qa-repeatable-package
slug: qa-repeatable-package
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-23
---

# Phase 1 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | Python standard-library `unittest` plus generated hook regression scripts |
| Config file | none |
| Quick run command | `python -m unittest tests.test_generation tests.test_routing_and_hooks -q` |
| Full suite command | `python -m unittest discover -s tests -p "test_*.py" -q` |
| Estimated runtime | ~20 seconds |

## Per-Task Verification Map

| Requirement | Primary automated evidence | Status |
|-------------|----------------------------|--------|
| PKG-01 | `tests.test_project_install.ProjectInstallTests.test_default_qa_round_trip_preserves_project_bytes` | ✅ green |
| PKG-03 | `tests.test_generation.GenerationTests.test_manifest_and_install_documentation_contracts` | ✅ green |
| PKG-04 | `tests.test_generation.GenerationTests.test_generated_packages_are_self_contained` | ✅ green |
| PKG-05 | `tests.test_project_install.ProjectInstallTests.test_install_renders_hook_scripts_without_placeholders` | ✅ green |
| HOOK-01 | `tests.test_routing_and_hooks.RoutingAndHookTests.test_each_single_environment_hook_emits_context` | ✅ green |
| HOOK-03 | `tests.test_routing_and_hooks.RoutingAndHookTests.test_oversized_input_and_mechanical_search_fail_open` | ✅ green |
| HOOK-04 | generated `kcoderag-qa/dev/hooks/test_grep_nudge.py` local-scope cases | ✅ green |
| HOOK-05 | `tests/test_routing_and_hooks.py` pipeline, compound, wrapper, quoting, and segmentation cases | ✅ green |
| GEN-01 | `tests.test_generation.GenerationTests.test_generation_check_accepts_tracked_outputs` | ✅ green |
| GEN-02 | `tests.test_generation.GenerationTests.test_each_package_runs_without_canonical_parent` | ✅ green |
| GEN-03 | `tests.test_generation.GenerationTests.test_environment_metadata_locks_plugin_scoped_prefixes` | ✅ green |
| GEN-04 | `tests.test_generation.GenerationTests.test_isolated_write_is_repeatable_and_check_is_read_only` | ✅ green |
| GEN-05 | `tests.test_generation.GenerationTests.test_effective_versions_are_deterministic_and_content_sensitive` | ✅ green |
| TEST-01 | QA/Dev generated hook suites, 55/55 each | ✅ green |
| TEST-02 | generation manifest, MCP, launcher, self-contained, and LF checkout contracts | ✅ green |

## Wave 0 Requirements

Existing infrastructure covers all Phase 1 requirements; no new test stubs are needed.

## Manual-Only Verifications

None within this phase boundary. Real-host smoke is TEST-07/08/09 in Phase 6.

## Validation Sign-Off

- [x] Every requirement maps to an automated command or named green regression.
- [x] Full suite completed after the latest production commit.
- [x] No watch-mode command is used.
- [x] Feedback latency is below 30 seconds.
- [x] `nyquist_compliant: true` set.

**Approval:** approved 2026-08-23
