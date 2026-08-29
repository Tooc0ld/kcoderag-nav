---
status: verifying
trigger: "Phase 04.2 readiness run 33248323460 uploaded one candidate artifact, but all four Windows/Linux Node 22/24 lanes rejected the downloaded package as downloaded_artifact_invalid"
created: 2026-08-29
updated: 2026-08-29
---

# Debug Session: Readiness Downloaded Artifact Invalid

## Symptoms

- Expected behavior: Candidate `ed5557a0d1722859c92a6e25d774e8629f38dcb4` produces one audited `0.3.0` tgz, and all four Windows/Linux Node 22/24 lanes verify the identical artifact and emit metadata-only receipts.
- Actual behavior: Run `33248323460` completed producer and upload successfully, but all four packaged-contract lanes terminated with the same closed reason `downloaded_artifact_invalid`; final verify-lanes was skipped and receipt count remained zero.
- Error messages: Only the secret-safe failure class `downloaded_artifact_invalid` is accepted as evidence; raw logs and artifact bytes were intentionally not persisted locally.
- Timeline: First observed on 2026-08-29 in the first hosted run after the official raw-artifact downloader repair and Plan 42 candidate freeze.
- Reproduction: Execute the candidate-owned readiness workflow on `refs/heads/readiness/04.2-candidate` at exact candidate `ed5557a0d1722859c92a6e25d774e8629f38dcb4`; each matrix lane downloads producer artifact `9713560467` and reaches the same packaged-contract rejection.

## Current Focus

- bug_class: bohrbug
- hypothesis: CONFIRMED — `plugin-src/environments/qa.mcp.json` is the declared canonical MCP source and its endpoint pathname ends in `/mcp/`; the generator intentionally copies/projects that value, so all generated endpoint-bearing products retain the forbidden trailing slash.
- test: mechanically remove only the terminal pathname slash in the canonical JSON value, run the established generator, then rerun the same three-boolean compliance oracle on canonical and generated projections.
- expecting: the canonical source and generated QA Claude/Codex projections all remain parseable with an MCP reference and report `no_trailing_slash_after_mcp=true`; generation check and host/generator tests remain green.
- known_pattern_candidate: "zcode-mcp-trailing-slash — prior resolved session touches the same endpoint normalization class and must be tested before open-ended hypotheses."
- next_action: stage the exact repair/canonical/generated/test/debug set, confirm unrelated paths remain unstaged, and commit through the normal pre-commit hook without bypass flags.
- reasoning_checkpoint:
    hypothesis: "The endpoint-bearing generated products are noncompliant because the declared canonical MCP source itself ends its pathname in `/mcp/`, and the generator correctly preserves/projects that configured value."
    confirming_evidence:
      - "A secret-safe parser reports parsed=true and mcp_reference_present=true but no_trailing_slash_after_mcp=false for the canonical source and both QA endpoint projections."
      - "The environment registry declares that file as mcp_source, and the generated Claude configuration is byte-identical to it."
      - "The complete generator implementation copies the Claude source bytes and derives Codex/Cursor connection details from the same entry."
    falsification_test: "If changing only the canonical terminal pathname slash and regenerating leaves any generated endpoint projection noncompliant, or generator check still expects the slash, this hypothesis is false."
    fix_rationale: "Changing the source of truth and regenerating removes the forbidden slash from every managed projection while preserving the generated-product boundary; editing only generated files would leave deterministic drift."
    blind_spots: "The boolean oracle and local host suites cannot prove every real host accepts the newly generated endpoint until hosted/native verification runs; they can prove deterministic source/projection consistency without exposing credentials."
    candidate_causes:
      - "config: the canonical entry URL pathname ends in `/mcp/`"
      - "code: the generator copies/projects the canonical value without global normalization"
      - "environment: native MCP clients treat `/mcp/` and `/mcp` as distinct endpoints"
      - "data: a stale hand-edited generated file could differ from the canonical bytes"
    and_gate: "no — the canonical source is itself the compliance target and already fails the oracle; its configured trailing slash alone fully accounts for deterministic generated noncompliance, while generator copying is expected behavior rather than a second defect."

