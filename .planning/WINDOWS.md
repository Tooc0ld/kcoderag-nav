---
schema_version: 1
open_count: 0
waived_count: 0
fixed_count: 9
total_count: 9
last_updated: 2026-08-23T19:34:39.951Z
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
  }
]
````
