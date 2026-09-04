---
quick_id: 260904-l6r
phase: quick-260904-l6r
plan: "01"
subsystem: documentation-and-skills
tags: [codex-skills, navigation, documentation, packaging]
provides:
  - self-explanatory $kcoderag help and navigation action forms
  - current five-Skill and version/update documentation
  - regression contracts for navigation usage and host update boundaries
affects: [skills, docs, generated-packages, codex]
actuals:
  tasks: 4
  commits: 1
tech-stack:
  added: []
  patterns: [single-skill-action-routing, canonical-generated-assets, focused-verification]
key-files:
  modified: [plugin-src/skills/kcoderag/SKILL.md, plugin-src/skills/kcoderag/agents/openai.yaml, README.md, docs/MCP_QA_EXPERIENCE_GUIDE.md, src/maintainer/docs-check.cts]
key-decisions:
  - "Keep $kcoderag as the only navigation Skill and express find/context/callers/callees/indexes/impact as intents instead of adding a redundant $kcoderag-find Skill."
  - "A bare or help invocation returns usage before any MCP call; users never need to construct raw MCP JSON."
  - "Document manual code-style support on all five hosts while retaining the Codex automaticNudge unsupported boundary."
completed: 2026-09-04
status: complete
---

# Quick 260904-l6r: KCodeRag Skill and usage guidance

The public navigation Skill now explains itself when selected without a target and accepts short action forms while preserving natural-language invocation and read-only graph boundaries. User-facing documentation now reflects release `0.3.5`, all five public Skills, version status fields, explicit single-host updates, and host-specific update-notice behavior.

## Changes

- Added `$kcoderag help`, `find`, `context`, `callers`, `callees`, `indexes`, and `impact` usage with explicit tool routing, missing-target behavior, and local source verification.
- Updated Codex UI metadata so the default prompt points users to `find` and `help`.
- Updated canonical and generated README files plus the repository-owned experience guide.
- Extended documentation and Skill tests so the usage contract, five public Skill identities, current version fields, and Cursor update boundary cannot silently regress.
- Incrementally installed `code-style-nudge` into `I:\JX3_SVN\Head`; its Codex status now reports both capabilities healthy and the expected manual-only code-style behavior.

## Verification evidence

| Gate | Result |
|---|---|
| Focused compiled tests | PASS, 43/43 |
| Documentation contract | PASS, 6 files |
| Local experience guide audit | PASS, 7 topics |
| Deterministic generation | PASS, zero changed/written paths |
| Package audit | PASS, version `0.3.5`, 115 entries |
| Whitespace validation | PASS, `git diff --check` |
| Head Codex installation | PASS, installed/latest `0.3.5`; navigation and code-style healthy |

The repository changes are committed but not published. The improved `$kcoderag` prompt/help will reach installed projects through a future forward release and update; the Head project currently uses the latest published `0.3.5` package.

Implementation commit: `1b647f3`.
