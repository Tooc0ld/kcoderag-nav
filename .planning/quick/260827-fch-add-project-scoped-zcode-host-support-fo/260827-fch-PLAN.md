---
quick_id: 260827-fch
slug: add-project-scoped-zcode-host-support-fo
status: in_progress
description: Add project-scoped ZCode host support for navigation MCP and Skill, with honest unsupported Hook/JX3 boundaries and five-host lifecycle coverage
---

# ZCode host support

## Objective

Add `--host zcode` as a fifth, project-scoped host. Install navigation through ZCode's native
`.zcode/config.json` `mcp.servers` entry and workspace Skill directory while preserving unrelated
configuration and all transaction/source-conflict guarantees. Do not claim or install project Hooks:
ZCode's current official contract ignores project-level Hook configuration. Keep JX3 unsupported
until a version-bound native PreToolUse receipt exists.

## Task 1: Add the native ZCode adapter and host contract

**Files:** `src/core/contracts.cts`, `src/hosts/zcode.cts`, `src/hosts/index.cts`, CLI/runtime host-aware modules

**Action:** Extend the closed host union and registry, implement project detection/render/status/source
scanning for `.zcode/config.json`, `.zcode/skills/kcoderag-nav/SKILL.md`, and
`.zcode/kcoderag-nav/install-state.json`, and preserve the explicit `host_version_unsupported`
zero-write behavior for JX3. Do not deploy Hook, marker, or update-notice runtimes for ZCode.

**Verify:** TypeScript build and focused adapter/CLI tests compile with the fifth host.

**Done:** `install/status/doctor/update/uninstall --host zcode` use one atomic project-only adapter.

## Task 2: Extend lifecycle, smoke, and distribution gates

**Files:** `tests/hosts/zcode.test.cts`, cross-host/CLI/smoke tests, smoke harness, package and maintainer inventories

**Action:** Prove unrelated JSON preservation, conflict refusal, JX3 zero-write refusal, navigation
install/update/uninstall, five-host coexistence, packed archive inclusion, and required synthetic smoke.
Keep real ZCode executable evidence explicitly NOT_RUN. A read-only local probe found the ZCode 3.9.2
desktop app, but it exposes no `zcode` command on this shell's `PATH`, and the user explicitly deferred
real-host verification.

**Verify:** Focused tests, generation check, pack audit, and required host smoke pass.

**Done:** The public archive contains the compiled ZCode adapter and the synthetic contract lane covers it.

## Task 3: Document the honest ZCode boundary

**Files:** `README.md`, generated README template, current project documentation, sibling authoritative guide

**Action:** Document native MCP/Skill paths, the lack of executable project Hooks in current ZCode,
manual explicit npm updates, unsupported JX3, and deferred real-host receipt. Synchronize the sibling
`MCP_QA_EXPERIENCE_GUIDE.md` without touching unrelated sibling changes.

**Verify:** Docs check and sibling guide audit pass.

**Done:** Documentation consistently describes five hosts without presenting ZCode Hook or live-host evidence.
