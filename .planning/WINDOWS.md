---
schema_version: 1
open_count: 0
waived_count: 0
fixed_count: 2
total_count: 2
last_updated: 2026-08-23T14:59:43.424Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 03.1 | deviation | src/core/transaction.cts |  | Hardened partial temporary and recovery cleanup so rollback evidence is not lost. | fixed |  | 2026-08-23T14:05:16.172Z | 2026-08-23T14:05:31.900Z |
| 2 | 03.1 | deviation | src/cli/commands.cts |  | Stabilized human update output and bounded legacy removal authority to Cursor mutations | fixed |  | 2026-08-23T14:59:12.127Z | 2026-08-23T14:59:43.424Z |

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
  }
]
````
