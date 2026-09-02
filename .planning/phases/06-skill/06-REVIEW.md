---
phase: 06-skill
reviewed: 2026-09-02T19:25:21Z
depth: standard
files_reviewed: 87
files_reviewed_list:
  - AGENTS.md
  - README.md
  - docs/MCP_QA_EXPERIENCE_GUIDE.md
  - kcoderag-cursor/README.md
  - kcoderag-cursor/skills/kcoderag-code-style/references/change-hygiene-self-review.md
  - kcoderag-cursor/skills/kcoderag-code-style/references/cpp-lifetime-control-flow.md
  - kcoderag-cursor/skills/kcoderag-code-style/references/lua-contracts.md
  - kcoderag-cursor/skills/kcoderag-code-style/references/protocol-serialization-data.md
  - kcoderag-cursor/skills/kcoderag-code-style/SKILL.md
  - kcoderag-cursor/skills/kcoderag-feedback/SKILL.md
  - kcoderag-cursor/skills/kcoderag-manage/SKILL.md
  - kcoderag-cursor/skills/kcoderag/SKILL.md
  - kcoderag-qa/hooks/code-style-nudge.cjs
  - kcoderag-qa/hooks/pre-tool-dispatcher.cjs
  - kcoderag-qa/README.md
  - kcoderag-qa/skills/kcoderag-code-style/agents/openai.yaml
  - kcoderag-qa/skills/kcoderag-code-style/references/change-hygiene-self-review.md
  - kcoderag-qa/skills/kcoderag-code-style/references/cpp-lifetime-control-flow.md
  - kcoderag-qa/skills/kcoderag-code-style/references/lua-contracts.md
  - kcoderag-qa/skills/kcoderag-code-style/references/protocol-serialization-data.md
  - kcoderag-qa/skills/kcoderag-code-style/SKILL.md
  - kcoderag-qa/skills/kcoderag-feedback/agents/openai.yaml
  - kcoderag-qa/skills/kcoderag-feedback/SKILL.md
  - kcoderag-qa/skills/kcoderag-manage/agents/openai.yaml
  - kcoderag-qa/skills/kcoderag-manage/SKILL.md
  - kcoderag-qa/skills/kcoderag/agents/openai.yaml
  - kcoderag-qa/skills/kcoderag/SKILL.md
  - package.json
  - plugin-src/capabilities/code-style-nudge/skill/agents/openai.yaml
  - plugin-src/capabilities/code-style-nudge/skill/SKILL.md
  - plugin-src/cursor/README.md.tmpl
  - plugin-src/README.md.tmpl
  - plugin-src/skills/kcoderag-feedback/agents/openai.yaml
  - plugin-src/skills/kcoderag-feedback/SKILL.md
  - plugin-src/skills/kcoderag-manage/agents/openai.yaml
  - plugin-src/skills/kcoderag-manage/SKILL.md
  - plugin-src/skills/kcoderag/agents/openai.yaml
  - plugin-src/skills/kcoderag/SKILL.md
  - src/capabilities/code-style-nudge.cts
  - src/capabilities/contracts.cts
  - src/capabilities/navigation.cts
  - src/cli/commands.cts
  - src/core/contracts.cts
  - src/core/state.cts
  - src/generator/index.cts
  - src/hooks/code-style-nudge.cts
  - src/hooks/pre-tool-dispatcher.cts
  - src/hosts/claude.cts
  - src/hosts/codex.cts
  - src/hosts/cursor.cts
  - src/hosts/host-version-support.cts
  - src/hosts/opencode.cts
  - src/hosts/zcode.cts
  - src/maintainer/docs-check.cts
  - src/maintainer/native-host-driver.cts
  - src/maintainer/pack-audit.cts
  - src/maintainer/pre-commit.cts
  - src/maintainer/retirement-audit.cts
  - src/smoke/host-smoke.cts
  - tests/capabilities/providers.test.cts
  - tests/cli/commands.test.cts
  - tests/core/transaction.test.cts
  - tests/generator/cursor-product.test.cts
  - tests/generator/generation.test.cts
  - tests/generator/qa-product.test.cts
  - tests/generator/repository-generation.test.cts
  - tests/hooks/code-style-nudge.test.cts
  - tests/hooks/launcher.test.cts
  - tests/hooks/pre-tool-dispatcher.test.cts
  - tests/hooks/session-start.test.cts
  - tests/hosts/claude.test.cts
  - tests/hosts/codex.test.cts
  - tests/hosts/cross-host.test.cts
  - tests/hosts/cursor.test.cts
  - tests/hosts/honest-events.test.cts
  - tests/hosts/opencode.test.cts
  - tests/hosts/zcode.test.cts
  - tests/maintainer/docs-check.test.cts
  - tests/maintainer/native-host-driver.test.cts
  - tests/maintainer/pack-audit.test.cts
  - tests/maintainer/pre-commit.test.cts
  - tests/maintainer/release.test.cts
  - tests/maintainer/retirement-audit.test.cts
  - tests/skills/kcoderag-code-style.behavior.test.cts
  - tests/skills/kcoderag-code-style.test.cts
  - tests/skills/public-skills.test.cts
  - tests/smoke/host-smoke.test.cts
