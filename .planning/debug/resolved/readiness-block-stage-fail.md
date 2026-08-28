---
status: resolved
trigger: "Phase 04.2 readiness run 33187499766 failed in the package upload step after deterministic block staging transport was introduced"
created: 2026-08-28
updated: 2026-08-29T00:15:00+08:00
---

# Debug Session: Readiness Block Stage Failure

## Symptoms

- Expected behavior: The package job uploads one audited candidate artifact, then four Windows/Linux Node 22/24 lanes produce metadata-only receipts.
- Actual behavior: Run 33187499766 failed in the package upload step; all four platform lanes and verify-lanes were skipped.
- Error messages: The public run state is a secret-safe package-step failure; artifact and receipt counts are zero.
- Timeline: First observed on candidate c9eecb470dd893746ed335bb22012310492c4f45 after Plan 38 replaced the bare Blob PUT with deterministic block staging and commit.
- Reproduction: Push the frozen candidate to refs/heads/readiness/04.2-candidate; do not rerun until the current failure is diagnosed and fixed forward.

## Current Focus

- bug_class: bohrbug
- hypothesis: The CreateArtifact 4xx is caused by sending TypeScript object names and wrapper objects directly, while the official v7 JSON client serializes protobuf original field names and scalar wrapper values.
- test: Local diagnosis and fix verification accepted by the Phase 04.2 orchestrator.
- expecting: The orchestrator owns the later candidate freeze and hosted readiness run as phase-level external verification.
- next_action: Archive this resolved local debug session; do not perform remote actions from the debugger.
- reasoning_checkpoint:
    hypothesis: "Direct JSON.stringify of in-memory protobuf-shaped objects causes GitHub to reject CreateArtifact because the official JSON wire contract uses original snake_case field names and scalar wrapper values."
    confirming_evidence:
      - "The real run deterministically failed at create_artifact with statusClass 4xx before any Azure data-plane stage."
      - "Official actions/toolkit calls toJson with useProtoFieldName true and StringValue serializes to a JSON string; local code sends camelCase and object wrappers."
      - "The agent-authored exact-wire test fails only on that concrete request-shape mismatch."
    falsification_test: "If the current implementation already emitted snake_case scalar-wrapper JSON, or if changing only serialization failed the strict local contract, this hypothesis would be false."
    fix_rationale: "Serializing the three control requests in the official protobuf JSON wire shape corrects the rejected boundary and prevents the same latent mismatch in finalize and cleanup without changing transport topology or runtime dependencies."
    blind_spots: "A new remote run is still required to verify service acceptance; successful response field casing is retained as observed by the official client and existing tests."
    candidate_causes:
      - "code: wrong control-plane JSON serialization (confirmed)"
      - "config/environment: missing or unauthorized Actions runtime credential (eliminated by successful local validation plus hosted local-action token injection and the exact protocol mismatch)"
      - "data: invalid artifact name/size or duplicate artifact (eliminated by bounded valid metadata and per-run job identity)"
    and_gate: "no — the malformed CreateArtifact body alone is sufficient to produce the observed deterministic 4xx before data-plane work."

## Evidence

- timestamp: 2026-08-28T00:01:00+08:00
  checked: Repository search for artifact transport stages and workflow entrypoint.
  found: The candidate uploader has explicit create_artifact, stage_block, commit_block_list, finalize_artifact, and cleanup mappings; the workflow invokes the same-process local readiness-upload action exactly once.
  implication: The run can be localized using existing closed metadata without inspecting secret-bearing payloads.
- timestamp: 2026-08-29T00:02:00+08:00
  checked: Sanitized GitHub run 33187499766 metadata and closed failure JSON only.
  found: The package action failed with reason artifact_upload_failed at create_artifact with statusClass 4xx; all four platform lanes and verify-lanes were skipped.
  implication: Local auth parsing and package preflight completed, and no Azure stage_block, commit_block_list, finalize, or cleanup boundary was reached before the authoritative failure.
- timestamp: 2026-08-29T00:10:00+08:00
  checked: Official actions/toolkit artifact v7 upload source, generated Twirp JSON client, protobuf schema, wrapper serializer, and Microsoft Azure Put Block/Put Block List documentation.
  found: The official client calls CreateArtifactRequest.toJson with useProtoFieldName true, so workflow_run_backend_id, workflow_job_run_backend_id, and mime_type are sent; google.protobuf.StringValue is serialized as a plain JSON string. The local uploader instead sends camelCase fields and object-shaped wrappers. Azure stage and commit construction matches the documented comp=block/comp=blocklist model and was not reached in the failed run.
  implication: A deterministic control-plane wire-format mismatch explains the create_artifact/4xx boundary; the same mismatch also exists in FinalizeArtifact hash and DeleteArtifact control requests and must be fixed consistently.
