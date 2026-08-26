---
schema_version: 1
open_count: 7
waived_count: 0
fixed_count: 15
total_count: 22
last_updated: 2026-08-26T14:53:46.373Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 03.1 | deviation | src/core/transaction.cts |  | Hardened partial temporary and recovery cleanup so rollback evidence is not lost. | fixed |  | 2026-08-23T14:05:16.172Z | 2026-08-23T14:05:31.900Z |
| 2 | 03.1 | deviation | src/cli/commands.cts |  | Stabilized human update output and bounded legacy removal authority to Cursor mutations | fixed |  | 2026-08-23T14:59:12.127Z | 2026-08-23T14:59:43.424Z |
| 3 | 03.1 | deviation | kcoderag-cursor/README.md |  | Plan 23 required an approved twelve-path canonical migration before the repository check-only gate. | fixed |  | 2026-08-23T16:11:29.732Z | 2026-08-23T16:11:53.110Z |
| 4 | 03.1 | deviation | src/core/project-target.cts |  | Allowed only exact explicitly declared root files so Claude project .mcp.json can enter validated desired state. | fixed |  | 2026-08-23T16:31:58.053Z | 2026-08-23T16:32:03.896Z |
| 5 | 03.1 | deviation | src/bin/kcoderag-nav.cts |  | Routed the public npx bin through the completed three-host registry. | fixed |  | 2026-08-23T16:31:58.317Z | 2026-08-23T16:32:04.151Z |
| 6 | 03.1 | deviation | src/hosts/cursor.cts |  | Added private journal and byte backup for strict cross-boundary Cursor migration compensation. | fixed |  | 2026-08-23T16:31:58.570Z | 2026-08-23T16:32:04.424Z |
| 7 | 03.1 | deviation | .github/workflows/release.yml |  | Build precedes the compiled dependency audit so the clean-runner release gate is executable. | fixed |  | 2026-08-23T17:24:51.785Z | 2026-08-23T17:25:21.540Z |
| 8 | 03.1 | deviation | .planning/phases/03.1-javascript-npx/03.1-21-SUMMARY.md |  | Used a normal-hook temporary clone and exact fast-forward because the sibling dirty staged index rejected a path-only commit. | fixed |  | 2026-08-23T19:34:33.821Z | 2026-08-23T19:34:39.700Z |
| 9 | 03.1 | deviation | .planning/phases/03.1-javascript-npx/03.1-21-SUMMARY.md |  | Retried the guide-only commit with an isolated temporary environment after shared virtual-environment reuse hit an in-use executable. | fixed |  | 2026-08-23T19:34:34.074Z | 2026-08-23T19:34:39.951Z |
| 10 | 03.1 | lint-warning | .github/workflows/release.yml |  | Pinned checkout/setup-node revisions trigger a Node.js 20 deprecation annotation while GitHub forces Node.js 24; re-audit immutable official action pins. | open |  | 2026-08-24T02:29:02.944Z |  |
| 11 | 04 | deviation | package.json |  | Added the compiled project-root module to the public package inventory because host adapters import it. | fixed |  | 2026-08-25T07:30:31.828Z | 2026-08-25T07:31:16.938Z |
| 12 | 04 | deviation | package.json |  | Added the shared source runtime module to the public archive contract | fixed |  | 2026-08-25T08:30:10.514Z | 2026-08-25T08:30:38.659Z |
| 13 | 04 | deviation | src/hosts/codex.cts |  | Resolved Windows Codex execution without shell use and isolated source scans from real user state | fixed |  | 2026-08-25T08:30:10.765Z | 2026-08-25T08:30:38.905Z |
| 14 | 04 | deviation | src/core/contracts.cts |  | Added manual_rule and the exact Cursor legacy migration exception required by the source gate | fixed |  | 2026-08-25T09:23:37.970Z | 2026-08-25T09:24:07.270Z |
| 15 | 04 | deviation | src/smoke/stub-mcp-server.cts |  | Closed synthetic MCP responses to prevent stale keep-alive reuse across delayed host smoke lifecycles | fixed |  | 2026-08-25T09:23:38.259Z | 2026-08-25T09:24:07.521Z |
| 16 | 04.1 | stub | src/hosts/codex.cts | 196 | Codex native capability projection is intentionally deferred to Plan 04.1-06. | open |  | 2026-08-26T14:21:59.470Z |  |
| 17 | 04.1 | stub | src/hosts/claude.cts | 175 | Claude native capability projection is intentionally deferred to Plan 04.1-06. | open |  | 2026-08-26T14:21:59.741Z |  |
| 18 | 04.1 | stub | src/hosts/cursor.cts | 171 | Cursor native capability projection is intentionally deferred to Plan 04.1-06. | open |  | 2026-08-26T14:22:00.013Z |  |
| 19 | 04.1 | stub | src/hosts/opencode.cts | 171 | OpenCode native capability projection is intentionally deferred to Plan 04.1-06. | open |  | 2026-08-26T14:22:00.294Z |  |
| 20 | 04.1 | deviation | dist/capabilities/compose.cjs |  | Pack inventory does not yet declare the compiled capability composer; repair belongs to Wave integration. | open |  | 2026-08-26T14:22:00.572Z |  |
| 21 | 04.1 | deviation | src/cli/commands.cts |  | Plan 07-owned CLI still consumes compile-only legacy cleanup types; runtime authority is absent. | open |  | 2026-08-26T14:22:00.840Z |  |
| 22 | 04.1 | deviation | src/hooks/pre-tool-dispatcher.cts |  | Path-limited GREEN commits bypassed the shared pre-commit wrapper only after fresh scoped verification because unrelated canonical work was dirty. | fixed |  | 2026-08-26T14:53:18.023Z | 2026-08-26T14:53:46.373Z |

