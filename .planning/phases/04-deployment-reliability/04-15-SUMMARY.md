---
phase: 04-deployment-reliability
plan: 15
subsystem: release
tags: [npm, github-actions, provenance, asvs, smoke-testing]

requires:
  - phase: 04-deployment-reliability
    provides: QA-only Node package, exact release helper, four-lane workflows, public smoke harness, and documentation contracts
provides:
  - Immutable public kcoderag-nav 0.2.0 release from a separately attested implementation subject
  - Four-lane ordinary and tag Release evidence with a dependent successful npm publish job
  - Closed schema v4 receipt binding subject, evidence, release, Registry artifact, and exact/latest host lifecycle
affects: [05-hook-precision, 06-real-host-evidence, 08-production-release]

actuals:
  tokens: 11819
  tasks: 3
  commits: 10

tech-stack:
  added: []
  patterns: [direct-child evidence attestation, immutable five-path release, closed public publication receipt]

key-files:
  created:
    - .planning/phases/04-deployment-reliability/04-REVIEW.md
    - .planning/phases/04-deployment-reliability/04-SECURITY.md
    - .planning/phases/04-deployment-reliability/04-PRE-RELEASE-VERIFICATION.md
    - .planning/phases/04-deployment-reliability/04-15-PUBLISH-RECEIPT.json
  modified:
    - src/maintainer/pre-release-evidence.cts
    - src/maintainer/publish-receipt.cts
    - tests/maintainer/docs-check.test.cts
    - package.json
    - package-lock.json

key-decisions:
  - "The implementation subject, evidence commit, and release commit remain three distinct immutable Git identities in one direct-child chain."
  - "A failed first ordinary-CI attestation was retired in history; only a newly frozen subject and newly generated evidence were eligible for release."
  - "Public 0.2.0, its tag, and latest are immutable; any future deployment defect fixes forward as 0.2.1."

patterns-established:
  - "Evidence boundary: three closed verdict files attest their parent subject, then exact ordinary CI validates the evidence commit before version mutation."
  - "Publication boundary: the audited helper alone creates the five-path release commit/tag; the tag workflow alone publishes after four required lanes."
  - "Receipt boundary: persist only closed metadata, booleans, digests, and immutable lineage—never configuration, process output, or credentials."

requirements-completed: [DEP-01]

coverage:
  - id: D1
    description: Independent review, ASVS-L1 security, and goal-backward verdicts bind the frozen implementation subject and its direct-child evidence commit.
    requirement: DEP-01
    verification:
      - kind: integration
        ref: "node dist/maintainer/pre-release-evidence.cjs --verify ... --from-git --require-remote origin/master --require-ci-evidence <normalized>"
        status: pass
      - kind: e2e
        ref: "GitHub Actions CI run 32849986881: exact Ubuntu/Windows by Node 22/24 required matrix"
        status: pass
    human_judgment: false
  - id: D2
    description: The audited helper created and published immutable 0.2.0 from the exact five-path direct child of the evidence commit.
    requirement: DEP-01
    verification:
      - kind: e2e
        ref: "GitHub Actions Release run 32852095792: four required lanes plus dependent publish"
        status: pass
      - kind: integration
        ref: "node dist/maintainer/publish-receipt.cjs --verify .planning/phases/04-deployment-reliability/04-15-PUBLISH-RECEIPT.json"
        status: pass
    human_judgment: false
  - id: D3
    description: Official Registry exact/latest metadata and artifact hashes converge on 0.2.0, with fresh Codex, Claude Code, and Cursor lifecycle evidence.
    requirement: DEP-01
    verification:
      - kind: e2e
        ref: "node dist/smoke/host-smoke.cjs --mode required-contract --package-spec kcoderag-nav@0.2.0 --expected-version 0.2.0"
        status: pass
      - kind: e2e
        ref: "node dist/smoke/host-smoke.cjs --mode required-contract --package-spec kcoderag-nav@latest --expected-version 0.2.0"
        status: pass
    human_judgment: false

duration: 1h 32m
completed: 2026-08-25
status: complete
---

# Phase 04 Plan 15: Immutable 0.2.0 Publication Summary

**Public `kcoderag-nav@0.2.0` now has independently bound review evidence, exact four-lane CI and Release gates, Registry artifact hashes, and fresh three-host exact/latest lifecycle proof.**

## Performance

- **Duration:** 1h 32m
- **Started:** 2026-08-25T12:00:27Z
- **Completed:** 2026-08-25T13:32:00Z
- **Tasks:** 3
- **Files modified:** 14 task files plus this summary and sequential tracking

## Accomplishments

- Froze implementation subject `223bb76d034f9acd3868c36706f8d1c8762bd515` and bound CLEAN, SECURED, and PASS verdicts in direct-child evidence commit `cfcf49ac43caf638f8cc2078af9f57ff2a0e25dd`.
- Passed ordinary CI run `32849986881` and tag Release run `32852095792` across Ubuntu/Windows and Node 22/24; the dependent publish job completed successfully.
- Published immutable `kcoderag-nav@0.2.0` at release commit `827a98cec04e34afe4571f87486f5841e79d153a`, with official exact/latest metadata, SRI/tar hashes, and fresh Codex/Claude Code/Cursor smokes recorded in a closed receipt.

## Task Commits

Each task was committed atomically:

1. **Task 1: Freeze, audit, attest, and validate the final evidence commit**
   - `b44720b` — failing executable evidence-validator contract
   - `8774286` — executable pre-release evidence validator
   - `5dd6aa1` — failing closed release-lineage receipt contract
   - `7c0a39f` — schema v4 audited release lineage
   - `4bbe13d` — first attestation, retained as failed historical evidence
   - `fba0958` — hermetic documentation CLI fixture after real CI finding
   - `223bb76` — stale attestation retirement and replacement subject freeze
   - `cfcf49a` — final three-path subject-bound evidence commit