- timestamp: 2026-08-29T00:04:32+08:00
  checked: Focused compiled uploader suite after changing only the exact-wire test oracle.
  found: The suite is RED at 12/13; the single failure shows actual camelCase/object-wrapper CreateArtifact JSON versus expected snake_case/scalar-wrapper protobuf JSON. All other uploader behaviors remain green.
  implication: The protocol defect is locally deterministic and isolated to control-plane serialization; spectrum-based localization is unnecessary because the one failing strict contract assertion directly identifies the fault site.
- timestamp: 2026-08-29T00:06:00+08:00
  checked: Focused uploader suite after the serialization-only source change.
  found: Build passes and all 13 uploader tests pass, including exact same-process lease bytes, deterministic blocks, cleanup, bounds, and the corrected protobuf JSON wire oracle.
  implication: The minimal source change directly fixes the locally reproduced root-cause behavior without disturbing data-plane behavior.
- timestamp: 2026-08-29T00:12:00+08:00
  checked: Adjacent readiness workflow suite and fix-acceptance guardrail.
  found: Readiness workflow tests pass 9/9; the source diff is a balanced 8-addition/8-deletion serialization replacement; reverting only the source fix restores the RED contract test and reapplying restores 13/13 GREEN. No Stryker configuration or dependency exists, so mutation testing is explicitly skipped.
  implication: Local verification accepts the minimal fix and attributes the repaired behavior to this source change; only a fresh authorized hosted run can verify the external service boundary.
- timestamp: 2026-08-29T00:15:00+08:00
  checked: Phase 04.2 orchestrator acceptance boundary.
  found: The orchestrator accepted the local root-cause diagnosis, minimal fix, and guardrail verification, and explicitly owns the future candidate freeze and hosted readiness run.
  implication: The debug session is terminally resolved for its authorized local scope; external readiness evidence remains phase workflow responsibility rather than an unresolved debugger action.

## Eliminated

- hypothesis: Azure stage_block, commit_block_list, or cleanup caused the reported failure.
  evidence: The closed run metadata identifies create_artifact/4xx and proves no data-plane stage was reached; the local Azure request model also matches Microsoft's documented block and block-list contract.
  timestamp: 2026-08-29T00:04:32+08:00
- hypothesis: Missing action environment caused local preflight rejection.
  evidence: The uploader decoded the runtime token and reached the remote CreateArtifact endpoint; missing or malformed environment values would have produced artifact_auth_invalid before any request.
  timestamp: 2026-08-29T00:04:32+08:00

## Resolution

- root_cause: Direct JSON serialization bypassed the official protobuf JSON mapping, sending camelCase control fields and object-shaped StringValue wrappers; GitHub rejected CreateArtifact with 4xx before block staging.
- fix: Serialize CreateArtifact, FinalizeArtifact, and DeleteArtifact requests with protobuf original field names and scalar StringValue JSON representations.
- oracle_type: specified
- verification:
    target_test: { result: pass, suite: "github-artifact-upload 13/13" }
    mutation_check: { result: skipped, reason_if_skipped: "Stryker is not configured or installed" }
    no_op_deletion: { result: pass, deletion_justified_by_rca: false, detail: "balanced 8-addition/8-deletion serialization replacement" }
    adjacent_tests: { result: pass, suites_run: ["readiness-workflow 9/9"] }
    revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true }
    guardrail_verdict: accepted
    environment: "hosted GitHub service verification delegated to and accepted by the Phase 04.2 orchestrator"
- files_changed:
  - src/maintainer/github-artifact-upload.cts
  - tests/maintainer/github-artifact-upload.test.cts

## Prevention

- branching_5_whys:
    code:
      - The uploader manually constructed Twirp JSON to preserve a zero-runtime-dependency boundary.
      - The construction reused TypeScript property names and wrapper object shapes instead of the protobuf JSON wire mapping.
      - No narrow serializer or explicit wire-shape contract made that translation visible at the control boundary.
    test_environment:
      - Local fetch stubs accepted the same camelCase/object-wrapper shape emitted by the implementation.
      - The mocks therefore mirrored implementation assumptions instead of independently enforcing the official generated client's wire contract.
      - Hosted GitHub was the first strict service boundary to reject the mismatch.
- why_not_caught: The uploader unit test should have caught the control-plane wire contract, but its expected bodies copied the implementation shape; typecheck could not detect arbitrary JsonMap key semantics.
- recurrence_guard: The specified-oracle regression in tests/maintainer/github-artifact-upload.test.cts (`block stage and block list commit preserve the exact private lease buffer`) now asserts snake_case Create/Finalize request fields and scalar wrappers, while the cleanup test asserts the same DeleteArtifact convention.
