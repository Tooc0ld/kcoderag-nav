---
quick_id: 260830-t09
status: passed
verified: 2026-08-30
implementation_commit: d08f0d7
---

# Verification: generated Windows hooks cannot open interactive popup paths

## Must-haves

| Requirement | Result | Evidence |
| --- | --- | --- |
| Generated Windows hook registrations cannot invoke PowerShell or interactive/new-window cmd paths | PASS | Source-template, rendered-command, generated-product, and known-bad-example assertions pass. |
| Codex and Claude hooks terminate through `cmd /c` and hide/bound their child process | PASS | The test decodes the embedded bootstrap and requires `['/d','/c','call',x,H]`, `timeout:5000`, and `windowsHide:true`. |
| Hook registration remains bounded and non-asynchronous | PASS | PreToolUse and PostToolUse both require `type: command`, `timeout: 5`, and `async !== true`. |
| Canonical generated artifacts remain synchronized | PASS | `npm run generate:check` returned `changedPaths: []`. |
| Existing host behavior remains intact | PASS | Five host adapter suites passed 18/18 and the full suite passed 429/429. |

## Verdict

PASS. Within the KCodeRag Nav-generated hook surface, a regression to the reported nested PowerShell prompt bug or another enumerated interactive/new-window launcher now fails tests before packaging.
