---
status: diagnosed
trigger: "Phase 04.2 readiness push run 33161895992 failed in the package job before all platform lanes."
created: 2026-08-28
updated: 2026-08-28
---

# Debug Session: Readiness Package Job Failure

## Symptoms

- expected: The authorized push of candidate `f387da46d5ebcbeaeb2a1aa0218623a2860422c3` creates one readiness run whose package job uploads one audited candidate archive and whose four platform lanes emit metadata-only receipts.
- actual: The exact push and run correlation succeeded, but the package job failed in `Create audit smoke and upload one candidate tgz`; all four platform lanes and receipt verification were skipped.
- errors: GitHub Actions run `33161895992` concluded `failure`; receipt count is zero and `platformLanes` remains `NOT_RUN`. Raw logs have not been copied into repository artifacts.
- timeline: First real Phase 04.2 readiness run on 2026-08-28 after Plan 35 repaired the source/generated product snapshot contract and Plan 30 froze the new candidate.
- reproduction: Inspect the failed package step for run `33161895992` and compare it with candidate workflow blob `4e967d4885469b3b496b9c364915b7478484ad37`; reproduce locally only through the existing source-owned readiness/package test seams without registry candidate acquisition or release mutation.

## Current Focus

- bug_class: bohrbug
- hypothesis: CONFIRMED — the workflow invokes the direct artifact adapter from a shell `run:` step, while hosted runner `ScriptHandler` does not inject the two private runtime artifact inputs required by the adapter; it therefore rejects empty auth before any artifact request.
- test: Exact frozen-candidate-parity executable, valid push/head provenance, runtime artifact variables absent.
- expecting: Observed exit 1, stable reason `artifact_auth_invalid`, and zero workflow-output bytes.
- candidate_causes:
  - code/workflow: `.github/workflows/readiness.yml` launches the env-dependent uploader through a `run:` shell step.
  - environment: hosted runner 2.336.0 `ScriptHandler` does not inject the runtime artifact URL/token that Node/container action handlers receive.
  - data/config: exact push/ref/head/workflow provenance is valid and the candidate producer reaches the auth boundary.
- and_gate: yes — the failure requires the env-dependent custom uploader and a ScriptHandler invocation context that withholds both required runtime artifact inputs; changing either side of that boundary removes this failure mechanism.
- next_action: Return the compact root-cause report and exact RED oracle to the parent; do not fix, rerun, or mutate the candidate/ref.
- reasoning_checkpoint:
    hypothesis: A shell `run:` invocation causes `artifact_auth_invalid` because runner 2.336.0 does not inject the two artifact runtime inputs into ScriptHandler.
    confirming_evidence:
      - The real run emitted `artifact_auth_invalid` and produced no artifact or outputs.
      - Official runner 2.336.0 source has zero runtime artifact input references in ScriptHandler and one each in Node/container action handlers.
      - The exact candidate-parity local producer with those inputs absent reproduces exit 1, the same stable reason, and zero output bytes.
      - Existing tests inject synthetic auth directly and only text-match the shell command.
    falsification_test: The hypothesis would be false if runner 2.336.0 ScriptHandler injected either required input or if the exact candidate producer with both absent crossed the auth boundary and attempted upload.
    fix_rationale: Diagnose-only; a future gap must change the invocation/runner-input contract and add a real-context regression oracle, not alter pack or smoke behavior.
    blind_spots: No remote rerun is authorized; the diagnosis relies on the exact failed runner source contract plus deterministic local reproduction rather than a second live run.
    candidate_causes:
      - code/workflow: env-dependent adapter launched through `run:`
      - environment: ScriptHandler omits the private artifact runtime inputs
    and_gate: yes — both sides of the mismatched boundary are contributing conditions.
- tdd_checkpoint:

## Evidence

- timestamp: 2026-08-28
  checked: Plan 31 exact push preflight, remote postflight, and unique workflow correlation.
  found: Dedicated ref points exactly to the candidate; one push run was correlated by event, branch, head SHA, time, and workflow blob.
  implication: Eliminate wrong-ref, wrong-candidate, explicit-dispatch, and ambiguous-run hypotheses.

- timestamp: 2026-08-28
  checked: Run conclusion and job/step metadata.
  found: The package job failed before artifact production; four platform lanes and verify-lanes were skipped, leaving zero receipts.
  implication: Diagnose the producer step before any new candidate or remote ref update.

- timestamp: 2026-08-28
  checked: Local pre-push regression evidence.
  found: Full tests passed 409/409, pack audit 17/17, and five-host smoke 12/12 on the same source lineage.
  implication: The failure is likely specific to the workflow producer environment or command composition rather than the core host lifecycle tests.