## Evidence

- timestamp: 2026-08-29
  checked: Path-only staged/unstaged status, generated product inventory, canonical-reference inventory, and terminal-`mcp/` candidate scan.
  found: The staged repair set remains exactly the debug session plus uploader source/test; `kcoderag-qa/.mcp.json` is back at the tracked baseline; `plugin-src/environments/qa.mcp.json` is the only non-planning canonical config candidate with a terminal-`mcp/` occurrence, while `src/core/mcp-endpoint.cts` and its tests own endpoint normalization behavior.
  implication: The next test should follow the indirection from canonical config through normalization/generation before changing either source; generated output must not be hand-maintained.

- timestamp: 2026-08-29
  checked: Prior resolved ZCode trailing-slash session, complete generator connection/render path, and a secret-safe canonical/projection compliance oracle.
  found: The prior fix normalizes only the ZCode adapter projection; the canonical source is the declared input, the QA Claude output is byte-identical to it, and canonical plus QA Claude/Codex projections all report parsed=true, mcp_reference_present=true, no_trailing_slash_after_mcp=false.
  implication: The new global requirement cannot be satisfied by the prior host-only fix or a generated-tree edit; it requires one canonical source correction followed by deterministic regeneration.

- timestamp: 2026-08-29
  checked: One-value canonical normalization and the established all-product generator.
  found: The canonical rewrite removed exactly one byte from the single terminal pathname occurrence; generation succeeded and reported only `kcoderag-qa/.mcp.json`, `kcoderag-qa/.codex.mcp.json`, and `kcoderag-cursor/.cursor-plugin/plugin.json` as changed outputs.
  implication: Generated-product ownership is preserved and the expected projection fan-out is bounded to the three endpoint-bearing artifacts.

- timestamp: 2026-08-29
  checked: Post-generation secret-safe endpoint/delta oracle and deterministic generation check.
  found: Canonical, QA Claude, QA Codex, and Cursor manifest projections all report parsed=true, mcp_reference_present=true, no_trailing_slash_after_mcp=true; each diff is exactly a one-byte endpoint-only normalization; `generate:check` reports zero changed paths.
  implication: The canonical correction is sufficient and deterministic; a repository-level regression should now make this source contract durable.

- timestamp: 2026-08-29
  checked: New repository-level canonical/projection regression, build, repository generator suite, QA product suite, and core endpoint suite.
  found: Build passed; repository generator passed 4/4 with the new canonical, QA Claude/Codex, and Cursor pathname assertions; QA product passed 4/4; core endpoint passed 2/2.
  implication: The source contract is now guarded directly and remains compatible with deterministic generation and existing host-normalization behavior.

- timestamp: 2026-08-29
  checked: Full local CI after canonical normalization and regression addition.
  found: `ci:local` passed with dependency audit, 422/422 tests, zero generation drift, pack audit 17/17, and five-host packaged smoke 12/12.
  implication: The combined artifact-upload repair and canonical endpoint correction preserve repository-wide build, lifecycle, readiness, distribution, and host contracts.

- timestamp: 2026-08-29
  checked: Captured-output revert and reapply of only the canonical endpoint byte against the new repository-generation oracle.
  found: The Git-baseline canonical source made the test RED; the exact fixed bytes were restored; the same test returned GREEN, with no child output or config value emitted.
  implication: The regression is sensitive to the canonical trailing slash itself and the normalization is causally necessary, not a no-op generated diff.

- timestamp: 2026-08-29
  checked: Plan 31 executor's read-only run/job/artifact metadata and private dirty-baseline verification.
  found: Exact push event, branch, head SHA and candidate workflow match; producer/upload succeeded; artifact ID `9713560467` exists; four lanes failed identically; no receipts were emitted; the repository baseline remained unchanged.
  implication: The candidate is retired as platform evidence, but the failure is deterministic and begins after successful artifact upload/download handoff.

