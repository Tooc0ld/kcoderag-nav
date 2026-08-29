---
status: resolved
trigger: "Phase 04.2 readiness run 33242048873 produced one artifact, but all four Windows/Linux Node 22/24 lanes failed while downloading it"
created: 2026-08-29
updated: 2026-08-29
---

# Debug Session: Readiness Artifact Download Failure

## Symptoms

- Expected behavior: Candidate `6c851a7f7795679fe4269223d328400df2984f8c` uploads one audited `.tgz`, then all four Windows/Linux Node 22/24 lanes download the same artifact and emit metadata-only PASS receipts.
- Actual behavior: Run `33242048873` completed the package producer and created artifact `9711655799`, but every platform lane failed in `actions/download-artifact` before packaged verification; `verify-lanes` was skipped.
- Error messages: Each lane found artifact ID `9711655799`, obtained its metadata, then reported `Unable to download and extract artifact: Artifact download failed after 5 retries`.
- Timeline: First observed on 2026-08-29 in the first post-response-alias candidate run.
- Reproduction: Run the candidate-owned workflow with `actions/download-artifact` 7.0.0 against the producer's protocol-v7 unarchived single-file artifact.

## Current Focus

- bug_class: bohrbug
- hypothesis: CONFIRMED — the producer uploads one unarchived `.tgz` using artifact protocol v7, while the pinned download action 7.0.0 bundles `@actions/artifact` 5.x and attempts ZIP extraction; non-ZIP download support begins in `@actions/artifact` 6.1.0.
- test: Pin the official `actions/download-artifact` v8 commit that bundles `@actions/artifact` 6.2.1, update the exact workflow oracle, and run the focused readiness workflow suite.
- expecting: The workflow contract stays one-producer/four-lane with the same artifact ID and path, while the pinned downloader gains official non-ZIP support.
- next_action: Return the resolved repair and green local evidence to the Phase 04.2 candidate-freeze workflow for a new immutable hosted run.
- reasoning_checkpoint:
    candidate_causes:
      - "format: raw single-file artifact is passed to a ZIP-only download client"
      - "service: all four hosted runners independently failed to retrieve otherwise valid bytes"
      - "configuration: producer artifact ID or permissions are invalid"
    and_gate: "no — a format mismatch alone explains identical post-lookup extraction failures on all four lanes"

## Evidence

- timestamp: 2026-08-29
  checked: Read-only run, job, step, and artifact metadata for run `33242048873`.
  found: Exact candidate/ref provenance; producer PASS; artifact `9711655799` exists, is unexpired, and is 179696 bytes; all four lanes fail only at download; final validator is skipped.
  implication: The failed run is not platform PASS and cannot complete Phase 04.2, but artifact creation and cross-job discovery both succeeded.

- timestamp: 2026-08-29
  checked: Filtered download logs for all four platform jobs.
  found: Every lane resolves the same artifact ID, name, size, and digest before failing after five retries in the download-and-extract phase.
  implication: Missing artifact, wrong ID, permissions, OS, and Node-major differences are eliminated.

- timestamp: 2026-08-29
  checked: Official pinned action source and current artifact client release history.
  found: Pinned downloader commit `37930b1c2abaa49bbe596cd826c3c89aef350131` is 7.0.0 with `@actions/artifact ^5.0.0`; official non-ZIP download support begins in 6.1.0. Current v8 commit `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` is 8.0.1 with `@actions/artifact ^6.2.1` and retains the `artifact-ids` input.
  implication: Re-running the unchanged candidate would repeat a deterministic client-format incompatibility; the minimal repair is an immutable downloader pin update plus its exact test oracle.

- timestamp: 2026-08-29
  checked: Build, focused topology/action-pin regression, and full readiness workflow suite after the minimal repair.
  found: Build passed; focused regression passed 1/1; full workflow suite passed 9/9 in 142.3 seconds, including four-lane topology, artifact-ID reuse, strict receipts, and safe failure output.
  implication: The action pin is updated without widening workflow authority, artifact multiplicity, release behavior, or receipt schema.

## Eliminated

- hypothesis: The producer failed or did not create an artifact.
  evidence: The package job succeeded and GitHub reports the exact unexpired artifact for the exact run and candidate.

- hypothesis: Only Linux failed, so an OS-specific runner issue is sufficient.
  evidence: Windows Node 22/24 and Linux Node 22/24 all failed at the same action boundary.

- hypothesis: A simple rerun can provide valid evidence without a code change.
  evidence: The pinned action's bundled client predates official non-ZIP artifact support, so the same raw bytes follow the same incompatible extraction path.

## Resolution

- root_cause: The custom producer intentionally uploads the audited `.tgz` as one unarchived protocol-v7 artifact. The pinned `actions/download-artifact` 7.0.0 bundles `@actions/artifact` 5.x, which treats the artifact as a ZIP and retries extraction. All four lanes therefore fail after successful artifact lookup and signed download resolution.
- fix: Replace the four downloader pins with official `actions/download-artifact` 8.0.1 commit `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c`, whose bundled `@actions/artifact` 6.2.1 supports non-ZIP artifacts, and update the exact workflow oracle to freeze that commit.
- verification: Run `33242048873` is the live RED oracle across all four platforms. After the repair, `npm run build` passed, the focused topology/action-pin test passed 1/1, and `npm run test:readiness-workflow` passed 9/9. Hosted v8 verification remains the next immutable-candidate run owned by Phase 04.2.
- files_changed:
  - .github/workflows/readiness.yml
  - tests/maintainer/readiness-workflow.test.cts
