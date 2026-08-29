---
status: resolved
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
- hypothesis: RESOLVED — exact singleton ownership plus the existing identity checks accepts the service-derived basename, all four hosted lanes verify one immutable package, and the human-verify checkpoint accepts that evidence for the real release-readiness workflow.
- test: record the explicit human confirmation for candidate 0bf617b7becf65b3d336027d895183ced313ad4c and readiness run 33257947461.
- expecting: the resolved session remains archived and its blameless recurrence guards remain available through the durable debug knowledge base.
- next_action: none — the issue is resolved, human-verified, and archived.
- candidate_causes:
    - "code: the lane resolver's accepted topology remains narrower than the exact pinned action contract"
    - "integration/config: `artifact-ids` plus a single result selects a distinct output-directory rule"
    - "environment/service: hosted Content-Disposition or MIME metadata selects another raw branch"
    - "data: downloaded digest, size, or tar membership differs from the producer"
- and_gate: "yes — the service-derived third basename and the consumer's two-name restriction are both required; exact hosted/local SHA and size eliminate data corruption."
- reasoning_checkpoint:
    hypothesis: "All four hosted lanes fail before smoke because the service supplies a sanitized raw-file basename outside the consumer's two-name allowlist, even though the singleton file's bytes are the exact producer artifact."
    confirming_evidence:
      - "Run 33257364747 reports `downloaded_artifact_name_invalid` independently on all four Windows/Linux Node 22/24 lanes through a closed annotation."
      - "The exact pinned official bundle writes one direct raw file using Content-Disposition's sanitized basename or literal `artifact`; every download step succeeds."
      - "Hosted artifact SHA-256 and byte size equal a fresh local package whose tar parser finds 77 valid members and whose five-host smoke passes."
    falsification_test: "If accepting an arbitrary singleton direct filename cannot make the local third-name oracle pass, or the next hosted candidate still reports the name stage, the hypothesis is false; a later distinct stage would establish an additional contributing defect."
    fix_rationale: "A basename is presentation metadata, not artifact identity. Exact singleton ownership plus realpath containment, non-link regular-file checks, O_NOFOLLOW identity, SHA-256, tar parsing, and member count authenticate the only candidate without trusting a mutable response header."
    blind_spots: "Only an immutable hosted rerun can prove no later environment-only stage also fails after the confirmed name gate is removed."
    candidate_causes:
      - "code: the consumer treats two presentation basenames as an ownership allowlist"
      - "environment/service: hosted Content-Disposition supplies a third sanitized basename"
      - "data: artifact bytes or tar membership differ from producer metadata"
    and_gate: "yes — the observed failure requires both the service-derived third basename and the consumer's unnecessary two-name restriction; exact hosted/local SHA and size eliminate data corruption as a co-cause."
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

- timestamp: 2026-08-29
  checked: immutable candidate 082c1f0 and hosted readiness run 33256852041
  found: package/upload passed; all four official downloads passed; all four lanes then failed packaged-contract verification before receipts. The one hosted artifact has the exact same SHA-256 and byte size as a fresh local candidate package with 77 valid members, and the six-field private repository baseline remained identical after hosted operations.
  implication: candidate corruption, artifact substitution, and local-state mutation are eliminated; the fallback-only repair did not reach the actual pre-smoke boundary.

- timestamp: 2026-08-29
  checked: exact public bundled runtime at pinned actions/download-artifact commit 3e5f45b2
  found: the bundle writes a non-ZIP response directly under the requested directory, using Content-Disposition's sanitized basename when present and literal `artifact` otherwise; there is no pinned-version topology difference from the inspected toolkit source.
  implication: another observable resolver condition—not an action source-version mismatch—must explain the pre-smoke failure; stage-only hosted telemetry is required before relaxing the filename policy.

- timestamp: 2026-08-29
  checked: closed resolver-stage observability implementation
  found: build passed and focused readiness workflow tests passed 11/11; hosted annotations accept only seven fixed stage codes, reject arbitrary/value-bearing strings, and preserve the existing metadata-only JSON failure result.
  implication: one observability candidate can distinguish the remaining pre-smoke branches without exposing downloaded names, paths, URLs, config, or bytes.

- timestamp: 2026-08-29
  checked: exact telemetry staged set and normal commit hook
  found: exactly the debug record, readiness workflow source, and readiness workflow test committed as 1eafdf3 through the normal hook; unrelated planning state remained unstaged.
  implication: a tree-identical descendant can safely run the metadata-only localization experiment.

