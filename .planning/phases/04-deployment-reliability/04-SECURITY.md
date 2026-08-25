---
schemaVersion: 1
artifact: security
subjectSha: 223bb76d034f9acd3868c36706f8d1c8762bd515
subjectTree: 9f89bf5efa7e9c863a506bb49ca9cc83ecd88fd7
verdict: SECURED
openHighThreats: 0
openCriticalThreats: 0
---

# Phase 04 ASVS-L1 Security Audit

## Scope and Method

The audit covers the immutable subject and applies ASVS Level 1 controls relevant to a local project installer and npm publication pipeline: architecture and trust boundaries, authorization, input validation, error handling, data protection, file handling, dependency/configuration security, and release integrity. The Phase 04 STRIDE register was checked against production code, negative tests, workflows, pack contents, and release evidence validators.

## Applicable ASVS-L1 Controls

| Area | Result | Evidence |
| --- | --- | --- |
| Architecture and trust boundaries | PASS | Host adapters are read/render-only; the shared transaction is the project write boundary; maintainer publication operations use closed write-sets. |
| Authorization and access control | PASS | Legacy Dev migration, owned source cleanup, and legacy Cursor removal require separate explicit authority. Cleanup is bound to a fresh fingerprint and fixed native capability. |
| Input and schema validation | PASS | Target paths, managed paths, state, user-source findings, process results, evidence frontmatter, CI tuples, Registry artifacts, and receipts use bounded closed schemas. |
| Error handling and diagnostics | PASS | Expected failures use stable codes and safe paths. Hook failures are silent and fail open; machine output remains one bounded JSON value. |
| Data protection | PASS | MCP connection material remains opaque; state and diagnostics do not snapshot shared configuration values; receipt and evidence validators recursively reject sensitive-looking content. |
| File and resource handling | PASS | Root/traversal/symlink/special-file escapes, drift, final-window identity swaps, and rollback failures are tested. Writes are staged, atomic, state-last, and host-local. |
| Dependency and configuration security | PASS | Runtime dependencies remain empty, the development graph is exact, lifecycle scripts are disabled for acquisition/audit, third-party actions are commit-pinned, and workflow permissions are minimal. |
| Release integrity | PASS | The helper owns exactly five version paths, never publishes, and restores failures; ordinary CI is publication-free; tag Release requires four platform/runtime lanes before the sole publish job. |

## STRIDE Threat Register

| Threat | Disposition | Result |
| --- | --- | --- |
| T-04-15-01 evidence subject spoofing | Mitigated | All three verdicts bind the same immutable SHA/tree; executable validation requires a direct-child three-path evidence commit and rejects self-binding. |
| T-04-15-02 final ordinary CI tampering | Mitigated | The validator requires local and remote evidence heads plus the exact unique Ubuntu/Windows by Node 22/24 success matrix. |
| T-04-15-03 release privilege widening | Mitigated | Only the audited helper can create the exact five-path commit/tag; dirty index, version drift, extra paths, failed gates, and existing tags refuse before mutation or roll back completely. |
| T-04-15-04 Registry artifact spoofing | Mitigated | Public acquisition pins the official Registry, rejects redirects, and binds exact/latest metadata, canonical tarball URL, integrity, artifact hashes, and release workflow identity. |
| T-04-15-05 diagnostic disclosure | Mitigated | Diagnostics and persisted evidence are metadata-only; scanners reject configuration-like or sensitive-looking keys and values without echoing them. |
| T-04-15-SC public acquisition tampering | Mitigated | Per-command content-addressed tarballs are rechecked after execution; replacement, integrity drift, package identity drift, and latest races fail before project writes. |

## Audit Evidence

- Official-Registry isolated dependency audit: 0 low, 0 moderate, 0 high, 0 critical vulnerabilities.
- `npm run ci:local`: 281 tests passed with no skips or todos, followed by deterministic generation, exact pack audit, and required three-host smoke.
- Static review found no dynamic evaluation, shell-enabled production subprocess, force-push, unpublish, tag replacement, or distribution-tag rollback path.
- The two release-provenance gaps and one CI-isolation defect were fixed before this subject was frozen and are covered by executable tests.

## Verdict

`SECURED` — all applicable ASVS-L1 controls and Phase 04 mitigations pass; zero open high or critical threats remain.