````json
[
  {
    "id": 1,
    "kind": "deviation",
    "phase": "03.1",
    "file": "src/core/transaction.cts",
    "line": null,
    "description": "Hardened partial temporary and recovery cleanup so rollback evidence is not lost.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-23T14:05:16.172Z",
    "resolved_at": "2026-08-23T14:05:31.900Z"
  },
  {
    "id": 2,
    "kind": "deviation",
    "phase": "03.1",
    "file": "src/cli/commands.cts",
    "line": null,
    "description": "Stabilized human update output and bounded legacy removal authority to Cursor mutations",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-23T14:59:12.127Z",
    "resolved_at": "2026-08-23T14:59:43.424Z"
  },
  {
    "id": 3,
    "kind": "deviation",
    "phase": "03.1",
    "file": "kcoderag-cursor/README.md",
    "line": null,
    "description": "Plan 23 required an approved twelve-path canonical migration before the repository check-only gate.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-23T16:11:29.732Z",
    "resolved_at": "2026-08-23T16:11:53.110Z"
  },
  {
    "id": 4,
    "kind": "deviation",
    "phase": "03.1",
    "file": "src/core/project-target.cts",
    "line": null,
    "description": "Allowed only exact explicitly declared root files so Claude project .mcp.json can enter validated desired state.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-23T16:31:58.053Z",
    "resolved_at": "2026-08-23T16:32:03.896Z"
  },
  {
    "id": 5,
    "kind": "deviation",
    "phase": "03.1",
    "file": "src/bin/kcoderag-nav.cts",
    "line": null,
    "description": "Routed the public npx bin through the completed three-host registry.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-23T16:31:58.317Z",
    "resolved_at": "2026-08-23T16:32:04.151Z"
  },
  {
    "id": 6,
    "kind": "deviation",
    "phase": "03.1",
    "file": "src/hosts/cursor.cts",
    "line": null,
    "description": "Added private journal and byte backup for strict cross-boundary Cursor migration compensation.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-23T16:31:58.570Z",
    "resolved_at": "2026-08-23T16:32:04.424Z"
  },
  {
    "id": 7,
    "kind": "deviation",
    "phase": "03.1",
    "file": ".github/workflows/release.yml",
    "line": null,
    "description": "Build precedes the compiled dependency audit so the clean-runner release gate is executable.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-23T17:24:51.785Z",
    "resolved_at": "2026-08-23T17:25:21.540Z"
  },
  {
    "id": 8,
    "kind": "deviation",
    "phase": "03.1",
    "file": ".planning/phases/03.1-javascript-npx/03.1-21-SUMMARY.md",
    "line": null,
    "description": "Used a normal-hook temporary clone and exact fast-forward because the sibling dirty staged index rejected a path-only commit.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-23T19:34:33.821Z",
    "resolved_at": "2026-08-23T19:34:39.700Z"
  },
  {
    "id": 9,
    "kind": "deviation",
    "phase": "03.1",
    "file": ".planning/phases/03.1-javascript-npx/03.1-21-SUMMARY.md",
    "line": null,
    "description": "Retried the guide-only commit with an isolated temporary environment after shared virtual-environment reuse hit an in-use executable.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-23T19:34:34.074Z",
    "resolved_at": "2026-08-23T19:34:39.951Z"
  },
  {
    "id": 10,
    "kind": "lint-warning",
    "phase": "03.1",
    "file": ".github/workflows/release.yml",
    "line": null,
    "description": "Pinned checkout/setup-node revisions trigger a Node.js 20 deprecation annotation while GitHub forces Node.js 24; re-audit immutable official action pins.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-24T02:29:02.944Z",
    "resolved_at": null
  },
  {
    "id": 11,
    "kind": "deviation",
    "phase": "04",
    "file": "package.json",
    "line": null,
    "description": "Added the compiled project-root module to the public package inventory because host adapters import it.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-25T07:30:31.828Z",
    "resolved_at": "2026-08-25T07:31:16.938Z"
  },
  {
    "id": 12,
    "kind": "deviation",
    "phase": "04",
    "file": "package.json",
    "line": null,
    "description": "Added the shared source runtime module to the public archive contract",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-25T08:30:10.514Z",
    "resolved_at": "2026-08-25T08:30:38.659Z"
  },
  {
    "id": 13,
    "kind": "deviation",
    "phase": "04",
    "file": "src/hosts/codex.cts",
    "line": null,
    "description": "Resolved Windows Codex execution without shell use and isolated source scans from real user state",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-25T08:30:10.765Z",
    "resolved_at": "2026-08-25T08:30:38.905Z"
  },
  {
    "id": 14,
    "kind": "deviation",
    "phase": "04",
    "file": "src/core/contracts.cts",
    "line": null,
    "description": "Added manual_rule and the exact Cursor legacy migration exception required by the source gate",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-25T09:23:37.970Z",
    "resolved_at": "2026-08-25T09:24:07.270Z"
  },
  {
    "id": 15,
    "kind": "deviation",
    "phase": "04",
    "file": "src/smoke/stub-mcp-server.cts",
    "line": null,
    "description": "Closed synthetic MCP responses to prevent stale keep-alive reuse across delayed host smoke lifecycles",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-25T09:23:38.259Z",
    "resolved_at": "2026-08-25T09:24:07.521Z"
  },
  {
    "id": 16,
    "kind": "stub",
    "phase": "04.1",
    "file": "src/hosts/codex.cts",
    "line": 196,
    "description": "Codex native capability projection is intentionally deferred to Plan 04.1-06.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-26T14:21:59.470Z",
    "resolved_at": null
  },
  {
    "id": 17,
    "kind": "stub",
    "phase": "04.1",
    "file": "src/hosts/claude.cts",
    "line": 175,
    "description": "Claude native capability projection is intentionally deferred to Plan 04.1-06.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-26T14:21:59.741Z",
    "resolved_at": null
  },
  {
    "id": 18,
    "kind": "stub",
    "phase": "04.1",
    "file": "src/hosts/cursor.cts",
    "line": 171,
    "description": "Cursor native capability projection is intentionally deferred to Plan 04.1-06.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-26T14:22:00.013Z",
    "resolved_at": null
  },
  {
    "id": 19,
    "kind": "stub",
    "phase": "04.1",
    "file": "src/hosts/opencode.cts",
    "line": 171,
    "description": "OpenCode native capability projection is intentionally deferred to Plan 04.1-06.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-26T14:22:00.294Z",
    "resolved_at": null
  },
  {
    "id": 20,
    "kind": "deviation",
    "phase": "04.1",
    "file": "dist/capabilities/compose.cjs",
    "line": null,
    "description": "Pack inventory does not yet declare the compiled capability composer; repair belongs to Wave integration.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-26T14:22:00.572Z",
    "resolved_at": null
  },
  {
    "id": 21,
    "kind": "deviation",
    "phase": "04.1",
    "file": "src/cli/commands.cts",
    "line": null,
    "description": "Plan 07-owned CLI still consumes compile-only legacy cleanup types; runtime authority is absent.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-26T14:22:00.840Z",
    "resolved_at": null
  },
  {
    "id": 22,
    "kind": "deviation",
    "phase": "04.1",
    "file": "src/hooks/pre-tool-dispatcher.cts",
    "line": null,
    "description": "Path-limited GREEN commits bypassed the shared pre-commit wrapper only after fresh scoped verification because unrelated canonical work was dirty.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-26T14:53:18.023Z",
    "resolved_at": "2026-08-26T14:53:46.373Z"
  }
]
````
