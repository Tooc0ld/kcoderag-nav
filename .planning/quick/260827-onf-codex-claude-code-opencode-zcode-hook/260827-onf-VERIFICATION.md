---
quick_id: 260827-onf
status: passed
verified: 2026-08-27
implementation_commit: b462fb6
---

# Verification: unified packaged host runtime acceptance

## Must-haves

| Requirement | Result | Evidence |
| --- | --- | --- |
| Required smoke installs and inspects the real tgz assets | PASS | Both local-source required smoke and exact/latest acquired-artifact tests returned PASS for all five hosts. |
| Installed handlers prove event, marker, notice, refresh, and fail-open behavior | PASS | Every `runtimeContract` has all six booleans true; Codex/Claude/ZCode use advisory Hooks, Cursor uses native event files, and OpenCode uses its project plugin. |
| Refresh verification has no Registry or auto-install side effect | PASS | The harness injects a fake detached spawn, requires `stdio: ignore` plus `unref`, and never executes the worker or install/update. |
| Receipts remain secret-safe and host-bound | PASS | Exact-key tests reject content fields, serialized receipts pass the secret/path negative corpus, fingerprints include host plus install-state bytes, and all five are unique. |
| Packaged evidence is not confused with native host admission | PASS | The closed contract requires `layer: packaged`; docs gates require the ZCode trust boundary and a separate native admission claim. |

## Commands

- `npm run ci:local` — PASS, including 338/338 tests and five-host required smoke.
- `npm run test:smoke` after the final code/test change — PASS, 11/11.
- `npm run build` after the final code/test change — PASS.
- `npm run test:docs` — PASS, 10/10.
- `npm run docs:check` — PASS, six canonical documents.
- `npm run generate:check` — PASS.
- `npm run pack:audit` — PASS, 74 entries.
- `npm run smoke:required` after fingerprint binding — PASS for all five hosts.

## Deferred native check

ZCode native workspace Hook admission is deliberately not a must-have of the packaged contract.
The current real-host result remains pending because MCP/Skill worked while no dynamic Hook or
marker was observed. That Phase 06 UAT must be rerun after explicit workspace Hook approval.
