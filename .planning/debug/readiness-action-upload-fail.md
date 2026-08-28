---
status: diagnosed
trigger: "Phase 04.2 readiness run 33177297004 failed after the local-action handler fix"
created: 2026-08-28
updated: 2026-08-28T00:00:08+08:00
---

# Debug Session: Readiness Action Upload Failure

## Symptoms

- Expected behavior: The package job creates exactly one audited candidate tgz, uploads it through the candidate-owned local action, and enables all four platform lanes.
- Actual behavior: Run 33177297004 failed in package job 98869123373 at `Create audit smoke and upload one candidate tgz`; all four platform lanes were skipped and no artifacts or receipts were produced.
- Error messages: Stable sanitized reason `artifact_upload_failed`.
- Timeline: First observed on the new candidate after Plan 36 replaced the shell `run:` uploader with a candidate-owned local JavaScript action.
- Reproduction: Push candidate `6b3d1bcd304dc6cd66b44938098e081a8693ead3` to the authorized readiness ref; do not rerun during this diagnose-only session.

## Current Focus

- bug_class: bohrbug
- hypothesis: The candidate-owned uploader fails because it substitutes an unvalidated one-shot Azure `PUT Blob` for GitHub's supported version-7 Azure SDK data-plane sequence; mock tests accept the invented request and therefore cannot detect the live protocol rejection.
- test: Compare the custom Create/PUT/Finalize sequence, actual Node wire headers, Plan 11/36 validation boundary, official `@actions/artifact` implementation, Azure Put Blob contract, GitHub incident history, and all recoverable safe run metadata.
- expecting: Control-plane shapes match while the data plane materially diverges and lacks live-contract coverage; no competing broad outage or metadata/auth failure explains the evidence as well.
- next_action: In a separately authorized fix workflow, replace the bare PUT with official-compatible Azure blob transport semantics, preserve same-process lease bytes, and add secret-safe stage/status-class observability plus a contract test that rejects the old bare-PUT request.
- reasoning_checkpoint:
    candidate_causes:
      - code: hand-written Blob PUT diverges from the supported Azure SDK request sequence and is covered only by permissive mocks.
      - environment: a transient GitHub/Azure network or service error produced a non-2xx response that the custom client did not retry.
      - config: the job-scoped signed URL may grant or encode semantics incompatible with the chosen bare Put Blob operation.
      - data: the tgz size/body might exceed a single-PUT constraint, though local artifact metadata bounds make this low probability.
    and_gate: no; any one invalid request, service failure, or size violation independently produces the observed stable failure.

## Evidence

- timestamp: 2026-08-28T00:00:00+08:00
  observation: Candidate `6b3d1bcd304dc6cd66b44938098e081a8693ead3`; run `33177297004`; package job `98869123373`; failed upload step; stable reason `artifact_upload_failed`; four lanes skipped; artifact and receipt counts are zero.
  implication: Failure occurred before any durable artifact became available to downstream lanes.
- timestamp: 2026-08-28T00:00:02+08:00
  checked: Phase 0 semantic/keyword knowledge-base recall.
  found: MemPalace CLI is unavailable and `.planning/debug/knowledge-base.md` does not exist, so no known-pattern candidate can be recalled.
  implication: Proceed with direct code and sanitized run evidence; no prior resolution is being assumed.
- timestamp: 2026-08-28T00:00:03+08:00
  checked: Complete local action, workflow, uploader implementation, and uploader/workflow tests.
  found: `.github/actions/readiness-upload/index.cjs` invokes the built `package-upload` command in a Node 24 action. `github-artifact-upload.cts` maps fetch rejection or any non-2xx Create/PUT/Finalize response to the same `artifact_upload_failed`; its tests use a hand-written fetch mock and never exercise the live service contract.
  implication: The stable reason proves a network/HTTP failure after runtime auth, but cannot identify the stage. A live protocol mismatch remains plausible and is not covered by current tests.
- timestamp: 2026-08-28T00:00:03+08:00
  checked: SBFL eligibility for the failing area.
  found: The only failing specimen is a remote workflow job; local tests pass against mocked responses and no per-test coverage matrix contains at least one failing and one passing live-contract test.
  implication: SBFL skipped because no valid failing/passing per-test spectrum exists; continue with working-backwards and differential protocol comparison.
- timestamp: 2026-08-28T00:00:04+08:00
  checked: Sanitized GitHub run/job metadata and stream-filtered failing-step markers for run `33177297004`, job `98869123373`.
  found: Candidate SHA, branch, job identity, and step sequence match the session. Checkout, setup, install, and build passed; the local action ran for about 45 seconds and emitted only the stable JSON failure `artifact_upload_failed`; all dependent lanes were skipped. No stage-specific marker exists.
  implication: The failure is inside the action after build and after auth validation, but remote logs cannot distinguish Create, PUT, or Finalize. Protocol differential analysis is required.
- timestamp: 2026-08-28T00:00:04+08:00
  checked: Failure classification and routing.
  found: The same immutable candidate invokes one fixed request sequence and fails at a stable stage with a stable error; there is no evidence of timing, aging, interleaving, or concurrency dependence.
  implication: Classify as `bohrbug`; route to deterministic working-backwards/differential analysis. Git bisect is unnecessary because the introducing Plan 36 change and exact candidate are already known.
