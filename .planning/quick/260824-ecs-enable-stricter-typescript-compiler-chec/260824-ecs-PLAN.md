---
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - tsconfig.json
  - tsconfig.tests.json
autonomous: true
requirements:
  - TYPESCRIPT-QUALITY-01
estimate:
  tasks: 1
  confidence: high
---

<objective>
Enable TypeScript's unused-code, explicit-return, and switch-fallthrough checks for both production source and tests so the existing build and CI enforce them without adding dependencies.
</objective>

<context>
@AGENTS.md
@tsconfig.json
@tsconfig.tests.json
@package.json
</context>

<tasks>

<task type="auto">
  <name>Task 1: Enable and verify stricter compiler checks</name>
  <files>tsconfig.json, tsconfig.tests.json</files>
  <action>Add noImplicitReturns, noFallthroughCasesInSwitch, noUnusedLocals, and noUnusedParameters to both compilerOptions blocks. Preserve all existing settings and dependency policy.</action>
  <verify>npm run build &amp;&amp; git diff --check</verify>
  <done>Both source and test compilation enforce all four rules and the repository build passes.</done>
</task>

</tasks>