- timestamp: 2026-08-28
  checked: Secret-safe run/job/step metadata for run 33161895992 and frozen candidate workflow tree.
  found: Checkout, Node 22 setup, locked dependency install, and maintainer build all succeeded; only step 6 (`Create audit smoke and upload one candidate tgz`) failed. Workflow blob `4e967d4885469b3b496b9c364915b7478484ad37` resolves to `.github/workflows/readiness.yml` at the exact head SHA.
  implication: The failure boundary is after successful build and inside the single composite package producer step; workflow selection, checkout, runtime setup, dependency install, and compilation are not the failing stages.

- timestamp: 2026-08-28
  checked: Complete frozen readiness workflow, package script mapping, and package producer control flow.
  found: Step 6 runs `readiness:workflow-upload`, which maps to `readiness-workflow.cjs package-upload`. That command creates one candidate lease, runs pack audit, tar scan, and required-contract smoke, then crosses its only Actions-runner-specific boundary at `uploadCandidateArtifactFromLease` before emitting outputs.
  implication: The locally passing pack and smoke suites do not exercise the job-scoped artifact service adapter; the adapter's stable FAIL reason is the next discriminating observation.

- timestamp: 2026-08-28
  checked: Secret-safe stable failure record filtered from the failed job log.
  found: The producer emitted exactly `{schemaVersion:1,status:FAIL,reason:artifact_auth_invalid}`.
  implication: The failure occurs before any artifact service request: invalid or unavailable runner artifact inputs, not pack/smoke output, create/upload/finalize response handling, or artifact metadata drift.

- timestamp: 2026-08-28
  checked: GitHub-hosted runner metadata for the failed job and official runner v2.336.0 handler source.
  found: The job used runner 2.336.0 on ubuntu-24.04. In that exact official runner tag, `ScriptHandler.cs` has zero references to both runtime artifact variables, while `NodeScriptActionHandler.cs` and `ContainerActionHandler.cs` each inject both.
  implication: A workflow `run:` command cannot obtain the private Actions artifact service URL/token through the environment assumed by `github-artifact-upload.cts`; the invocation context is contractually wrong for this adapter.

- timestamp: 2026-08-28
  checked: Frozen candidate upload and workflow tests.
  found: The upload tests pass synthetic `runtimeToken`, `resultsUrl`, and `fetcher` directly; the workflow test only asserts that the shell command text occurs once. No test models ScriptHandler's environment contract.
  implication: Local tests can pass while the real shell step deterministically fails before network I/O.

- timestamp: 2026-08-28
  checked: Deterministic local reproduction against executable/source paths proven unchanged from candidate f387da46 and clean in the worktree.
  found: With valid push/ref/head/workflow provenance and the two ScriptHandler-absent artifact inputs unset, the complete package producer exited 1 with `artifact_auth_invalid` and wrote zero workflow-output bytes.
  implication: The exact RED oracle matches the real run and confirms the invocation-context/auth-input mechanism without registry access, remote mutation, or source changes.

## Eliminated

- hypothesis: The remote ref points at the wrong candidate.
  evidence: Post-push `ls-remote` matched the full candidate OID exactly.
  timestamp: 2026-08-28

- hypothesis: Missing receipts can be treated as partial platform success.
  evidence: All four lanes were skipped and the strict contract keeps `platformLanes=NOT_RUN` when any receipt is absent.
  timestamp: 2026-08-28

- hypothesis: The composite step fails in candidate creation, pack audit, tar scan, or required-contract smoke.
  evidence: The real stable reason is the adapter's pre-network `artifact_auth_invalid`; the exact local producer reproduces that reason only after executing the preceding producer stages.
  timestamp: 2026-08-28

- hypothesis: Create/upload/finalize service response handling or artifact metadata drift causes the observed run failure.
  evidence: `artifact_auth_invalid` is raised before `withCandidatePackageBytes` and before any fetch; service and metadata failure codes are distinct.
  timestamp: 2026-08-28

- hypothesis: The frozen candidate lacks or misaddresses the compiled readiness entrypoint.
  evidence: Build succeeded remotely, the mapped compiled entrypoint exists, and the exact candidate-parity entry reproduces the stable auth failure.
  timestamp: 2026-08-28

## Resolution

- root_cause: The candidate's readiness workflow launches its direct Actions artifact uploader as a shell `run:` command, but GitHub-hosted runner 2.336.0 does not expose `ACTIONS_RESULTS_URL` or `ACTIONS_RUNTIME_TOKEN` to ScriptHandler. The uploader requires those inputs and fails before network I/O with `artifact_auth_invalid`. Existing tests hide the contract gap by injecting synthetic auth directly and only asserting that the shell command exists.
- fix: Not applied; diagnose-only mode.
- verification: Exact candidate-parity local RED reproduction returned exit 1, `artifact_auth_invalid`, and zero workflow-output bytes with the ScriptHandler-absent inputs unset; official runner 2.336.0 source independently confirms the environment omission.
- files_changed: [.planning/debug/readiness-package-job-fail.md]
