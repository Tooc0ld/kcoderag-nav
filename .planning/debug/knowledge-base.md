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
