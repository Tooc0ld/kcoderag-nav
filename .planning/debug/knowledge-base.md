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
