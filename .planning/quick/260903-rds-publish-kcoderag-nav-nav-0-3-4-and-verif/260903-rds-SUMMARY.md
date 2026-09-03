---
quick_id: 260903-rds
phase: quick-260903-rds
plan: "01"
subsystem: release
tags: [release, npm, github-actions, five-host, windows]
provides:
  - immutable public kcoderag-nav 0.3.5 release
  - release-CI fix that avoids duplicate packaged smoke
  - public exact/latest lifecycle evidence for the fifth Skill
affects: [release-workflow, package-version, npm, public-skills]
actuals:
  tasks: 3
  commits: 3
tech-stack:
  added: []
  patterns: [forward-only-release, partitioned-tests, public-npx-lifecycle]
key-files:
  modified: [.github/workflows/release.yml, tests/maintainer/release-workflow.test.cts, package.json, package-lock.json]
key-decisions:
  - "Keep v0.3.4 immutable and unpublished after its Windows jobs reached the 25-minute timeout."
  - "Use test:ci plus one explicit required packaged smoke in release CI, preserving coverage without running the smoke twice."
  - "Verify the public package through isolated real npx lifecycles; do not misuse readiness-lease-only required-contract smoke as a public acquisition path."
completed: 2026-09-03
status: complete
---

# Quick 260903-rds: publish kcoderag-nav 0.3.5

`kcoderag-nav@0.3.5` is published on npm and is the current `latest`. The release contains the fifth public `$kcoderag-update` Skill and the workflow fix needed to complete Windows release gates.

## Release sequence

- The first authorized release created immutable tag `v0.3.4` at `f41e7f5fdc19fc7d7de999d8eaa98b46ce687f09`.
- GitHub run `33751756287` passed both Ubuntu lanes, but both Windows lanes were cancelled at the 25-minute timeout while executing a second packaged smoke. The publish job was skipped, and npm remained at `0.3.3`.
- Commit `bf0945c` changed release CI from the aggregate `npm test` invocation to the established `npm run test:ci` partition while retaining the explicit five-host `smoke:required` gate exactly once.
- The forward-only release created tag `v0.3.5` at `6aca2235b46b5f9af8768dca2c1e0e2ebaa6979c` and pushed it with `master`.
- GitHub run `33755101113` passed Windows and Ubuntu on Node 22 and 24, then completed the npm publish job successfully.

## Public evidence

| Gate | Result |
|---|---|
| Local release gates | PASS, 531/531 tests; pack audit 19/19 |
| Release workflow | PASS, all four matrix jobs and publish job |
| npm exact version | PASS, `0.3.5` |
| npm `latest` | PASS, `0.3.5` |
| Exact/latest integrity | PASS, equal and present |
| Public tarball | PASS, 115 files and all five expected `kcoderag-update` source/generated projections |
| Exact public `npx` lifecycle | PASS for Codex, Claude Code, Cursor, OpenCode, and ZCode |
| Latest public `npx` lifecycle | PASS for Codex; installed version `0.3.5` |

Each five-host exact lifecycle ran `install`, `status`, `update`, and `uninstall` in a disposable Windows project with an isolated user profile. It confirmed the host-native update Skill existed with `name: kcoderag-update` and was removed by uninstall. Output was reduced to booleans, host names, and versions; no MCP values or configuration bodies were recorded.

Formal `required-contract` smoke was not rerun against the public spec because it intentionally requires an active local readiness lease. The real public `npx` lifecycles above validate acquisition and project mutation without weakening that boundary. This remains packaged/public CLI evidence, not deferred Phase 05 true-host LIVE evidence.

## CI duration note

The duplicate smoke timeout is fixed, but the successful Windows release jobs still took 19.63 minutes on Node 24 and 20.00 minutes on Node 22; Ubuntu took 2.68 and 2.77 minutes. A later optimization can move the five-host packaged smoke to one independent Windows lane while keeping Node 22/24 platform coverage in the partitioned test matrix.

## Release identities

- Failed unpublished record: `v0.3.4` / `f41e7f5`
- Workflow fix: `bf0945c`
- Published release: `v0.3.5` / `6aca223`
- Successful release run: `https://github.com/Tooc0ld/kcoderag-nav/actions/runs/33755101113`
