---
quick_id: 260903-nx3
phase: quick-260903-nx3
plan: "01"
subsystem: public-skills
tags: [skills, update, five-host, release-readiness]
provides:
  - dedicated update-only public Skill
  - five-host lifecycle projection for the fifth public Skill
  - verified forward 0.3.4 release path without publication
affects: [capabilities, generator, host-adapters, package, documentation]
actuals:
  tasks: 3
  commits: 1
tech-stack:
  added: []
  patterns: [explicit-mutation-authority, diagnostic-first-routing, deterministic-projection]
key-files:
  created: [plugin-src/skills/kcoderag-update/SKILL.md, plugin-src/skills/kcoderag-update/agents/openai.yaml]
  modified: [plugin-src/skills/kcoderag-manage/SKILL.md, src/capabilities/navigation.cts, src/generator/index.cts, src/hosts, package.json]
key-decisions:
  - "Keep the internal capability registry at two capabilities while exposing five public Skills."
  - "Give $kcoderag-update only explicit single-host update authority; keep $kcoderag-manage diagnostic-first."
  - "Leave 0.3.3 immutable and use release dry-run to verify 0.3.4 before separate publication authorization."
completed: 2026-09-03
status: complete
---

# Quick 260903-nx3: public KCodeRag update Skill summary

The product now exposes exactly five public Skills, with `$kcoderag-update` providing a dedicated and bounded update workflow across all five supported hosts.

## Accomplishments

- Added the canonical update Skill and Codex discovery metadata with a concise XML workflow: read-only preflight, explicit single-host `npx kcoderag-nav@latest update`, and read-only postflight.
- Kept update authority narrow: no install, uninstall, manual replacement, cleanup, refusal bypass, host-global mutation, or secret-bearing diagnostics.
- Changed `$kcoderag-manage` to route explicit update intent to `$kcoderag-update` instead of duplicating mutation instructions.
- Projected the Skill deterministically into QA and Cursor products and every host-native project Skill root for Codex, Claude Code, Cursor, OpenCode, and ZCode.
- Added the identity to source-conflict gates, package inventory, pack audit, generator contracts, host tests, and public-Skill authority tests.
- Updated current public documentation to describe five public Skills while preserving the two internal capability IDs.

## Verification evidence

| Gate | Result |
|---|---|
| Full local CI | PASS, 531/531 tests |
| Deterministic generation | PASS, zero changed or written paths |
| Package audit | PASS, 19/19 tests and 115 members |
| Documentation audit | PASS, 6 checked files |
| Required acquired-package smoke | PASS, all five hosts from one tgz SHA |
| Release dry-run | PASS, `0.3.3` to `0.3.4`, tag `v0.3.4`, `commit:null` |

Implementation commit: `147e99c`.

## Release boundary

No version commit, tag, npm publish, or dist-tag change was performed. The local package remains `0.3.3`; `0.3.4` is the verified next release and still requires an explicit publication decision.
