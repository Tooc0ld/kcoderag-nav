# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## readiness-block-stage-fail — Artifact CreateArtifact rejected before block staging
- **Date:** 2026-08-29
- **Error patterns:** package upload failure, artifact_upload_failed, create_artifact, 4xx, zero receipts, platform lanes skipped
- **Root cause(s):** Direct JSON serialization bypassed protobuf JSON mapping, sending camelCase control fields and object-shaped StringValue wrappers.
- **Fix:** Serialize CreateArtifact, FinalizeArtifact, and DeleteArtifact requests with protobuf original field names and scalar StringValue JSON representations.
- **Files changed:** src/maintainer/github-artifact-upload.cts, tests/maintainer/github-artifact-upload.test.cts
- **Why not caught:** The uploader unit test copied the implementation's request shape instead of independently enforcing the official generated client's wire contract; typecheck could not validate JsonMap key semantics.
- **Recurrence guard:** Regression test `block stage and block list commit preserve the exact private lease buffer` plus the cleanup request assertion in tests/maintainer/github-artifact-upload.test.cts.
---

## readiness-artifact-invalid — Hosted lanes rejected an authenticated raw package before identity checks
- **Date:** 2026-08-29
- **Error patterns:** downloaded_artifact_invalid, downloaded_artifact_name_invalid, four hosted lanes failed, zero receipts, service-derived basename, terminal mcp slash
- **Root cause(s):** The official downloader produced one exact raw artifact under a third service-derived sanitized basename while the consumer treated two presentation basenames as an ownership allowlist; the canonical MCP source retained a terminal pathname slash that deterministic generation faithfully propagated.
- **Fix:** Resolve the private download root by exact singleton ownership independent of presentation basename while retaining all direct-child, non-link, file-identity, SHA, tar, member, and lease checks; normalize the canonical MCP pathname, regenerate its products, and retain closed stage-only annotations plus the block-list Content-Disposition contract.
- **Files changed:** src/maintainer/github-artifact-upload.cts, tests/maintainer/github-artifact-upload.test.cts, src/maintainer/readiness-workflow.cts, tests/maintainer/readiness-workflow.test.cts, plugin-src/environments/qa.mcp.json, kcoderag-qa/.mcp.json, kcoderag-qa/.codex.mcp.json, kcoderag-cursor/.cursor-plugin/plugin.json, tests/generator/repository-generation.test.cts
- **Why not caught:** The readiness workflow test lacked a third presentation-basename neighbor and collapsed early resolver failures into one safe class; the generation gate checked canonical/product consistency without an independent slash-free endpoint assertion. Typecheck could not detect either semantic contract gap.
- **Recurrence guard:** Regression tests `downloaded lease authenticates exactly one direct raw file independent of presentation basename` in tests/maintainer/readiness-workflow.test.cts, `compiled repository gate proves all generated products canonical without repository writes` in tests/generator/repository-generation.test.cts, and `block stage and block list commit preserve the exact private lease buffer` in tests/maintainer/github-artifact-upload.test.cts.
---

## phase-04-2-final-regression — Nested review worktree broke pack and readiness snapshots
- **Date:** 2026-08-30
- **Error patterns:** files_policy_invalid, readiness_workflow_failed, repositorySnapshot, slash-terminated git ls-files entry, nested review worktree
- **Root cause(s):** AND-gate: the review-fix workflow left its registered worktree inside `.claude/worktrees/` after integration; Git exposed that nested repository as a slash-terminated directory entry, which the intentionally file-only `repositorySnapshot()` normalization rejected before pack/readiness logic could proceed.
- **Fix:** Removed the exact validated review-fix worktree and its obsolete recovery marker; preserved the review-fix branch and made no product-code change.
- **Files changed:** `.planning/phases/04.2-public-debranding/.review-fix-recovery-pending.json` (removed review-owned residue); no product files changed
- **Why not caught:** No post-review integration gate existed for repository-local worktree residue; the final pack/readiness regression gate caught the condition only after the clean code review completed.
- **Recurrence guard:** Existing test `audits a real temporary npm tgz and preserves repository status and tree` in `dist-tests/maintainer/pack-audit.test.cjs`, plus this KB pattern requiring `git worktree list --porcelain` and slash-terminated `git ls-files -z` checks before proposing product-code changes.
---

## phase06-codex-launcher-empty — Codex Windows launcher tests inherited a saturated global reminder cache
- **Date:** 2026-09-03
- **Error patterns:** empty stdout, Codex Windows launcher, cmd.exe, 14/17 tests pass, reminder cache, 1024 claim cap
- **Root cause(s):** The launcher test harness inherited the machine-global reminder cache instead of a suite-owned temporary cache; the failure required that non-hermetic test boundary together with a legitimate global cache already at the intentional 1024-claim cap.
- **Fix:** `tests/hooks/launcher.test.cts` creates one suite-owned temporary cache, injects it as `LOCALAPPDATA` and `XDG_CACHE_HOME` for launcher children, and removes it in a module `after` hook; production behavior is unchanged.
- **Files changed:** tests/hooks/launcher.test.cts
- **Why not caught:** The launcher tests randomized session identifiers but had no hermetic persistent-cache boundary; machines below the cap masked the dependency, while typecheck and lint cannot detect external-state coupling.
- **Recurrence guard:** The cache-isolated launcher harness in `tests/hooks/launcher.test.cts`; verified by the 17/17 focused launcher suite against a still-saturated real cache and 22/22 adjacent hook tests.
---
