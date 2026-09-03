---
quick_id: 260903-x20
status: passed
verified: 2026-09-03
implementation_commit: 68a5690
hosted_ci_run: 33775964362
hosted_acceptance_run: 33775964593
---

# Verification: singleton packaged-smoke CI topology

## Must-haves

| Requirement | Result | Evidence |
|---|---|---|
| Documentation-only branch pushes do not start acceptance | PASS | The trigger ignores the exact closed set `README.md`, `docs/**`, and `.planning/**`; both the workflow contract and fail-closed acceptance validator reject filter drift. The repository has no branch protection or ruleset that would leave this skipped workflow as a required pending check. |
| Ordinary CI retains Windows/Linux and Node 22/24 while heavy packaged execution runs once | PASS | CI contract tests require the unchanged four-lane ordinary matrix and exactly one non-matrix Windows Node 22 packaged job. Hosted push run `33775964362` passed all four ordinary lanes and skipped the delegated packaged job. |
| Acceptance consumes one exact artifact in one hosted packaged lane and preserves LIVE | PASS | Hosted run `33775964593` contained one successful `PACKAGED / windows-node22`, one successful final gate, and the unchanged protected LIVE lane as skipped; no other packaged lane existed. |
| Release runs smoke once and cannot publish before both gates pass | PASS | Release contracts require the four-platform ordinary matrix, one independent Windows Node 22 `smoke:required`, exactly one smoke invocation, and `needs: [required-contracts, packaged-contracts]` on publish. No tag was created during this optimization. |
| Trust and secret boundaries remain closed | PASS | Action checks resolve every immutable SHA to the declared release; permissions remain read-only, LIVE inputs/environment guards are unchanged, and npm credentials remain scoped to the publish step only. |
| Repository regression gates remain green | PASS | Fresh local `ci:local` passed 531/531; generation reported zero drift; pack audit passed 19/19; docs and retirement audits passed. |

## Boundary

PACKAGED evidence remains synthetic public-package lifecycle evidence. The workflow change does not promote it to Phase 05 native-host LIVE or authenticated MCP evidence.

## Verdict

PASS. The expensive packaged lifecycle is single-lane, ordinary platform coverage and release gates remain required, and hosted product-change workflows completed successfully with a shorter critical path and substantially lower runner consumption.
