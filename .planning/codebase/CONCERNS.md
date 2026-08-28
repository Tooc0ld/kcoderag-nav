# Codebase Concerns

**Analysis Date:** 2026-08-28

## Security and Operational Risks

### Built-in internal QA credential

- **Risk:** The current internal QA profile includes an install-ready bearer value. Distribution
  beyond the accepted internal test boundary would expose a reusable credential.
- **Boundary:** CLI output, diagnostics, tests, receipts, and documentation treat MCP connection
  material as opaque and must never print URL, headers, bearer values, or configuration bodies.
- **Planned resolution:** Phase 08 owns identity, HTTPS, credential rotation, and production release
  policy. This phase must not claim that risk is resolved.

### Host delivery is evidence-bound

- **Risk:** A host may accept a Skill or configuration file without exposing model-visible native
  pre-write context. Inferring support from file shape would create false capability claims.
- **Current mitigation:** `code-style-nudge` support requires an exact checked-in digest-bound PASS
  receipt. Unsupported or unproved versions return `host_version_unsupported` before render and make
  zero writes while navigation remains usable.
- **Remaining work:** Phase 06 owns authenticated true-host MCP evidence, OpenCode/ZCode admission,
  and ZCode version freezing.

### Workspace trust is outside installer authority

- **Risk:** ZCode project hooks may be present and byte-healthy while the host has not admitted them.
- **Current mitigation:** The adapter writes only project declarations and never pre-authorizes
  workspace trust. `status` and `doctor` report managed bytes, not user trust state.
- **Operator action:** Users approve workspace hooks in the host and restart the relevant session
  before true-host acceptance.

## Precision and Performance

### Advisory classification remains heuristic

- **Risk:** Structural-search nudges can still fire for fixed strings, narrow local review, generated
  text, or common Lua global handlers.
- **Current mitigation:** Hook boundaries are advisory, bounded, and fail open; local tools are never
  blocked.
- **Planned resolution:** Phase 05 owns precision improvements, marker consumption policy, and honest
  routing based on actual index capabilities.

### Per-event Node process startup

- **Risk:** Codex, Claude Code, and ZCode command hooks start a Node process for matched events.
- **Current mitigation:** Launchers and handlers are self-contained CJS with bounded input, no
  foreground network access, suppressed operational failures, and short execution timeouts.
- **Watch:** Measure real-host p95 latency before expanding matcher coverage.

## Integrity-Sensitive Areas

### Shared capability composition

- **Risk:** Multiple capabilities contribute to the same host files or structured sections. An
  incomplete contributor graph could remove another capability or user content.
- **Current mitigation:** Schema v1 records complete contributor lists, originals, individual
  digests, and one composite digest. Desired state is rendered completely and committed state-last
  by one transaction.
- **Safe modification:** Add composition, independent lifecycle, rollback, and drift tests whenever
  provider contributions change.

### Nearest-project hook discovery

- **Risk:** A damaged nested project could accidentally fall through to an outer project's hook
  runtime or state.
- **Current mitigation:** The nearest discovered managed boundary is authoritative. Invalid schema,
  digest, path, or runtime state fails open and stops the upward search.
- **Safe modification:** Preserve root, deep cwd, nested, damaged-nearest, moved-project, Unicode,
  and spaced-path launcher coverage.

### Generated product inventory

- **Risk:** Canonical TypeScript/templates, compiled CJS, generated QA/Cursor assets, and package
  allow-lists can drift independently.
- **Current mitigation:** Deterministic generation, repository checks, exact pack inventory, brand
  audit, and one-tgz smoke/readiness evidence are separate mandatory gates.
- **Safe modification:** Change canonical sources first; never hand-maintain generated product trees.

### Dirty-worktree documentation scrubs

- **Risk:** Planned neutralization can overlap user hunks or accidentally stage unrelated work.
- **Current mitigation:** Explicit-path scrub baseline capture, blocking overlap checkpoints,
  exact-path staging, immutable commit audits, and post-commit baseline preservation assertions.

## Source and Ownership Boundaries

### Manual or duplicate host sources

- **Risk:** Raw MCP, manual Hook/Rule, active plugin, or ambiguous historical sources can create two
  authorities for one selected host.
- **Current mitigation:** Every mutation deep-scans the selected host and hard-stops before render;
  status/doctor are read-only and secret-safe. The CLI does not migrate, adopt, or clean these sources.

### Project target safety

- **Risk:** Traversal, symlinks, special files, global roots, or ambiguous ownership could extend
  mutation beyond the selected project.
- **Current mitigation:** Adapters declare managed roots and sections; the transaction rejects
  undeclared paths, unsafe modes, digest drift, and dangerous targets before writes.

## Assurance Gaps

- Phase 04.2 proves packaged five-host lifecycle/smoke against one exact `0.3.0` candidate tgz; it
  does not tag, publish, or prove authenticated service queries.
- Phase 06 must close real MCP protocol/content evidence and true-host acceptance for all required
  rows.
- Phase 07 must make global GSD runtime/hook changes durable against updates.
- Phase 08 must replace the internal credential posture and establish production compatibility and
  release controls.

---

*Concerns audit refreshed: 2026-08-28*
