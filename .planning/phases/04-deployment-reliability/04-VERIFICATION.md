---
phase: 04-deployment-reliability
verified: 2026-08-25T19:17:22Z
status: passed
score: "7/7 must-haves verified"
behavior_unverified: 0
requirements: [DEP-01, DEP-02, DEP-03]
verified_version: 0.2.2
fix_forward_from: 0.2.0
scope_deferrals:
  - "Live QA MCP protocol deployment alignment remains later KCodeRag service/Phase 06 work by explicit user decision."
---

# Phase 04 Verification: 已部署项目与安装来源可靠性

## Verdict

Phase 04 passed. The original 0.2.0 deployment subject remains immutable; real-host defects were repaired forward through 0.2.1 and 0.2.2, and the accepted deployed subject is exact public `kcoderag-nav@0.2.2`.

## Goal Verification

| Must-have | Result | Evidence |
|-----------|--------|----------|
| Public product is QA-only and legacy Dev is decode/migration input only | PASS | Closed generator/package inventories, retired Dev tree, QA/Cursor product tests, docs gate |
| Codex/Claude Hooks resolve the nearest managed project from root/deep/moved boundaries and fail open | PASS | Launcher/root-discovery tests plus real Head root, Unicode-deep, and space-deep launcher runs |
| Status/doctor are selected-host, read-only, source-aware, and secret-safe | PASS | Three-host Head status/doctor healthy; inventory, cleanup-fingerprint, rollback, and sentinel tests |
| Release, review, security, pack, CI, and npm evidence are closed | PASS | CLEAN/SECURED/pre-release artifacts, 286/286 tests, green CI runs, successful Release run |
| Real Head runs current public QA without active duplicates | PASS | Codex, Claude Code, and Cursor Head status/doctor all report `healthy`, `ok: true`, zero error findings |
| Root/deep launcher output is stable under Windows concurrency | PASS | Real launcher output fingerprint parity and eight-way concurrency regression test |
| Published defects preserve old versions and repair only by forward release | PASS | v0.2.0 and v0.2.1 remain immutable; v0.2.2 exact/latest/tag/master/npm gitHead converge |

## Requirement Traceability

| Requirement | Status | Evidence |
|-------------|--------|----------|
| DEP-01 | PASS | QA-only public lifecycle, immutable 0.2.0→0.2.2 fix-forward, public identity convergence, real Head three-host health |
| DEP-02 | PASS | Rootless Codex/Claude commands, bounded nearest-state discovery, Unicode/space deep execution, dangerous-target and move/copy tests |
| DEP-03 | PASS | Selected-host diagnostics, stable findings, explicit fingerprint authority, clean rescan, rollback, secret-sentinel and unrelated-scope tests |

## Fresh Automated Evidence

- `npm test`: 286 passed, 0 failed, 0 skipped.
- Public identity: npm exact `0.2.2`, npm latest `0.2.2`, npm `gitHead`, local `HEAD`, `origin/master`, and `v0.2.2` all converge on `e9b6566ac2149485f9b31c5cf948ccc959b39d60`.
- Real Head: Codex, Claude Code, and Cursor `status`/`doctor` are healthy and contain no error finding.
- Real launchers: Codex and Claude Code return exit 0, valid advisory JSON, and one identical protocol fingerprint per host from root, Unicode-deep, and space-deep cwd.
- GitHub evidence: CI runs `32879666733` and `32879669905` succeeded; Release run `32879669865` succeeded.

## Review and Security Gates

- The immutable pre-release implementation subject has `CLEAN`, `SECURED`, and `PASS` artifacts with no open high/critical item.
- The 0.2.1/0.2.2 forward diff was reviewed at closeout: bounded current-inventory parsing, secret-safe structured parsing, exclusive launcher temp-directory allocation, and matching regression coverage. No new blocking finding was identified.
- Cursor remains Rule/skill/MCP-only; no Hook equivalence is claimed.

## Explicit Deferred Item

The live QA service currently negotiates the older `2025-03-26` MCP protocol when the client requests `2025-11-25`, and tool calls return content without the newer `structuredContent`/`isError` shape. This is an external KCodeRag service deployment drift, not a failure of the published project installer or Hook runtime. The user explicitly chose to close Phase 04 and fix this later; Phase 06 will require authenticated protocol-shape evidence after that deployment is aligned.

## Human Verification

None pending for Phase 04. The user accepted the real three-host Head result and explicitly deferred the external live QA protocol deployment issue.

## Final Assessment

All Phase 04 requirements are achieved by the current public and deployed 0.2.2 subject. The phase can advance to Phase 05 without reopening the deferred service deployment issue.
