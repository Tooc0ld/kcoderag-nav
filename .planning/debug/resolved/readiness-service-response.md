---
status: resolved
trigger: "Phase 04.2 readiness run 33192180167 failed in the package upload action with artifact_service_invalid after the ProtoJSON request fix"
created: 2026-08-29
updated: 2026-08-29T01:12:00+08:00
---

# Debug Session: Readiness Service Response Rejection

## Symptoms

- Expected behavior: Candidate `4c8de692f01648a3d9983c4ae28001172354c41e` creates one audited artifact, then four Windows/Linux Node 22/24 lanes complete.
- Actual behavior: Run `33192180167` passed checkout, Node setup, locked dependency installation, and build, then failed in the candidate-owned package upload action; all four lanes and verify-lanes were skipped.
- Error messages: Strictly filtered stable output `{schemaVersion:1,status:FAIL,reason:artifact_service_invalid}`.
- Timeline: First observed on 2026-08-29 after the Create/Finalize/Delete request bodies were changed to protobuf original field names and scalar wrapper JSON.
- Reproduction: Push the exact candidate to `refs/heads/readiness/04.2-candidate`; the package action reaches the live service and rejects a successful control response before lane fan-out.

## Current Focus

- bug_class: bohrbug
- hypothesis: CONFIRMED — the request-side ProtoJSON fix reaches a successful control response, but the strict response decoder accepts only camelCase exact keys while the service and ProtoJSON contract permit original snake_case keys plus unknown fields.
- test: Change only the independent response-wire oracle to return `signed_upload_url` and `artifact_id` with an ignored future field, then run the focused uploader suite against the unchanged implementation.
- expecting: Exactly one test fails with `artifact_service_invalid` at the response decoder while all other uploader behavior remains green.
- next_action: Return the resolved fix and green local evidence to the Phase 04.2 orchestrator for a new immutable candidate and hosted run.
- reasoning_checkpoint:
    candidate_causes:
      - "code: response decoder assumes camelCase despite request-side useProtoFieldName mapping"
      - "service: successful response contains an additional or differently named protobuf field"
      - "data: signed upload URL or artifact ID violates local bounds despite valid response shape"
    and_gate: "no — any one strict response mismatch is sufficient to produce artifact_service_invalid"

## Evidence

- timestamp: 2026-08-29
  checked: Sanitized run/job/step metadata and stream-filtered application output for run 33192180167.
  found: Exact candidate/ref/push provenance; setup and build passed; package upload action failed with only `artifact_service_invalid`; all dependent lanes skipped.
  implication: The previous request 4xx is no longer observed; failure is now inside strict service-response validation or signed-response value validation.

- timestamp: 2026-08-29
  checked: Official artifact v7 generated message and Twirp JSON client sources.
  found: Requests serialize with `useProtoFieldName: true`; Create and Finalize responses are decoded with `fromJson(..., {ignoreUnknownFields:true})`; ProtoJSON readers accept both original proto names and lowerCamel JSON names.
  implication: The local camelCase-only exact-key response contract is stricter than and incompatible with the official client behavior.

- timestamp: 2026-08-29
  checked: Focused uploader suite after changing only the independent response oracle to snake_case plus an unknown future field.
  found: The suite is RED at 12/13; the one failure is `artifact_service_invalid` in the first CreateArtifact response check, and every unrelated uploader behavior remains green.
  implication: The live failure is reproduced locally at the exact response-decoding boundary without changing implementation or data-plane transport.

- timestamp: 2026-08-29
  checked: Focused uploader suite after replacing only the response field decoder.
  found: Build passes and all 13 uploader tests pass; the corrected oracle accepts snake_case plus an ignored future field, while the unchanged tests retain lowerCamel response coverage.
  implication: The minimal response decoder now matches official ProtoJSON parsing behavior without changing request serialization or block transport.

- timestamp: 2026-08-29
  checked: Adjacent readiness workflow suite after the response decoder fix.
  found: All 9 workflow tests pass, including exact branch-push authority, single local action producer, four-lane topology, and secret-safe failure output.
  implication: The repair is isolated to response normalization and does not widen workflow or release authority.

## Eliminated

- hypothesis: The run used a retired candidate or wrong branch.
  evidence: event, headBranch, headSha, remote ref, and candidate-owned workflow all match the new candidate exactly.

- hypothesis: Block staging, block-list commit, finalize request serialization, or cleanup caused the reported failure.
  evidence: The RED response oracle fails immediately on the successful CreateArtifact response before any data-plane request; all existing data-plane tests remain green.

## Resolution

- root_cause: The custom response decoder uses `exactKeys(create, ["ok", "signedUploadUrl"])` and the equivalent Finalize check, while the official protobuf JSON client accepts both original snake_case and lowerCamel field names and ignores unknown response fields. The live service's successful response therefore reaches local JSON parsing but is rejected as `artifact_service_invalid` before block staging.
- fix: Replace the two camelCase-only exact-key checks with one narrow response field reader that accepts exactly one of the lowerCamel/proto-name aliases, ignores already bounded unknown fields, and still rejects missing, non-string, or ambiguous dual-name values.
- verification: RED oracle 12/13 before the source change; GREEN uploader 13/13 and adjacent readiness workflow 9/9 after the source change. Hosted service verification remains the next immutable-candidate run owned by Phase 04.2.
- files_changed:
  - src/maintainer/github-artifact-upload.cts
  - tests/maintainer/github-artifact-upload.test.cts
