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
- hypothesis: CONFIRMED — the pinned raw downloader has a literal `artifact` fallback when its response supplies no parseable filename, while `openDownloadedLease` lstat's only the producer metadata name; the hosted service path still selects the fallback despite the blob property, so all lanes fail before digest/tar/smoke.
- test: add a regression using locally generated valid candidate bytes under the exact pinned fallback basename; require fallback-only and canonical-only roots to pass, but reject ambiguous, extra, symlink, or arbitrary roots before archive use.
- expecting: the fallback-only RED oracle fails on current code, then passes after a bounded singleton-root resolver; canonical behavior and every SHA/member/tar/lease/host check remain unchanged.
- next_action: stage only this debug record plus the readiness workflow source/test, verify the exact index inventory, and commit through the normal hook before refreezing a descendant candidate.
- reasoning_checkpoint:
    hypothesis: "All four hosted lanes fail before smoke because the official downloader materializes its literal fallback basename `artifact`, but `openDownloadedLease` looks only for the producer metadata name and normalizes the resulting missing-path error."
    confirming_evidence:
      - "The exact pinned official source uses literal `artifact` when Content-Disposition has no parseable filename and writes raw bytes at that basename."
      - "Run 33255729362 downloaded successfully in all four lanes, then failed immediately in packaged-contract verification with zero receipts; hosted artifact digest and size exactly match a fresh local candidate package that passes tar and host smoke."
      - "The local validator constructs only `<root>/<producer-name>` before any digest/tar check, and a prior valid fallback-basename fixture reproduced downloaded_artifact_invalid before host smoke."
    falsification_test: "If a valid singleton fallback-basename fixture does not reproduce RED before the fix, or a new hosted candidate still fails after accepting exactly that pinned fallback while preserving digest/member/tar checks, the hypothesis is false."
    fix_rationale: "Resolve exactly one direct regular-file candidate whose basename is either the producer name or the pinned action's literal fallback; cryptographic and tar validation remain authoritative, while ambiguity and extra entries still fail closed."
    blind_spots: "Only another immutable hosted run can prove the service currently uses the documented fallback; local and metadata evidence cannot inspect the response header because raw logs/URLs are intentionally out of scope."
    candidate_causes:
      - "code: `openDownloadedLease` hardcodes only the producer metadata basename"
      - "integration/config: the pinned download action has a separate response-header/fallback naming contract"
      - "environment/service: the hosted signed response does not surface the custom blob filename property as a parseable filename"
      - "data: downloaded bytes, digest, size, or tar member count differ from the producer"
    and_gate: "yes — failure requires both the downloader fallback selection and the consumer's single exact-name assumption; hosted digest/size equality eliminates corrupt artifact data as a co-cause."
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
  checked: Exact staged-set audit and normal-hook commit.
  found: The staged set contained exactly eight intended repair/canonical/generated/test/debug paths; only the user's planning config remained unstaged; ordinary `git commit` succeeded as `cfc074c` without any hook bypass.
  implication: The generated-product cleanliness checkpoint is resolved and the repair is now a committed immutable implementation subject ready for candidate freeze.

- timestamp: 2026-08-29
  checked: Candidate remote/auth/index/ancestry/object preflight and normal-hook allow-empty freeze.
  found: The dedicated remote ref still equals retired `ed5557a`; GitHub authentication is available; the index is empty; required workflow/action/uploader/canonical objects exist; `db50cf873f242f7a4c729fe782b2ac3d4f339ca7` was created as a distinct strict descendant whose tree is identical to repair parent `cfc074c`.
  implication: The new immutable candidate absorbs no dirty work and is eligible for the one authorized non-force dedicated-ref fast-forward.

- timestamp: 2026-08-29
  checked: Candidate source-only preflight over immutable Git/product identity and focused readiness contracts.
  found: Build and zero-drift generation passed; whole-Git brand audit scanned 507 objects with zero findings; immutable 0.3.0 product snapshot is valid; uploader passed 13/13; readiness workflow 9/9; seal 5/5; dependency audit 8/8; index/diff checks remained clean.
  implication: The candidate is ready for hosted Windows/Linux Node 22/24 verification without creating a local release, tag, registry lookup, or publish action.

- timestamp: 2026-08-29
  checked: Private hash-only dirty-work baseline, final remote/auth/ancestry preflight, dedicated-ref push, and unique run association.
  found: Six baseline fields were stored outside the repository; the remote predecessor was exact and the update was a plain non-force fast-forward; remote now equals `db50cf873f242f7a4c729fe782b2ac3d4f339ca7`; unique push run is `33255729362` and began in progress.
  implication: Hosted verification is bound to the exact candidate while local dirty work remains protected and no broader Git/release authority was exercised.