2. **Task 2: Create exact local 0.2.0 release commit/tag with the audited helper** — `827a98c`
3. **Task 3: Publish through tag gates and record closed public evidence** — `73b17b7`

## Files Created/Modified

- `.planning/phases/04-deployment-reliability/04-REVIEW.md` — CLEAN review bound to the implementation subject.
- `.planning/phases/04-deployment-reliability/04-SECURITY.md` — SECURED ASVS-L1 audit with zero open high/critical threats.
- `.planning/phases/04-deployment-reliability/04-PRE-RELEASE-VERIFICATION.md` — PASS goal-backward requirement and decision coverage.
- `.planning/phases/04-deployment-reliability/04-15-PUBLISH-RECEIPT.json` — schema v4 public lineage, workflow, Registry artifact, and lifecycle evidence.
- `src/maintainer/pre-release-evidence.cts` and its tests — executable closed evidence/Git/CI validator.
- `src/maintainer/publish-receipt.cts` and its tests — distinct subject/evidence/release lineage validation.
- `tests/maintainer/docs-check.test.cts` — hermetic zero-argument sibling-guide discovery fixture.
- `package.json`, `package-lock.json`, and three host compatibility manifests — exact audited-helper version bump to `0.2.0`.

## Decisions Made

- The first evidence commit was never reused after its ordinary CI failed. Its attestation was retired by a forward commit, a new subject was frozen, all gates were replayed, and a new direct-child evidence commit was created.
- The public Registry artifact is accepted only when exact and latest resolve to the release commit and the canonical tarball's SRI, SHA-256, and SHA-512 agree.
- The tag stays on the release commit while the later receipt commit advances master; the immutable release identity is not rewritten.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added the executable pre-release evidence CLI required by the release gate**
- **Found during:** Task 1
- **Issue:** Library validation existed, but the planned strict CLI entrypoint could not bind evidence files, Git ancestry, remote head, and normalized CI evidence.
- **Fix:** Added a closed argument parser and metadata-only executable validation path with negative tests.
- **Files modified:** `src/maintainer/pre-release-evidence.cts`, `tests/maintainer/pre-release-evidence.test.cts`
- **Verification:** Focused tests and every subsequent `npm run ci:local` passed.
- **Committed in:** `b44720b`, `8774286`

**2. [Rule 2 - Missing Critical] Bound the receipt to distinct implementation, evidence, and release identities**
- **Found during:** Task 1
- **Issue:** Receipt schemas could not prove that review evidence attested a separate parent subject or that the release was its direct child.
- **Fix:** Added closed schema v4 lineage fields and exact relationship checks while retaining v1-v3 behavior.
- **Files modified:** `src/maintainer/publish-receipt.cts`, `tests/maintainer/publish-receipt.test.cts`
- **Verification:** Receipt tests, full local gates, and the final offline public receipt validator passed.
- **Committed in:** `5dd6aa1`, `7c0a39f`

**3. [Rule 1 - Bug] Made the canonical documentation CLI test independent of a private sibling checkout**
- **Found during:** Task 1 ordinary CI run `32847628809`
- **Issue:** All four remote lanes failed the same zero-argument test because the public runner did not contain the adjacent private service repository.
- **Fix:** Built an isolated temporary canonical sibling fixture and ran the compiled CLI from that layout.
- **Files modified:** `tests/maintainer/docs-check.test.cts`
- **Verification:** Focused docs tests, full local gates, ordinary CI `32849986881`, and tag Release `32852095792` passed.
- **Committed in:** `fba0958`

**4. [Rule 1 - Bug] Invalidated stale attestation after the real CI defect changed the subject**
- **Found during:** Task 1 after the failed ordinary CI run
- **Issue:** The first three verdict files were bound to a superseded subject and could not be carried forward.
- **Fix:** Deleted the stale evidence in a forward historical commit, froze the corrected subject, reran all audits/gates, and created a new exact three-path evidence child.
- **Files modified:** the three Phase 04 verdict artifacts
- **Verification:** Direct-parent/diff validation and the executable pre-release validator passed against the new subject/evidence pair.
- **Committed in:** `223bb76`, `cfcf49a`

---

**Total deviations:** 4 auto-fixed (2 missing critical, 2 bugs).
**Impact on plan:** All fixes tightened release integrity or made required CI portable; no public product scope was added.

## Issues Encountered

- Ordinary CI run `32847628809` failed all four lanes at the same hermeticity defect. No raw logs or credentials were persisted; only stable job/test identity was used to diagnose it.
- The Registry briefly returned pre-convergence metadata immediately after publish. A bounded retry converged exact and latest to `0.2.0` before any receipt claim was written.
- GitHub emitted a non-failing hosted-actions Node-runtime deprecation annotation. Package runtime coverage remained the required Node 22/24 matrix; workflow-action migration is not a release blocker for this immutable publication.

## User Setup Required

None - the configured publication authority was present and the automated tag workflow published successfully.

## Known Stubs

None.

## Next Phase Readiness

- Phase 04 deployment reliability has complete immutable release evidence for `0.2.0`.
- Phase 05 can improve Hook precision without changing this release receipt; Phase 06 remains responsible for authenticated real-service evidence.
- Any defect discovered after this publication must use a `0.2.1` fix-forward release. No tag replacement, unpublish, or latest rollback is permitted.

## Self-Check: PASSED

- Summary, three verdicts, and closed publication receipt exist.
- All ten task commits resolve in Git history.
- The publication receipt verifies offline against schema v4.

---
*Phase: 04-deployment-reliability*
*Completed: 2026-08-25*
