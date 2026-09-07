---
status: passed
quick_id: 260907-ey3
verified: 2026-09-07
---

# Verification

| Requirement | Evidence | Result |
|---|---|---|
| Preserve OS/Node coverage | Final CI 34079069796: Linux 22/24 complete lanes, Windows 22/24 two serial shards each; every required job succeeded | PASS |
| Exhaustive, disjoint shards | Native Node fixture proves union/no overlap and failing-test exit propagation; initial hosted Windows 22 counts 270+266=536 | PASS |
| Real packaged groups | Local two real packaged CLI groups and real merge exit 0, five hosts PASS | PASS |
| Separate hosted runners | Final acceptance groups started simultaneously at 03:17:26Z, both succeeded | PASS |
| Complete exact-package evidence | Downloaded merged artifact contains exactly five PACKAGED PASS receipts with one candidate SHA, one package SHA-256 and attempt 34079069882-1 | PASS |
| Fail closed | 29 focused tests include missing/duplicate/wrong-host/wrong-artifact/mixed-attempt/failure/secret rejection; worker crash, missing/duplicate messages and timeout rejection | PASS |
| Regression | Initial implementation full local suite 537/537; final changes build + 29 focused tests + package 19/19 + real grouped CLI proof; final complete hosted CI succeeded | PASS |
| Generation/package boundaries | No generated drift; shard helper excluded from npm; docs, retirement and exact acceptance topology passed | PASS |
| Observable speedup | Stable baseline CI 579s -> final 347s; acceptance 581s -> final 481s | PASS |

The 5–6 minute acceptance target was not achieved. Same-runner process parallelism was measured and retained for local smoke, while hosted acceptance uses separate runners. Release workflow syntax/contracts were tested; no new release tag or publication was created. Deferred native LIVE remains skipped and is not represented by PACKAGED receipts. Unrelated quick 260904-mh0 remains untouched.
