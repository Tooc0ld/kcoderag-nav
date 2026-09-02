---
phase: 06-skill
plan: "01"
subsystem: host-integration
tags: [skills, codex, claude-code, cursor, opencode, zcode, mcp, hooks]

requires: []
provides:
  - Four stable public Skills across all five supported hosts
  - Manual code-style delivery on every host with exact-Claude native automation gating
  - Integrity-derived manualSkill and automaticNudge status and doctor diagnostics
  - Deterministic generated products, package audit, and five-host packaged smoke evidence
affects: [05-hook-precision, host-adapters, package-readiness, public-documentation]

actuals:
  tokens: 78956
  tasks: 1
  commits: 2

tech-stack:
  added: []
  patterns:
    - Public Skill identity remains separate from internal capability identity
    - Manual Skill delivery is the base layer and receipt-backed native automation is an overlay
    - Host reconciliation is authorized only by exact previous-state ownership and digests

key-files:
  created:
    - plugin-src/skills/kcoderag/SKILL.md
    - plugin-src/skills/kcoderag-manage/SKILL.md
    - plugin-src/skills/kcoderag-feedback/SKILL.md
    - plugin-src/capabilities/code-style-nudge/skill/agents/openai.yaml
  modified:
    - src/capabilities/navigation.cts
    - src/capabilities/code-style-nudge.cts
    - src/core/state.cts
    - src/cli/commands.cts
    - src/generator/index.cts
    - src/hosts/claude.cts
    - src/hosts/codex.cts
    - src/hosts/cursor.cts
    - src/hosts/opencode.cts
    - src/hosts/zcode.cts
    - src/smoke/host-smoke.cts

key-decisions:
  - "Expose exactly $kcoderag, $kcoderag-manage, $kcoderag-feedback, and $kcoderag-code-style without compatibility aliases."
  - "Keep kcoderag-navigation and code-style-nudge as the two internal capabilities while reporting manualSkill and automaticNudge independently."
  - "Deliver manual code-style guidance to all five hosts, but enable native pre-write automation only for the frozen Claude Code 2.1.241 receipt."
  - "Keep public style invocation advisory and review-oriented; apply_patch remains only a host tool event, not a public Skill operation."

patterns-established:
  - "Public interface split: navigation is read-only, management defaults to diagnostics, feedback is result-backed, and style requires explicit preparation or review intent."
  - "Generated Skill trees: canonical templates deterministically project QA and Cursor products, including quoted Codex metadata."
  - "Honest delivery status: complete schema-v1 ownership and individual/composite digests are required before availability claims."

requirements-completed: []

coverage:
  - id: D1
    description: "Five hosts expose exactly the four current public Skill identities with no retired aliases."
    verification:
      - kind: integration
        ref: "dist-tests/skills/public-skills.test.cjs and npm run generate:check"
        status: pass
    human_judgment: false
  - id: D2
    description: "Manual code-style guidance is available on all hosts while automaticNudge is available only for exact Claude Code 2.1.241."
    verification:
      - kind: integration
        ref: "npm run test:capabilities and five host adapter suites"
        status: pass
      - kind: e2e
        ref: "npm run smoke:required"
        status: pass
    human_judgment: false
  - id: D3
    description: "Status and doctor report manualSkill and automaticNudge from complete contributor and digest integrity without exposing configuration values."
    verification:
      - kind: integration
        ref: "npm run test:cli and host status/doctor fixtures"
        status: pass
    human_judgment: false
  - id: D4
    description: "Additive install, update, selective uninstall, rollback, and cross-host coexistence preserve sibling and unrelated bytes."
    verification:
      - kind: integration
        ref: "npm run test:transaction and npm run test:cross-host"
        status: pass
      - kind: e2e
        ref: "npm run smoke:required"
        status: pass
    human_judgment: false
  - id: D5
    description: "The same staged tree passes generation, documentation, retirement, full CI, package, and five-host packaged readiness gates."
    verification:
      - kind: other
        ref: "index-exact npm run ci:local, npm run pack:audit, and npm run smoke:required"
        status: pass
    human_judgment: false

duration: 2h 45m
completed: 2026-09-03
status: complete
---

# Phase 06 Plan 01: Four Public Skills Convergence Summary