- timestamp: 2026-08-29
  checked: observability candidate freeze and source-only preflight
  found: candidate ac67cf2 is tree-identical to telemetry commit 1eafdf3 and passes build, zero-drift generation, zero findings across 507 immutable Git objects, and dependency audit.
  implication: the candidate may advance the dedicated readiness ref solely to surface a closed resolver-stage annotation.

- timestamp: 2026-08-29
  checked: observability candidate ac67cf2 and hosted run 33257364747
  found: package/upload and all four downloads passed; all four lane check annotations independently reported only `downloaded_artifact_name_invalid`; the six-field private repository baseline remained identical.
  implication: the filename allowlist is the directly observed pre-smoke root cause; no raw log, downloaded filename, path, or artifact byte was inspected.

- timestamp: 2026-08-29
  checked: presentation-name-independent singleton regression
  found: before the production change, a valid candidate package under a third direct-child basename failed with downloaded_artifact_name_invalid; after replacing the two-name allowlist with exact singleton ownership, that oracle and the stage-annotation test pass 2/2 while empty/multiple roots and invalid tar bytes remain rejected.
  implication: the minimal fix removes only unauthoritative name trust and preserves every direct-child, link, file identity, digest, tar, member, and lease boundary.

- timestamp: 2026-08-29
  checked: complete local CI after singleton identity repair
  found: dependency audit passed, the complete suite passed 424/424, generation had zero drift, pack passed 17/17, and five-host packaged smoke passed 12/12.
  implication: all applicable local fix-acceptance signals pass; one immutable hosted reconfirmation remains.

- timestamp: 2026-08-29
  checked: exact final repair staged set and normal commit hook
  found: exactly the debug record, readiness workflow source, and readiness workflow test committed as 73f6c9a through the normal hook; unrelated planning state remained unstaged.
  implication: a tree-identical descendant can become the final hosted singleton candidate.

- timestamp: 2026-08-29
  checked: final candidate freeze and source-only preflight
  found: candidate 0bf617b is tree-identical to repair 73f6c9a and passes build, zero-drift generation, zero findings across 507 immutable Git objects, and dependency audit; the complete 424-test/pack/smoke gate already passed on the identical tree.
  implication: the final candidate is locally eligible for ordinary fast-forward hosted reconfirmation.

- timestamp: 2026-08-29
  checked: final candidate 0bf617b and hosted readiness run 33257947461
  found: package/upload passed; Linux and Windows Node 22/24 all downloaded and verified the same package; all four lane jobs passed and the closed four-receipt verifier passed. Hosted artifact SHA-256 and byte size exactly match a fresh local 77-member candidate package, and the six-field private repository baseline remained identical.
  implication: the original readiness-artifact-invalid symptom is resolved on every required hosted lane without raw logs or artifact download; ordinary hosted CI remains the last optional in-progress corroborating signal.

- timestamp: 2026-08-29
  checked: ordinary hosted CI run 33257947517 metadata
  found: both Ubuntu Node 22/24 jobs passed checkout, build, dependency audit, and launcher smoke but failed during the complete Node test suite; annotations contain only generic exit status. Windows CI lanes remain in the test suite. Exact readiness on the same candidate passed every required lane.
  implication: this is a distinct corroborating test-suite issue after the original workflow is verified; reproduce the exact candidate on Linux locally without reading raw hosted logs.

- timestamp: 2026-08-29
  checked: clean official Node 22 Linux container plus prior candidate CI metadata
  found: the exact candidate's Linux test suite reproduces seven existing CLI host-version fixture/generated-product portability failures outside readiness workflow code; retired pre-repair candidate db50cf8's ordinary CI run 33255729393 already failed the same Ubuntu Node 22/24 complete-test step.
  implication: ordinary CI is a documented pre-existing independent issue, not a regression from the singleton repair and not a failure of the exact readiness workflow that passed all four lanes.

- timestamp: 2026-08-29
  checked: human-verify checkpoint response for the real release-readiness workflow
  found: The user explicitly confirmed that immutable candidate 0bf617b7becf65b3d336027d895183ced313ad4c and readiness run 33257947461 resolve the real workflow issue.
  implication: The original issue is verified end-to-end and the session can be marked resolved and archived.

## Eliminated

- hypothesis: The pinned action bundle differs from current toolkit source by using another fallback basename or nested raw output directory.
  evidence: Exact commit 3e5f45b2's public bundled runtime uses a direct child and the same literal `artifact` fallback.

- hypothesis: Accepting exactly the current toolkit source's literal raw fallback basename `artifact` is sufficient for hosted lanes.
  evidence: Candidate 082c1f0 includes that bounded resolver and passes its red/green regression, but run 33256852041 still has four successful downloads followed by four identical fast packaged-contract failures and zero receipts.

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