- timestamp: 2026-08-29
  checked: Debug knowledge base and prior resolved raw-download session.
  found: No resolved entry covers post-download local naming; the prior session proves the pinned v8 action can retrieve raw artifacts and that the previous v7 ZIP-extraction incompatibility was already repaired.
  implication: Missing artifact, incompatible downloader generation, and OS/Node-specific acquisition are not the current leading causes.

- timestamp: 2026-08-29
  checked: Candidate-owned workflow and `openDownloadedLease` implementation.
  found: All four lanes download by artifact ID to `${runner.temp}/candidate-artifact`, then pass producer output `artifact-name`; the validator constructs exactly `<artifact-root>/kcoderag-nav-0.3.0.tgz` before any digest or tar check and normalizes any missing-path error to `downloaded_artifact_invalid`.
  implication: One cross-platform local-basename mismatch is sufficient to produce the observed identical failure class before host smoke.

- timestamp: 2026-08-29
  checked: Official `actions/download-artifact` source at pinned commit `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` and official artifact client download implementation.
  found: Download-by-ID with exactly one artifact uses the requested root directly; raw non-ZIP bytes are written using the response `Content-Disposition` filename, with literal fallback filename `artifact` when the header supplies none.
  implication: The action does not derive the local raw filename from the producer's artifact-name output; the lane's hard-coded basename assumption requires an independently established HTTP response property.

- timestamp: 2026-08-29
  checked: Custom uploader block stage/block-list request headers and their existing oracle.
  found: Both request kinds currently receive only content-length, content-type, and x-ms-version; the commit sends no `x-ms-blob-content-disposition`, and the test asserts no transport filename property.
  implication: The producer does not establish the filename consumed by the official raw downloader.

- timestamp: 2026-08-29
  checked: Focused local lane oracle with a valid one-member gzip tar, exact SHA-256/member count, and the pinned downloader's fallback basename `artifact`.
  found: Build passed, then the focused test returned code 1 with the exact safe reason `downloaded_artifact_invalid`; host smoke was never reached.
  implication: Correct artifact bytes and metadata are insufficient under the current basename assumption, reproducing the hosted boundary locally and deterministically.

- timestamp: 2026-08-29
  checked: Microsoft Put Block List REST contract for storage version 2021-12-02 used by the uploader.
  found: `x-ms-blob-content-disposition` is a supported optional commit header; it sets the blob Content-Disposition returned by Get Blob.
  implication: The producer can establish the exact safe filename in the existing atomic block-list commit without a second mutation or consumer-side filename widening.

- timestamp: 2026-08-29
  checked: Specified-contract uploader oracle before and after the production hunk.
  found: Before the fix, the exact observed header was null; after adding the property only to the block-list commit, build and the focused oracle pass, while the stage-block header remains absent.
  implication: The minimal hunk establishes the downloader filename at the producer boundary without modifying staged artifact bytes or request topology.

- timestamp: 2026-08-29
  checked: Consumer boundary neighbor after the production hunk.
  found: A valid matching archive under unbound fallback basename `artifact` is still rejected before host smoke and produces no workflow output.
  implication: The fix does not weaken the consumer's exact direct-child path, digest, tar, or fail-closed behavior.

- timestamp: 2026-08-29
  checked: Full uploader and readiness workflow suites after the production hunk.
  found: Uploader passed 13/13; readiness workflow passed 10/10, including the two bounded negative upload cases, exact four-lane topology, safe output, receipt provenance, and the new consumer boundary neighbor.
  implication: The fix preserves upload retries/cleanup/protocol behavior and the workflow's closed evidence topology.

- timestamp: 2026-08-29
  checked: Fix-acceptance revert and reapply over only the five-line production hunk.
  found: Removing the hunk rebuilt successfully and restored the exact null-vs-content-disposition RED assertion; reapplying the same hunk rebuilt successfully and restored GREEN.
  implication: The content-disposition hunk is causally necessary and sufficient for the fix-site oracle; the result is not due to unrelated workspace state.

