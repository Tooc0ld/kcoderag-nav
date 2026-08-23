---
schema_version: 1
open_count: 0
waived_count: 0
fixed_count: 1
total_count: 1
last_updated: 2026-08-23T14:05:31.900Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 03.1 | deviation | src/core/transaction.cts |  | Hardened partial temporary and recovery cleanup so rollback evidence is not lost. | fixed |  | 2026-08-23T14:05:16.172Z | 2026-08-23T14:05:31.900Z |

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
  }
]
````