- timestamp: 2026-08-29
  checked: Hosted run/job/step metadata and run artifact inventory for candidate `db50cf873f242f7a4c729fe782b2ac3d4f339ca7` without raw logs or artifact downloads.
  found: Run `33255729362` package/upload succeeded; all four Windows/Linux Node 22/24 jobs downloaded successfully then failed identically in packaged-contract verification; verify-lanes was skipped; exactly one non-empty, unexpired candidate artifact exists and zero receipt artifacts exist.
  implication: The original hosted issue still reproduces cross-platform after the producer header change. Candidate/run are retired, no platform PASS exists, and the end-to-end filename hypothesis must be revised.

- timestamp: 2026-08-29
  checked: Official artifact upload/download source, Azure blob property contract, local validator stages, and hosted artifact metadata versus a fresh local candidate package.
  found: Official raw download uses Content-Disposition or literal `artifact`; official raw upload binds artifact name to source basename rather than relying on the blob property; hosted artifact name is expected and its REST digest and size exactly equal locally generated candidate bytes with a positive member count; local validator still opens only the metadata name before all content checks.
  implication: Corruption, SHA drift, size drift, tar count, OS, Node, and download acquisition are eliminated; the remaining cross-platform divergence is the response-derived local basename contract.

- timestamp: 2026-08-29
  checked: Agent-authored fallback-basename regression before and after the singleton-root resolver.
  found: RED rejected valid locally generated candidate bytes under the exact pinned fallback with downloaded_artifact_invalid; GREEN accepts canonical-only and fallback-only roots with matching SHA/member count, while rejecting canonical-plus-fallback, canonical-plus-extra, and arbitrary singleton names.
  implication: The consumer now handles the observed pinned naming boundary without weakening content identity or accepting ambiguous directory state.

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

- hypothesis: Setting `x-ms-blob-content-disposition` on the Put Block List commit is sufficient for the pinned official downloader to materialize the exact expected basename in hosted Actions.
  evidence: Candidate run `33255729362` contains the header fix, yet all four lanes still download successfully and fail identically in packaged-contract verification with zero receipts.

- hypothesis: The new downloader still cannot retrieve raw artifacts.
  evidence: All four hosted jobs completed the official download step and entered the lane validator; the prior ZIP extraction failure occurred inside the action and is no longer the observed boundary.

- hypothesis: A Windows/Linux or Node 22/24 runtime difference is sufficient.
  evidence: All four combinations reach the same validator failure before any platform-specific host smoke.

- timestamp: 2026-08-29
  checked: complete local CI after the bounded raw-download fallback repair
  found: dependency audit passed, the complete suite passed 423/423, generation had zero drift, pack passed 17/17, and five-host packaged smoke passed 12/12.
  implication: every applicable local guardrail signal is accepted; hosted reconfirmation is the remaining environment signal.

## Resolution

- root_cause:
  - "The pinned official raw downloader can materialize the literal fallback basename `artifact`, independently of producer artifact metadata name."
  - "The lane consumer opened only the producer metadata basename, so a valid singleton fallback file failed before existing SHA, tar, and host-smoke validation."
  - "The canonical MCP source retained a terminal pathname slash, so restoring the generated file to the tracked baseline left the required candidate state noncompliant; the prior ZCode-only projection fix did not correct the source of truth."
- oracle_type: specified
- fix: "Keep producer filename metadata, but make the lane resolve exactly one direct raw file whose basename is either the canonical producer name or the pinned downloader's literal fallback; retain all lstat/realpath/O_NOFOLLOW/SHA/tar/member/lease checks. Also normalize the terminal MCP pathname in the canonical source, regenerate its three products, and guard canonical/projected paths secret-safely."
- verification:
    target_test: { result: pass }
    mutation_check: { result: skipped, reason_if_skipped: "Stryker is not configured or installed; the independent revert check directly killed omission of the fix-site header." }
    no_op_deletion: { result: pass, deletion_justified_by_rca: false }
    adjacent_tests:
      result: pass
      suites_run:
        - "ci:local: dependency audit, 422/422 tests, zero generation drift"
        - "post-fallback repair: readiness workflow 10/10, uploader 13/13, tar 4/4, release readiness 7/7, seal 5/5"
        - "post-fallback ci:local: dependency audit, 423/423 tests, zero generation drift, pack 17/17, five-host packaged smoke 12/12"
        - "pack audit 17/17"
        - "five-host packaged smoke 12/12"
    revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true }
    guardrail_verdict: "locally accepted; pending hosted reconfirmation"
    hosted_environment: "candidate db50cf873f242f7a4c729fe782b2ac3d4f339ca7 and run 33255729362 are retired after package success plus four identical packaged-contract failures and zero receipts; failed run 33248323460 also remains retired"
- files_changed:
  - src/maintainer/github-artifact-upload.cts
  - tests/maintainer/github-artifact-upload.test.cts
  - src/maintainer/readiness-workflow.cts
  - tests/maintainer/readiness-workflow.test.cts
  - plugin-src/environments/qa.mcp.json
  - kcoderag-qa/.mcp.json
  - kcoderag-qa/.codex.mcp.json
  - kcoderag-cursor/.cursor-plugin/plugin.json
  - tests/generator/repository-generation.test.cts
