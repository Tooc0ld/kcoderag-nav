---
quick_id: 260830-x2k
status: complete
completed: 2026-08-31
implementation_commit: 7db76e8
verification: passed
---

# Phase 04.2 readiness CI latency optimization summary

## Outcome

Readiness keeps the same exact candidate, five-host packaged lifecycle, four real OS/Node lanes, drift failures, and secret-safe artifact errors while removing two major sources of repeated work. The local serialized suite now completes in roughly half the previous Phase 04.2 time.

## Changes

- Reuse one SHA-named invocation tgz and one npm execution cache across the isolated host runtimes in a smoke run; host homes, host configuration, targets, and state remain separate.
- Revalidate both the canonical artifact and shared invocation file before and after every npm command.
- Normalize a mutated shared invocation artifact to `artifact_integrity_failed` for all five hosts without starting four additional npm executions.
- Validate GitHub Actions artifact-service URL/token/fetch availability before package creation, pack audit, tar scan, or smoke.
- Inject only the expensive smoke/upload boundaries in the workflow's secret-safe failure serialization test; production defaults still use real pack, scan, five-host smoke, and upload implementations.

## Measured latency

| Command/case | Before | After | Change |
|---|---:|---:|---:|
| `test:readiness-workflow` | 121059 ms | 2765 ms | -97.7% |
| `test:smoke` | 114325 ms | 57244 ms | -49.9% |
| Five-host successful packaged lifecycle | 59689 ms | 51269 ms | -14.1% |
| Five-host invocation-drift failure | 50595 ms | 2037 ms | -96.0% |
| Full serialized `npm test` | about 305–315 s in final Phase 04.2 runs | 152353 ms | about half |

Hosted Windows lanes were not rerun in this quick task. The successful-lifecycle cache reuse is expected to reduce their `Verify packaged contracts` step, but the size of that hosted improvement remains unclaimed until a new authorized readiness run records it.

## Verification

- `npm run build` — PASS.
- `npm test` — PASS, 429/429 in 152352.7366 ms; build plus tests 155486 ms.
- `npm run test:readiness-workflow` — PASS, 11/11 in 2458.8701 ms (2765 ms command wall time).
- `npm run test:smoke` — PASS, 12/12 in 57035.5725 ms (57244 ms command wall time).
- `npm run test:github-artifact-upload` — PASS, 13/13.
- `npm run test:ci-contract` — PASS, 6/6.
- `npm run generate:check` — PASS with zero changed or written paths.
- `npm run deps:audit` — PASS for the frozen three-package development graph.
- `git diff --check` — PASS.

## Scope note

No readiness workflow trigger, permission, action pin, lane, receipt schema, publish/tag behavior, or release evidence was changed. The remaining successful Windows lifecycle cost is dominated by many real synchronous `npm exec` CLI invocations; replacing them with direct Node calls or parallel host workers would require a separate design because it could weaken the public npx lifecycle evidence.
