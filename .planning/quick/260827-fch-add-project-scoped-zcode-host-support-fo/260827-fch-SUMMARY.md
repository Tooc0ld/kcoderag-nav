---
quick_id: 260827-fch
status: complete
completed: 2026-08-27
implementation_commit: 903506f
sibling_guide_commit: 6891fd14
---

# ZCode host support summary

## Outcome

Added `--host zcode` as the fifth project-scoped host. The adapter installs the native workspace
MCP entry in `.zcode/config.json`, the navigation Skill in `.zcode/skills/`, and digest-backed
state under `.zcode/kcoderag-nav/`. Install, status, doctor, update, and uninstall use the shared
single-host transaction and source-conflict boundaries.

ZCode does not receive a project Hook, successful-call marker, automatic update notice, or JX3
pre-write projection. The current official ZCode contract ignores project-level Hook configuration;
JX3 therefore returns `host_version_unsupported` before writes. Manual npm update remains available.

## Changes

- Extended the host union, registry, CLI selection, target exclusions, state decoder, lock decoder,
  package inventory, and five-host synthetic smoke lane.
- Added the project-only ZCode adapter with native `mcp.servers` composition, unrelated JSON
  preservation, Skill lifecycle, full restoration, drift handling, and user-source diagnostics.
- Added focused ZCode, cross-host, CLI, capability, source-conflict, smoke, docs, pack, and CI
  coverage; generated the canonical QA README.
- Updated the main README, project context, CI labels, and the sibling authoritative
  `MCP_QA_EXPERIENCE_GUIDE.md` with the honest ZCode Hook/update boundary.

## Checks run

- `npm run build` — PASS
- Focused adapter/CLI/capability/source/smoke tests — 47/47 PASS
- `npm run generate:check` — PASS
- `npm run docs:check` — PASS (`checkedFiles: 6`)
- `npm run pack:audit` — PASS (`entries: 73`)
- `npm run smoke:required` — PASS for five synthetic contract lanes
- `npm run test:docs` — 10/10 PASS
- `npm run test:pack` — 14/14 PASS
- `npm run test:ci-contract` — 6/6 PASS

## Deferred evidence

The local desktop installation was detected read-only as ZCode 3.9.2 at
`C:/Users/kingsoft/AppData/Local/Programs/ZCode/ZCode.exe`, but no `zcode` command is on this
shell's `PATH`. Per user direction, the desktop app was not launched and no real-host lifecycle,
MCP, Skill, Hook, or version receipt was claimed. That evidence remains Phase 06 work.
