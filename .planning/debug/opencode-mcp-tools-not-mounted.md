---
status: verifying
trigger: "[sanitized] OpenCode 1.18.23 reads the project MCP configuration but does not expose the KCodeRag tools."
created: 2026-08-27T07:43:53Z
updated: 2026-08-27T08:15:00Z
---

# OpenCode MCP tools not mounted

## Symptoms

- expected: The project-scoped `kcoderag-qa` MCP mounts in OpenCode 1.18.23 and exposes `search_code`.
- actual: OpenCode can quote the project configuration and use local search, but reports that `search_code` is not available as a tool.
- errors: No native tool is exposed to the active OpenCode session.
- timeline: Found during Phase 04.1 real-machine re-acceptance after a clean project install.
- reproduction: Open the managed OpenCode acceptance project and ask the agent to call `search_code`.

## Current Focus

hypothesis: Confirmed — terminal-slash projection prevented transport discovery, and OpenCode's first-load `$schema` insertion caused the follow-up digest drift.
test: Run native OpenCode 1.18.23 against a third clean packaged install, then re-run package `status` and `doctor` after native `mcp list`.
expecting: Native OpenCode reports the registration connected without changing any managed digest.
next_action: Await the model-visible `search_code` UAT in the newly launched clean project.
reasoning_checkpoint: Native connection and post-launch integrity are now independently verified; only the in-session tool invocation remains.
tdd_checkpoint: Endpoint, distribution, schema ownership, native connection, and post-launch digest RED/GREEN complete.

## Evidence

- timestamp: 2026-08-27T07:43:53Z
  observation: The real OpenCode session reads the project config and Skill but exposes no KCodeRag tools.
  implication: Project lifecycle health and loopback smoke did not prove native desktop/TUI MCP mounting.
- timestamp: 2026-08-27T07:47:00Z
  observation: Secret-safe structural inspection confirms a remote, enabled entry with headers whose endpoint ends in a slash; native OpenCode lists the registration as failed.
  implication: The endpoint shape is the immediate connection defect, matching the earlier ZCode failure mode.
- timestamp: 2026-08-27T07:52:00Z
  observation: Shared normalization and all five host projection tests pass, but the first local tarball omitted the new compiled core module and exited before update.
  implication: The exact package allow-list and pack audit must declare every new runtime dependency; the acceptance project remains on the previous bytes.
- timestamp: 2026-08-27T08:03:00Z
  observation: The corrected tarball passes 14/14 pack tests and a 74-entry pack audit; a fresh acceptance project installs healthy with a slash-free endpoint and native OpenCode reports connected.
  implication: Packaging and native transport discovery are fixed; only the model-visible `search_code` call remains for UAT.
- timestamp: 2026-08-27T08:08:00Z
  observation: Secret-safe structural comparison shows native OpenCode adds exactly the root `$schema` field and changes no other config path.
  implication: Projecting the canonical schema before launch will prevent native first-load drift without relaxing digest or ownership checks.
- timestamp: 2026-08-27T08:15:00Z
  observation: A third clean packaged install projects the canonical schema, native OpenCode 1.18.23 reports connected, and post-native `status` plus `doctor` both remain healthy.
  implication: Transport discovery and exact managed-state integrity now coexist on the supported native baseline.
- timestamp: 2026-08-27T08:15:00Z
  observation: The full local gate passes 335 tests, deterministic generation, the 74-entry pack audit, and the five-host required smoke contract.
  implication: The shared endpoint fix and OpenCode schema ownership change introduce no detected cross-host regression.

## Eliminated

- hypothesis: The project files were not installed.
  reason: Install, status, and doctor completed successfully and OpenCode quoted the project registration.

## Resolution

root_cause: All host adapters consumed a shared terminal-slash MCP endpoint that native clients treat as a distinct path. After transport was fixed, OpenCode's first load added its canonical `$schema`, which correctly tripped exact digest protection. The first shared-code fix also omitted its new compiled module from the exact npm package allow-list.
fix: Normalize the terminal `/mcp/` path through one secret-opaque core helper used by all five host projections, include that compiled helper in the closed package inventories, and let OpenCode project and contributor-scope only the canonical `$schema` it adds.
verification: RED reproduced endpoint, package-inventory, and native schema-stability defects; 335 tests, generation, 74-entry pack audit, and required smoke pass; a third clean OpenCode 1.18.23 project remains healthy after native connection. Real `search_code` UAT is pending.
files_changed:
  - package.json
  - src/core/mcp-endpoint.cts
  - src/hosts/codex.cts
  - src/hosts/claude.cts
  - src/hosts/cursor.cts
  - src/hosts/opencode.cts
  - src/hosts/zcode.cts
  - src/maintainer/pack-audit.cts
  - tests/core/mcp-endpoint.test.cts
  - tests/hosts/codex.test.cts
  - tests/hosts/claude.test.cts
  - tests/hosts/cursor.test.cts
  - tests/hosts/opencode.test.cts