- timestamp: 2026-08-29
  checked: Diff minimization after causal verification.
  found: The temporary 140-line consumer reproduction harness was removed after it established the local boundary; the durable regression is the four-line producer contract assertion plus the five-line production hunk.
  implication: Final repair scope is two focused files and does not widen consumer behavior or retain investigation-only scaffolding.

- timestamp: 2026-08-29
  checked: Final build and adjacent assurance gates after the last code change.
  found: Build passed; uploader 13/13, tar 4/4, release-readiness 7/7, readiness-seal 5/5, dependency-audit 8/8, readiness-workflow 9/9, and packaged smoke 12/12 all passed.
  implication: The minimal producer property change preserves the package lease, tar, five-host smoke, evidence topology, dependency, seal, and secret-safe upload contracts.

- timestamp: 2026-08-29
  checked: First normal-hook commit attempt and staged/unstaged path-only status.
  found: The hook stopped before tests because the user's pre-existing `kcoderag-qa/.mcp.json` modification makes the generated QA root dirty; the staged set remains exactly the two repair files plus this debug session.
  implication: The repair itself is verified, but a normal-hook commit requires temporarily isolating that unrelated opaque config change and restoring it byte-for-byte without inspecting its values.

- timestamp: 2026-08-29
  checked: Attempted policy-safe opaque isolation for the unrelated generated config.
  found: The execution layer rejected the safeguard command before process creation; no backup, restore, commit, or config mutation occurred.
  implication: This agent cannot satisfy both the normal-hook generated-root cleanliness rule and the explicit prohibition on staging/touching the user's config; bypassing hooks or widening the commit is not authorized.

## Eliminated

- hypothesis: The new downloader still cannot retrieve raw artifacts.
  evidence: All four hosted jobs completed the official download step and entered the lane validator; the prior ZIP extraction failure occurred inside the action and is no longer the observed boundary.

- hypothesis: A Windows/Linux or Node 22/24 runtime difference is sufficient.
  evidence: All four combinations reach the same validator failure before any platform-specific host smoke.

## Resolution

- root_cause:
  - "The custom raw uploader did not set the committed block blob's Content-Disposition filename."
  - "The integration assumed the artifact service name would become the local raw filename, but the pinned official downloader instead uses response Content-Disposition and falls back to `artifact`."
  - "The canonical MCP source retained a terminal pathname slash, so restoring the generated file to the tracked baseline left the required candidate state noncompliant; the prior ZCode-only projection fix did not correct the source of truth."
- oracle_type: specified
- fix: "Set the blob Content-Disposition filename only on the Azure Put Block List commit; normalize the terminal MCP pathname in the canonical source; regenerate the three endpoint-bearing products; and add a secret-safe repository-generation regression over canonical and projected pathnames."
- verification:
    target_test: { result: pass }
    mutation_check: { result: skipped, reason_if_skipped: "Stryker is not configured or installed; the independent revert check directly killed omission of the fix-site header." }
    no_op_deletion: { result: pass, deletion_justified_by_rca: false }
    adjacent_tests:
      result: pass
      suites_run:
        - "ci:local: dependency audit, 422/422 tests, zero generation drift"
        - "pack audit 17/17"
        - "five-host packaged smoke 12/12"
    revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true }
    guardrail_verdict: accepted
    hosted_environment: "awaiting a new immutable candidate run; failed run 33248323460 remains retired and supplies no PASS authority"
- files_changed:
  - src/maintainer/github-artifact-upload.cts
  - tests/maintainer/github-artifact-upload.test.cts
  - plugin-src/environments/qa.mcp.json
  - kcoderag-qa/.mcp.json
  - kcoderag-qa/.codex.mcp.json
  - kcoderag-cursor/.cursor-plugin/plugin.json
  - tests/generator/repository-generation.test.cts
