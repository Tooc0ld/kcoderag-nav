---
status: resolved
trigger: "[sanitized] ZCode does not mount the project MCP when the generated endpoint retains a terminal slash."
created: 2026-08-27T04:45:00Z
updated: 2026-08-27T07:05:10Z
---

# ZCode MCP trailing slash

## Symptoms

- expected: ZCode 3.9.2 loads the project-scoped `kcoderag-qa` MCP and exposes `search_code`.
- actual: The workspace Skill is present, but the current ZCode session has no KCodeRag MCP tools.
- errors: A direct safe probe reports that the generated trailing-slash endpoint is not accepted while the slash-free endpoint responds.
- timeline: Found during Phase 04.1 real-machine re-acceptance after adding ZCode.
- reproduction: Install navigation for ZCode into a clean project, open it as a workspace, and inspect the MCP tool list.

## Current Focus

hypothesis: Confirmed — the ZCode adapter copied the shared MCP endpoint unchanged although ZCode requires a slash-free terminal MCP path.
test: Reload the fixed acceptance workspace in real ZCode 3.9.2 and verify project MCP/Skill discovery with a read-only tool call.
expecting: The project MCP mounts, the expected tools including `search_code` become available, and the workspace Skill is registered.
next_action: None — real-machine acceptance passed.
reasoning_checkpoint: RED reproduced the terminal slash, GREEN proved the isolated projection fix, and the real workspace now mounts the MCP and Skill.
tdd_checkpoint: RED, GREEN, full regression, and native acceptance complete.

## Evidence

- timestamp: 2026-08-27T04:45:00Z
  observation: Real-machine UAT found the Skill but no mounted MCP tools; a manual protocol probe isolated endpoint canonicalization.
  implication: Product lifecycle smoke is insufficient to prove ZCode desktop mounting.
- timestamp: 2026-08-27T06:48:43Z
  observation: The new ZCode host assertion failed before the fix because the rendered endpoint ended in a slash.
  implication: The adapter projection reproduced the real-machine defect without inspecting or logging credentials.
- timestamp: 2026-08-27T06:48:43Z
  observation: Build, ZCode host tests, cross-host tests, and pack audit passed after the adapter fix.
  implication: Endpoint normalization is isolated to the ZCode projection and preserves the closed package contract.
- timestamp: 2026-08-27T06:48:43Z
  observation: The acceptance project was updated from the fixed package; structural checks confirm no terminal slash, retained authorization metadata, and healthy status/doctor results.
  implication: The workspace is ready for a fresh ZCode desktop reload and MCP call.
- timestamp: 2026-08-27T06:57:15Z
  observation: Full `npm run ci:local` passed with 332/332 tests, deterministic generation, 73-entry pack audit, and all five required host smoke lanes PASS.
  implication: The committed fix has fresh repository-wide regression evidence.
- timestamp: 2026-08-27T07:05:10Z
  observation: After a full workspace reload, the user confirmed a successful read-only MCP call, all six expected tools including `search_code`, and the project Skill in the active ZCode session.
  implication: The host-specific endpoint fix resolves the original real-machine mounting failure.

## Eliminated

- hypothesis: The service or search tool is unavailable.
  reason: The user's direct protocol probe listed tools and completed a read-only search.

## Resolution

root_cause: The ZCode adapter copied the shared endpoint byte-for-byte, while ZCode 3.9.2 treats the terminal-slash MCP path as a distinct unsupported endpoint and does not follow it.
fix: Canonicalize only a terminal `/mcp/` path to `/mcp` in the ZCode host projection, preserving all other endpoint components and leaving the shared source unchanged.
verification: Commit `f893ed9` passes full local CI; the fixed ZCode 3.9.2 workspace mounts the MCP, exposes the expected tool set including `search_code`, and registers the project Skill.
files_changed:
  - src/hosts/zcode.cts
  - tests/hosts/zcode.test.cts
