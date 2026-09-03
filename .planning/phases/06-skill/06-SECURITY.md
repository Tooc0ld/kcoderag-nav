---
phase: 06
slug: skill
status: verified
threats_open: 0
asvs_level: 1
created: 2026-09-03
---

# Phase 06 — Security

> Per-phase security contract for the four public Skills and their five-host delivery.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Existing index/worktree to Phase 06 staging | Inherited staged product work coexists with unrelated dirty user work. | Source and planning bytes |
| Public Skill discovery to mutation | Implicit invocation must not become lifecycle or edit authority. | User intent and mutation authority |
| Host/version/state to delivery claim | Positive manual/native claims require complete state integrity and frozen receipt evidence. | Host metadata and managed-state digests |
| Prior owned paths to transaction | Only exact prior state ownership grants reconciliation authority. | Managed paths, sections, and expected digests |
| Canonical source to generated package | Canonical instructions become generated trees, archive bytes, and disposable-host behavior. | Published code and Skill assets |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-06-01-01 | Tampering | Git index and dirty worktree | high | mitigate | Closed staging and index/blob rechecks in `src/maintainer/pre-commit.cts`; preservation coverage in `tests/maintainer/pre-commit.test.cts`. | closed |
| T-06-01-02 | Elevation of Privilege | `kcoderag-manage` and style guidance | high | mitigate | Management defaults to status/doctor and mutation requires explicit intent; style exposes prepare/review only. | closed |
| T-06-01-03 | Information Disclosure | Feedback and diagnostics | high | mitigate | Feedback is result-backed and secret-safe; diagnostics expose stable codes and sanitized paths only. | closed |
| T-06-01-04 | Spoofing | Native style availability | high | mitigate | Exact Claude 2.1.241 receipt plus contributor, section, and digest integrity gates automatic delivery. | closed |
| T-06-01-05 | Tampering | Rename reconciliation | high | mitigate | Schema-v1 ownership and expected digests authorize changes through the atomic transaction boundary. | closed |
| T-06-01-06 | Denial of Service | Hook/runtime inputs | high | mitigate | Bounded parsing/output and fail-open error handling preserve exit-zero behavior without consuming markers. | closed |
| T-06-01-07 | Tampering | Generated package | high | mitigate | Explicit generator routes, drift checks, closed pack inventory, and acquired-package smoke bind delivered bytes. | closed |
| T-06-01-08 | Repudiation | Verification and commit | medium | mitigate | RED/GREEN/Summary commits plus direct and normal pre-commit evidence bind the verified tree. | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `workflow.security_block_on` count toward `threats_open`.*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party).*

---

## Accepted Risks Log

No accepted risks.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-03 | 8 | 8 | 0 | GSD security auditor |
| 2026-09-03 | 8 | 8 | 0 | GSD post-review verification |

Fresh evidence included generator drift check with zero changes, 29/29 Skill/support/hook/pre-commit tests, 57/57 CLI/state/transaction/host/source-safety tests, and 38/38 pack/acquired-package smoke tests. The three retired compiled outputs remain absent.

Post-review verification binds the ownership fix `271b26e`, the five-host public Skill source-gate fix `68a948f`, and the deferred-evidence documentation fix `9087c00`. Auto re-review is clean across 89 files; the bounded regression gate and final `ci:local` each pass 527/527 tests, generation remains drift-free, pack passes 19/19, and the final five-host packaged smoke receipt is PASS.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-03
