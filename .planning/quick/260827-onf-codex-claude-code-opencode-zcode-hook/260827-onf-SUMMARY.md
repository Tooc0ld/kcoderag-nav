---
quick_id: 260827-onf
status: complete
completed: 2026-08-27
implementation_commit: b462fb6
sibling_guide_commit: c96726b7
verification: passed
---

# Unified packaged host runtime acceptance summary

## Outcome

The required smoke framework now installs the real tgz and emits one comparable, secret-safe
`runtimeContract` for Codex, Claude Code, Cursor, OpenCode, and ZCode. Each row executes the
installed registration path and proves installed assets, event handling, successful-call marker,
cached update notice, detached refresh scheduling through an injected fake spawn, and malformed
input fail-open behavior.

The receipt explicitly reports `layer: packaged`. It cannot be used as evidence that a native host
loaded or trusted the registration. Runtime fingerprints bind the host ID and install-state bytes,
and the exact/latest regression requires all five host fingerprints to be distinct.

## Changes

- Added packaged runtime evidence to the required PASS matrix and exact/latest provenance tests.
- Executed installed Codex/Claude command Hooks, Cursor events, OpenCode project plugin, and ZCode
  process Hooks without contacting npm Registry or running an update installation.
- Verified hashed bounded success markers, exact host update commands, strict advisory output, and
  silent fail-open behavior from the installed assets.
- Documented that automatic update means automatic version awareness only, never unattended
  install/update.
- Added documentation gates for ZCode workspace Hook trust and the packaged/native evidence
  boundary, then regenerated the public QA and Cursor READMEs.
- Updated the sibling authoritative `MCP_QA_EXPERIENCE_GUIDE.md` in commit `c96726b7`.

## Verification

- `npm run ci:local` — PASS before the final fingerprint hardening: 338/338 tests, generation check,
  74-entry pack audit, and five-host required smoke.
- After the final fingerprint hardening: `npm run build` — PASS; `npm run test:smoke` — 11/11 PASS;
  `npm run test:docs` — 10/10 PASS; `npm run docs:check` — 6 canonical files PASS;
  `npm run generate:check` — PASS; `npm run pack:audit` — 74 entries PASS; and
  `npm run smoke:required` — Codex, Claude Code, Cursor, OpenCode, and ZCode all PASS.
- `git diff --check` — PASS for both repositories before commit.

## ZCode native evidence boundary

The supplied ZCode desktop run proved that the project MCP and Skill were visible and that
`search_code` succeeded, but no dynamic Hook context or successful-call marker appeared. This is
not upgraded to a native PASS. The result is tracked as pending workspace Hook trust/admission:
the installer cannot pre-authorize user trust, and `status`/`doctor` cannot prove host admission.
After the user approves the workspace Hook and restarts the session, Phase 06 must repeat the
native PreToolUse/PostToolUse acceptance separately.
