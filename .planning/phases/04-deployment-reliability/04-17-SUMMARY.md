---
phase: 04-deployment-reliability
plan: 17
subsystem: generated-qa-registration-guidance
tags: [qa-only, generator, mcp, codex, claude-code, hooks, deterministic-inventory]

requires:
  - phase: 04-deployment-reliability
    provides: Plan 07 atomic QA-only canonical/product transition and public Dev retirement
  - phase: 04-deployment-reliability
    provides: Plan 08 self-contained QA Hook runtime and launcher closure
  - phase: 04-deployment-reliability
    provides: Plan 04 nearest-project rootless registration and damaged-boundary behavior
provides:
  - Fresh zero-write proof for five QA registration and opaque MCP metadata assets
  - Fresh zero-write proof for the QA agent and shared lookup skill
  - Closed deterministic twelve-file non-document QA product evidence
  - Canonical registration linkage to the digest-verified project-contained launchers
affects: [phase-04-pack, phase-04-release, phase-04-head-acceptance, phase-05-hook-precision]

actuals:
  tokens: 3345
  tasks: 2
  commits: 1

tech-stack:
  added: []
  patterns:
    - Verification-only plan closure preserves the atomic production provenance when every fresh render is byte-identical
    - MCP evidence is restricted to safe paths, byte sizes, SHA-256 digests, JSON validity, and server counts

key-files:
  created:
    - .planning/phases/04-deployment-reliability/04-17-SUMMARY.md
  verified:
    - kcoderag-qa/.codex.mcp.json
    - kcoderag-qa/.mcp.json
    - kcoderag-qa/.claude-plugin/plugin.json
    - kcoderag-qa/.codex-plugin/plugin.json
    - kcoderag-qa/hooks/hooks.json
    - kcoderag-qa/agents/kcode-explorer.md
    - kcoderag-qa/skills/code-lookup-discipline/SKILL.md
    - tests/generator/qa-product.test.cts

key-decisions:
  - "Plan 04-17 retains atomic implementation commit 022a9d8 because fresh registration, config, and guidance rendering produced zero changed or written paths."
  - "The current Hook registration remains the Plan 04 canonical rootless command rather than reverting to a plugin-root command; its selected launcher remains project-contained and digest verified."
  - "Opaque MCP projections are verified only through metadata and digests; no endpoint, header, Bearer, or configuration body enters evidence."
  - "Main-tree tracking updates progress, metrics, roadmap, and session while retaining Current Plan 10, the earliest incomplete plan; out-of-order Plan 17 closure must not blindly increment it."

patterns-established:
  - "Split-product closure: Plan 08 owns executable bytes, Plan 17 owns registration/guidance, and the exact twelve-file test proves their combined non-document inventory."
  - "Layered provenance: 022a9d8 owns the QA-only product transition while Plan 04 commits own nearest-root registration semantics."

requirements-completed: [DEP-01, DEP-02]

coverage:
  - id: D1
    description: "QA manifests, MCP projections, and Hook registration are QA-only, root-version-aligned, byte-canonical, and secret-safe."
    requirement: DEP-01
    verification:
      - kind: integration
        ref: "Plan Task 1 exact build and runtime-registration/metadata-config write+check commands; all changedPaths and writtenPaths empty"
        status: pass
      - kind: integration
        ref: "metadata-only manifest/registration/MCP assertion; version 0.1.8 aligned, canonical command matched, both opaque documents valid"
        status: pass
    human_judgment: false
  - id: D2
    description: "The QA agent and skill route only to QA while retaining the deferred Phase 05 precision boundary."
    requirement: DEP-01
    verification:
      - kind: integration
        ref: "Plan Task 2 exact metadata-guidance write+check and dist-tests/generator/qa-product.test.cjs (2/2)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The complete non-document QA product is exactly twelve deterministic files and registration reaches the tested nearest-project launchers."
    requirement: DEP-02
    verification:
      - kind: integration
        ref: "npm run generate:check; npm run test:generator; npm run test:generator:repository; npm run test:pack; npm run pack:audit"
        status: pass
      - kind: e2e
        ref: "npm run test:launcher (12/12), including root/deep/moved/nested/damaged-nearest execution"
        status: pass
    human_judgment: false

duration: 11min
completed: 2026-08-25
status: complete
---

# Phase 04 Plan 17: QA Registration, Metadata, and Guidance Closure Summary

**QA registration, opaque MCP projections, and graph-first guidance are byte-canonical and converge with the tested Hook runtime as an exact twelve-file non-document product.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-08-25T09:19:00Z
- **Completed:** 2026-08-25T09:30:16Z
- **Tasks:** 2
- **Files modified:** 1 documentation artifact; 8 declared plan artifacts verified without writes

## Accomplishments

- Re-ran the exact Task 1 registration/config write and check commands; all five selected assets reported no changed or written paths.
- Re-ran the exact Task 2 guidance write/check command and focused QA product suite; both guidance assets were canonical and both product tests passed.
- Proved the tracked QA tree has README plus exactly twelve non-document members, with fresh-render hash equality and no public Dev product.
- Matched the generated Hook registration to the canonical Plan 04 rootless command and passed root, deep, nested, moved, Unicode, damaged-nearest, and fail-open launcher tests.
- Kept MCP evidence limited to safe paths, sizes, SHA-256 digests, parse validity, and one-server counts; no connection value was printed or recorded.

## Task Commits

1. **Task 1: Regenerate QA registration and opaque MCP metadata** - `022a9d8` (shared atomic QA-only implementation), with rootless registration finalized by `24a9cb9` and `103d16a`; fresh generation produced zero writes.
2. **Task 2: Regenerate guidance and close the QA product inventory** - `022a9d8` (shared atomic QA-only implementation and focused product test); fresh generation produced zero writes.

**Implementation provenance:** The user-approved Plan 04-07 atomic migration had to transition canonical inputs, every generated replacement, and public Dev retirement together so the normal pre-commit gate never observed a partial product. Plan 04 subsequently replaced the compatibility Hook registration with the canonical nearest-project command. Plan 04-17 therefore closes through fresh verification rather than creating a second production commit.

## Files Created/Verified

- `kcoderag-qa/.codex.mcp.json`, `kcoderag-qa/.mcp.json` - Opaque QA MCP projections, verified through safe metadata and fresh canonical digests only.
- `kcoderag-qa/.codex-plugin/plugin.json`, `kcoderag-qa/.claude-plugin/plugin.json` - QA identity and exact root-version compatibility metadata.
- `kcoderag-qa/hooks/hooks.json` - Advisory Grep/Glob/Bash registration using the canonical rootless Plan 04 command and Plan 08 launchers.
- `kcoderag-qa/agents/kcode-explorer.md` - QA-only graph-first exploration guidance.
- `kcoderag-qa/skills/code-lookup-discipline/SKILL.md` - Host-neutral QA navigation discipline with explicit local fallback boundaries.
- `tests/generator/qa-product.test.cts` - Exact twelve-file inventory, fresh-render hash equality, version equality, and scoped Dev-reference rejection.
- `.planning/phases/04-deployment-reliability/04-17-SUMMARY.md` - Verification closure and cross-plan production provenance.

## Decisions Made

- Preserved `022a9d8` as the production implementation commit because every plan-owned generation command reported byte-identical output.
- Preserved Plan 04's rootless Hook command because it is the current canonical registration and is required for project-root, deep-child, moved-copy, and damaged-nearest behavior.
- Treated all MCP connection values as opaque; verification asserted only non-sensitive structural metadata and digests.
- Kept STATE's current position at the earliest incomplete Plan 10 while recording this out-of-order verification closure in progress, metrics, roadmap, and session continuity.

## Deviations from Plan

### Prior User-Approved Architectural Resolution

**1. [Rule 4 - Atomicity] Production work was absorbed by Plan 04-07**
- **Found during:** Original Plan 04-07 GREEN commit
- **Issue:** The normal pre-commit gate rejects a partially transitioned canonical/generated product, so Plan 17 files could not be committed independently after the QA-only switch.
- **Decision:** The user selected one atomic canonical/generation/retirement commit.
- **Implementation:** Commit `022a9d8` regenerated registration/guidance and created the focused QA product test together with the full QA-only transition.
- **Verification:** Both exact plan command sequences, repository generation, QA product, launcher, generator, real tgz, and pack gates passed without rewriting production files.

### Verification-Only Closure

**2. [Rule 3 - Provenance] Retained later nearest-root registration integration**
- **Found during:** Task 1 provenance comparison
- **Issue:** Commit `022a9d8` originally used plugin-root compatibility commands; Plan 04 later and intentionally replaced those bytes with the canonical rootless command required by D-05 through D-07.
- **Resolution:** Verified the current generated registration against `renderProjectHookCommands("claude")` and the Plan 04 launcher suite rather than restoring obsolete Plan 07 bytes.
- **Files modified:** None.
- **Verification:** Canonical registration equality passed and `npm run test:launcher` passed 12/12.

---

**Total deviations:** One prior user-approved architectural resolution and one verification/provenance adjustment; no new production deviation was required during Plan 04-17 closure.

## Verification Evidence

- Task 1 exact command sequence - build passed; runtime-registration and metadata-config write/check each returned `changedPaths=[]` and `writtenPaths=[]`.
- Task 2 exact command sequence - build passed; metadata-guidance write/check returned no changes; QA product tests passed 2/2.
- `npm run generate:check` - QA/Cursor 18-file generated inventory, zero drift.
- `npm run test:generator` - 10/10 passed, including deterministic rendering, metadata-only diagnostics, atomic rollback, and retired Dev rejection.
- `npm run test:generator:repository` - 2/2 passed, including missing/stale generated fixture refusal with read-only check mode.
- `npm run test:launcher` - 12/12 passed across root, deep Unicode, nested, moved, damaged-nearest, symlink, bound, and fail-open cases.
- Metadata-only assertion - both manifests matched root `0.1.8`; registration exactly matched the canonical rootless command; both opaque MCP documents parsed with one server each.
- `npm run test:pack` - 10/10 passed against a real temporary tgz and negative inventory/credential/runtime fixtures.
- `npm run pack:audit` - passed with exact version `0.1.8` and 48 archive entries.
- Post-generation production diff - empty for every plan-owned production/test path.

## Threat Model Closure

| Threat | Evidence | Result |
|--------|----------|--------|
| T-04-17-01 QA inventory tampering | Exact twelve-member assertion, fresh-render SHA-256 equality, repository generation negative fixtures, and real tgz equality | Mitigated |
| T-04-17-02 compatibility identity spoofing | Both manifest names are `kcoderag-qa` and versions equal the exact root package version | Mitigated |
| T-04-17-03 MCP information disclosure | Only path, size, SHA-256, parse boolean, and server count entered evidence; generator and pack disclosure tests passed | Mitigated |
| T-04-17-04 stale Hook registration denial of service | Registration equals the canonical rootless renderer and the complete 12-case launcher suite passed | Mitigated |

## Issues Encountered

None. Current production bytes already satisfy the plan and no regeneration write occurred.

## Authentication Gates

None.

## Known Stubs

None. A scoped `TODO`/`FIXME`/`coming soon`/`placeholder` scan of the non-opaque plan paths returned no matches.

## User Setup Required

None - no external service, credential, user configuration, or live MCP endpoint was inspected or changed.

## Next Phase Readiness

- QA registration, runtime, guidance, and package inventory are ready for the remaining Phase 04 package/release and Head acceptance plans.
- The current `0.1.8` version is correctly aligned; final `0.2.0` propagation remains owned by the later release plan.
- Main-tree progress can continue at Plan 10; this out-of-order absorbed-plan closure does not skip Plans 10 through 16.
- Phase 05 Hook precision and Phase 06 authenticated real-host MCP evidence remain deliberately unclaimed.

## Self-Check: PASSED

- The summary and all eight declared plan artifacts exist in the current main tree.
- Production commits `022a9d8`, `24a9cb9`, and `103d16a` are reachable from current history.
- Fresh exact task commands, build, generation, product, launcher, repository, and pack evidence all passed after the last production change.
- Coverage classification accepted all three deliverables as fully automated and passing.
- No plan-owned production/test path changed during closure, and pre-existing dirty/untracked user work remains untouched.

---
*Phase: 04-deployment-reliability*
*Completed: 2026-08-25*