**Four stable public Skills now project through Codex, Claude Code, Cursor, OpenCode, and ZCode with manual style everywhere, exact-Claude native automation, integrity-backed diagnostics, and one deterministic package contract.**

## Performance

- **Duration:** 2h 45m
- **Started:** 2026-09-02T16:13:44Z
- **Completed:** 2026-09-02T18:58:37Z
- **Tasks:** 1
- **Files modified:** 93

## Accomplishments

- Replaced the retired public lookup/style names with exactly `$kcoderag`, `$kcoderag-manage`, `$kcoderag-feedback`, and `$kcoderag-code-style` across canonical, generated, host, documentation, audit, and packaged surfaces.
- Separated universal manual code-style delivery from the receipt-backed native overlay: only Claude Code 2.1.241 receives automatic pre-write guidance, while all five hosts receive the manual Skill.
- Added independent `manualSkill` and `automaticNudge` health reporting based on complete current-state ownership and digests, including unsupported, absent, unknown, and drifted outcomes.
- Proved additive and reverse-order composition, selective removal, rollback, source-conflict refusal, deterministic generation, and five-host packaged lifecycle behavior from one exact staged tree.

## Task Commits

1. **RED: Define four-Skill navigation contract** - `c821975` (test)
2. **GREEN: Deliver four public Skills across five hosts** - `47e851a` (feat)

## Files Created/Modified

- `plugin-src/skills/` - Canonical navigation, management, and feedback Skill families plus quoted Codex metadata.
- `plugin-src/capabilities/code-style-nudge/skill/` - Renamed public style Skill, four selective references, and Codex metadata.
- `src/capabilities/` - Two-capability registry with manual-base/native-overlay support policy.
- `src/core/state.cts` and `src/cli/commands.cts` - Integrity-derived delivery diagnostics for status and doctor.
- `src/hosts/` - Five host projections and exact previous-state reconciliation for both install orders.
- `src/generator/index.cts` - Explicit deterministic routing for the four public Skill trees.
- `src/maintainer/` and `src/smoke/host-smoke.cts` - Current-name retirement, pack, pre-commit, and five-host packaged gates.
- `tests/hooks/launcher.test.cts` - Suite-owned reminder cache roots so launcher verification is hermetic without changing production cache behavior.
- `tests/maintainer/release.test.cts` - Tag-free real-repository snapshot clone while retaining independent collision coverage.

## Decisions Made

- Public Skill names are interface identities only; the installed capability IDs remain `kcoderag-navigation` and `code-style-nudge`.
- Manual style is the portable base contract. Native automation remains a separate exact-receipt overlay and is not inferred from host shape or version text.
- The style Skill prepares guidance and reviews files or current changes; it does not expose a public `apply` operation or implicit edit authority.
- Status and doctor make positive delivery claims only from contributor-scoped schema-v1 ownership plus individual and composite digest integrity.

## Deviations from Plan

None - the final superseding plan and its independently reviewed recovery amendments explicitly covered the release snapshot and hermetic launcher verification fixes.

## Issues Encountered

- A linked-worktree direct pre-commit initially observed stat-cache churn after staged-tree materialization. The final exact-tree verification stabilized the linked index, then re-proved all 600 blobs, 15 deletions, and main-index identity before and after the gate chain.
- The real-repository release snapshot inherited unrelated local tags, so only that snapshot clone now uses `--no-tags`; the independent collision fixture and production tag checks remain unchanged.
- Launcher tests inherited a saturated machine-global reminder cache. The test suite now supplies and cleans exact suite-owned cache roots; production cache lookup, saturation, and fail-open behavior are unchanged.
- `state.advance-plan` retained the superseded thirteen-plan count after the convergence plan completed. The execution metadata was narrowed to the authoritative one-plan Phase 06 inventory while preserving the handler-recorded metric, decisions, and session.

## User Setup Required

None - no external service configuration or LIVE host action was performed.

## Next Phase Readiness

- Phase 06 packaged delivery is complete and ready for normal verification or later release-readiness work.
- Phase 05 remains independently incomplete by explicit execution-order override; this phase does not claim LIVE host evidence, workflow dispatch, publication, or production identity/HTTPS/token rotation.

## Self-Check: PASSED

- Summary and four canonical public Skill entrypoints exist.
- RED commit `c821975` and GREEN commit `47e851a` are present in repository history.

---
*Phase: 06-skill*
*Completed: 2026-09-03*