- timestamp: 2026-08-29
  checked: exact staged repair set and normal commit hook
  found: exactly the debug record, readiness workflow source, and readiness workflow regression test committed as d373c45; the unrelated planning change and untracked material remained outside the index.
  implication: the bounded fallback repair is immutable in Git and a tree-identical descendant can now become the next hosted candidate.

- timestamp: 2026-08-29
  checked: candidate freeze and source-only preflight
  found: candidate 082c1f0 has sole parent d373c45, is tree-identical to that repair, descends from retired candidate db50cf8, passes build and generation, has zero findings across 507 immutable Git objects, and passes dependency, uploader 13/13, workflow 10/10, release-readiness 7/7, and seal 5/5 gates.
  implication: the new immutable candidate is locally eligible for one ordinary fast-forward hosted verification run.

## Resolution

- root_cause:
  - "The official downloader produced one exact raw artifact under a third service-derived sanitized basename, while the lane consumer incorrectly treated two presentation basenames as an ownership allowlist and rejected before authoritative SHA/tar/host checks."
  - "The canonical MCP source retained a terminal pathname slash, so restoring the generated file to the tracked baseline left the required candidate state noncompliant; the prior ZCode-only projection fix did not correct the source of truth."
- oracle_type: specified
- fix: "Treat the private download root's exact singleton as the candidate independently of presentation basename, while retaining lstat/realpath/direct-child/O_NOFOLLOW/file-identity/SHA/tar/member/lease checks and closed stage-only hosted annotations. Also normalize the terminal MCP pathname in the canonical source, regenerate its three products, and guard canonical/projected paths secret-safely."
- verification:
    target_test: { result: pass }
    mutation_check: { result: skipped, reason_if_skipped: "Stryker is not configured or installed; the independent pre-fix third-name oracle directly killed omission of the singleton identity repair." }
    no_op_deletion: { result: pass, deletion_justified_by_rca: false }
    adjacent_tests:
      result: pass
      suites_run:
        - "ci:local: dependency audit, 422/422 tests, zero generation drift"
        - "post-fallback repair: readiness workflow 10/10, uploader 13/13, tar 4/4, release readiness 7/7, seal 5/5"
        - "post-fallback ci:local: dependency audit, 423/423 tests, zero generation drift, pack 17/17, five-host packaged smoke 12/12"
        - "post-singleton ci:local: dependency audit, 424/424 tests, zero generation drift, pack 17/17, five-host packaged smoke 12/12"
        - "pack audit 17/17"
        - "five-host packaged smoke 12/12"
    revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true }
    guardrail_verdict: "accepted for original issue; ordinary Ubuntu CI failure documented as pre-existing and independent"
    hosted_environment: "final candidate 0bf617b7becf65b3d336027d895183ced313ad4c and readiness run 33257947461 passed package, all four Windows/Linux Node 22/24 lane receipts, and closed verify-lanes; one artifact's metadata digest/size matched the fresh local 77-member package and private local state stayed unchanged; prior failed/observability candidates and runs remain retired"
    human_confirmation: "accepted on 2026-08-29 for immutable candidate 0bf617b7becf65b3d336027d895183ced313ad4c and readiness run 33257947461"
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

## Prevention

- causal_branches:
  - "code/integration: the consumer converted producer metadata into a two-name local-path allowlist; the pinned downloader instead materialized the authenticated singleton using a service-controlled sanitized presentation basename, so rejection occurred before authoritative SHA/tar/host checks."
  - "config/validation: the canonical MCP source retained a terminal `/mcp/` pathname and deterministic generation faithfully propagated it because the repository gate checked source/product consistency without independently asserting the slash-free endpoint contract."
- and_gate: "yes for the download failure — both the service-derived third basename and the consumer's two-name restriction were required; no for the endpoint defect — the canonical trailing slash alone made every faithful projection noncompliant."
- why_not_caught: "The readiness workflow test had no third presentation-basename neighbor and normalized all early resolver failures to one safe class; the repository generation gate compared projections to their canonical source but had no independent slash-free canonical-path assertion. Typecheck and ordinary generation checks could not detect either semantic contract gap."
- recurrence_guard: "Regression test `downloaded lease authenticates exactly one direct raw file independent of presentation basename` in tests/maintainer/readiness-workflow.test.cts covers canonical, fallback, third-name, empty, ambiguous, and invalid-archive neighbors; `compiled repository gate proves all generated products canonical without repository writes` in tests/generator/repository-generation.test.cts asserts slash-free canonical and projected MCP paths; `block stage and block list commit preserve the exact private lease buffer` in tests/maintainer/github-artifact-upload.test.cts preserves the block-list Content-Disposition contract."