- timestamp: 2026-08-28T00:00:05+08:00
  checked: Official GitHub `@actions/artifact` CreateArtifact and FinalizeArtifact implementation plus generated protobuf schema.
  found: The custom control requests match the official version-7 shapes: backend IDs, name, wrapped MIME type, `version: 7`, string size, and wrapped `sha256:` hash. The official data plane does not perform the custom one-shot PUT; it uses Azure `BlockBlobClient.uploadStream`, which stages chunks and commits the block list with SDK-managed headers.
  implication: Eliminate a Create/Finalize field-shape mismatch. The only material protocol divergence is Blob transport and headers; test that branch next.
- timestamp: 2026-08-28T00:00:06+08:00
  checked: Introducing commit `79e8f22`, Plan 11 evidence, Plan 36 plan/summary, and candidate diff.
  found: The raw uploader was introduced in Plan 11 with only hand-written fetch mocks; no remote upload occurred. Plan 36 intentionally left the uploader unchanged and proved only handler selection plus synthetic environment resolution. The first real post-handler run is therefore also the first live contract test of the one-shot Blob PUT.
  implication: The current tests establish orchestration and auth lookup but cannot validate the live data plane; their success does not disconfirm a protocol defect.
- timestamp: 2026-08-28T00:00:06+08:00
  checked: GitHub Status incident history at the run time (`2026-08-28T13:51Z`).
  found: No GitHub Actions incident is reported for August 28; the prior Actions incident was resolved more than a day earlier.
  implication: A broad service outage is not supported, though an isolated transient request failure remains possible until protocol evidence rules it out.
- timestamp: 2026-08-28T00:00:07+08:00
  checked: Loopback capture of the exact Node Buffer PUT request shape.
  found: Node supplies `Content-Length`, `Content-Type`, and `x-ms-blob-type`, but supplies neither `x-ms-version` nor `x-ms-date`. The official Azure SDK path supplies SDK-managed versioning and uses block staging/commit; Azure's Put Blob contract documents versioning for authorized requests.
  implication: Missing SDK-managed transport semantics is a concrete code defect candidate, but it does not by itself prove this run failed at PUT because the run discarded the response stage/status and SAS versioning can affect header requirements.
- timestamp: 2026-08-28T00:00:08+08:00
  checked: Check-run annotations for the failed package job.
  found: The only annotation concerns an unrelated Node runtime deprecation; no upload stage, HTTP status class, Azure error code, or request outcome was preserved outside the sanitized workflow JSON.
  implication: The exact Azure rejection code and failing RPC/data-plane stage are unrecoverable from this run without a new instrumented run; raw secret-bearing logs were neither exposed nor required.
- timestamp: 2026-08-28T00:00:08+08:00
  checked: Final cross-category root-cause collapse.
  found: Auth and local artifact production completed far enough to enter network upload; Create/Finalize schemas match the official client; GitHub reported no contemporaneous Actions incident; the only material protocol deviation is the hand-written bare Blob PUT, first exercised against the live service in this run and covered previously only by a permissive mock.
  implication: Highest-confidence protocol-class root cause is the unsupported/unvalidated Blob data-plane substitution. Exact response code remains an explicit blind spot, so the fix contract must add safe stage/status-class evidence before the next authorized run.

## Eliminated

- hypothesis: The readiness ref still points at the retired candidate.
  evidence: Known safe metadata says the remote readiness ref now equals the new candidate.
- hypothesis: The previous shell `run:` handler-auth diagnosis is the complete explanation for this run.
  evidence: This candidate uses the Plan 36 local JavaScript action and reports `artifact_upload_failed`, not the prior pre-network auth failure.
- hypothesis: CreateArtifact or FinalizeArtifact uses the wrong protobuf-JSON field names/types.
  evidence: The custom payloads match the official `@actions/artifact` version-7 implementation and generated schema field-for-field; only the Blob transport materially differs.
- hypothesis: A broad GitHub Actions outage caused the failure.
  evidence: GitHub Status reports no Actions incident at the run time; the previous incident had been resolved more than a day earlier.
- hypothesis: Node's Buffer upload omitted `Content-Length` or used chunked transfer.
  evidence: The exact loopback experiment emitted a concrete `Content-Length` and no `transfer-encoding`, matching the candidate's Buffer request shape.

## Resolution

- root_cause: The candidate-owned artifact client hand-implements GitHub Actions v7 raw upload with a one-shot Azure `PUT Blob`, while GitHub's supported client uses Azure SDK-managed blob transport (versioned headers plus block staging/commit). The repository's tests mock the bare PUT as an unconditional 201 and never validate the live data-plane contract, so the first real post-handler run reaches runtime auth but is rejected during the upload protocol and collapses the response to `artifact_upload_failed`. The exact Azure rejection code/stage is not recoverable because the implementation discards it and the safe run log preserves only the normalized reason.
- fix:
- verification: Diagnose-only. Confirmed candidate/run/job identity; successful pre-upload workflow steps; runtime-auth-to-network transition; official Create/Finalize schema parity; material Blob transport divergence; mock-only coverage; no contemporaneous broad Actions incident; no additional safe annotation. No workflow rerun or product change was performed.
- files_changed:
