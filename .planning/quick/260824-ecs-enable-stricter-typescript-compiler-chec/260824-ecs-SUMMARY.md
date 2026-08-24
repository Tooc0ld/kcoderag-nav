---
quick_id: 260824-ecs
status: complete
completed: 2026-08-24
implementation_commit: "7dcbbfa"
---

# Quick Task 260824-ecs Summary

Enabled TypeScript's built-in quality checks for both production source and tests without adding dependencies or a redundant CI step.

## Delivered

- Enabled `noImplicitReturns` and `noFallthroughCasesInSwitch` in both TypeScript configurations.
- Enabled `noUnusedLocals` and `noUnusedParameters` in both TypeScript configurations.
- Reused the existing `npm run build` CI gate so the new checks apply to source and compiled tests.

## Verification

- `npm run build`: passed for `tsconfig.json` and `tsconfig.tests.json`.
- `git diff --check -- tsconfig.json tsconfig.tests.json`: passed.

Implementation commit: `7dcbbfa`.
