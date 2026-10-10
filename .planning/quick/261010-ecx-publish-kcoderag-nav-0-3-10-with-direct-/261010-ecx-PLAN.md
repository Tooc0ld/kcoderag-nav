---
type: quick
status: in_progress
date: 2026-10-10
---

# Publish dashboard direct-input support as 0.3.10

The user explicitly requested publication of a new version after the local dashboard implementation. This authorizes the forward patch release, its PR/merge/tag workflow, and public verification. Existing immutable versions and tags remain untouched.

1. Confirm origin/master and public npm latest remain 0.3.9. Prepare 0.3.10 with synchronized package/lock/compatibility manifests and deterministic generation. Preserve the separate original checkout's unrelated changes.
2. Validate the candidate locally, push the focused branch and open a PR. Require hosted Windows/Linux Node 22/24 tests and same-artifact five-host packaged verification before merge. Local Windows file-symlink permission limitations are not waivers for hosted verification.
3. Merge the reviewed candidate, create v0.3.10 on the merged commit, and push the tag to trigger the existing immutable Release workflow. Publication uses only the exact verified tgz from that workflow.
4. Wait for publication and registry availability proof. Independently verify the public exact version/latest and fresh-cache acquisition, record URLs and immutable identity, and update the already-authorized Claude/kscc project installation to the public version if healthy.

No workflow gate bypass, force-push, token disclosure, unpublish, tag deletion or dist-tag rollback. If publication is pending, only repeat read-only availability checks; do not republish the same version.