findings:
  critical: 2
  warning: 1
  info: 0
  total: 3
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-09-02T19:25:21Z
**Depth:** standard
**Files Reviewed:** 87
**Status:** issues_found

## Summary

The four-Skill projection is internally consistent across canonical and generated assets, but the
reverse-order lifecycle introduces two safety regressions. Three adapters can overwrite an
unmanaged host configuration after a style-only install, and every host's user-source scanner
misses at least some of the newly public Skill identities. Both behaviors violate the project's
write-before-refusal/source-gate contract. The shipped documentation also assigns deferred
real-host evidence to the phase that has just completed instead of Phase 05.

The ownership defect was reproduced against the compiled adapters in disposable temporary
projects: after installing only "code-style-nudge", adding a user-owned host configuration, and
then installing navigation, Cursor and ZCode replaced the user's MCP URL and Claude replaced the
user's matching hook without returning "unmanaged_name_conflict". The source-scan defect was also
reproduced for all five adapters; each tested current public Skill path returned
"hasConflict: false" and no findings.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Style-only state is incorrectly treated as ownership of unrelated host configuration

**Classification:** BLOCKER

**Files:**

- D:/AIProgram/kcoderag-nav/src/hosts/claude.cts:401
- D:/AIProgram/kcoderag-nav/src/hosts/cursor.cts:108-109
- D:/AIProgram/kcoderag-nav/src/hosts/zcode.cts:313

**Issue:** These adapters use "state !== undefined" as the ownership predicate for a native
settings/MCP/Hook file. Phase 06 makes a valid style-only state possible on every host, but that
state does not own Claude's ".claude/settings.json", Cursor's ".cursor/mcp.json" or
".cursor/hooks.json", or ZCode's ".zcode/config.json". A later navigation install therefore
bypasses "unmanaged_name_conflict" merely because the unrelated style state exists. The merge then
removes or replaces user-owned entries and the transaction commits that loss. This is an ownership
and data-loss violation, not just a missing diagnostic.

**Fix:** Determine ownership per exact file from the validated state, as the Codex and OpenCode
adapters already do. For example:

    const settingsOwned = previousFile(state, SETTINGS_PATH) !== undefined;
    const hooksOwned = previousFile(state, HOOKS_PATH) !== undefined;
    const mcpOwned = previousFile(state, MCP_PATH) !== undefined;
    const configOwned = previousFile(state, CONFIG_PATH) !== undefined;

Pass those booleans to the merge functions, and add reverse-order tests that install style only,
create a same-name unmanaged native config/hook, then require navigation installation to fail
before writing while preserving the exact original bytes.

### CR-02: The source gate does not scan the four current public Skill identities

**Classification:** BLOCKER

**Files:**

- D:/AIProgram/kcoderag-nav/src/hosts/codex.cts:300
- D:/AIProgram/kcoderag-nav/src/hosts/claude.cts:507
- D:/AIProgram/kcoderag-nav/src/hosts/cursor.cts:142
- D:/AIProgram/kcoderag-nav/src/hosts/opencode.cts:156
- D:/AIProgram/kcoderag-nav/src/hosts/zcode.cts:510

**Issue:** Codex, Claude, Cursor, and OpenCode still inspect only the retired
"kcoderag-nav/SKILL.md" path, while ZCode inspects only the new "kcoderag/SKILL.md" path. None of
the scanners covers all four public names ("kcoderag", "kcoderag-manage", "kcoderag-feedback", and
"kcoderag-code-style"), and ZCode no longer checks its retired path. As a result, a user-global
same-name Skill can coexist with the project install without a "source_conflict", leaving host
resolution ambiguous and defeating the mandatory mutation source gate.

**Fix:** For each host, inspect all four current user-level Skill paths and retain the retired
"kcoderag-nav"/"code-style-correction" paths as legacy conflict sources. Return only stable safe
paths. Add gate-mode tests for every current identity plus the retired identities, asserting that
install, update, and uninstall stop before adapter rendering and preserve the project tree.

## Warnings

### WR-01: Shipped documentation assigns deferred real-host evidence to completed Phase 06

**Classification:** WARNING

**Files:**

- D:/AIProgram/kcoderag-nav/README.md:52
- D:/AIProgram/kcoderag-nav/plugin-src/README.md.tmpl:53
- D:/AIProgram/kcoderag-nav/plugin-src/README.md.tmpl:181
- D:/AIProgram/kcoderag-nav/kcoderag-qa/README.md:53
- D:/AIProgram/kcoderag-nav/kcoderag-qa/README.md:185
- D:/AIProgram/kcoderag-nav/plugin-src/cursor/README.md.tmpl:106
- D:/AIProgram/kcoderag-nav/kcoderag-cursor/README.md:106

**Issue:** These current/shipped documents say that ZCode or authenticated real-host MCP evidence
"remains Phase 06 work." Phase 06 is the completed phase under review, and the governing project
contract explicitly assigns Hook precision and authenticated/true-host evidence to unfinished
Phase 05. The generated products therefore publish a stale and self-contradictory delivery
boundary.

**Fix:** Change the canonical templates and root README to Phase 05 (or to a neutral explicitly
deferred milestone statement), regenerate QA/Cursor products, and add a docs check that rejects
future-work claims targeting a completed phase.

---

_Reviewed: 2026-09-02T19:25:21Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_

