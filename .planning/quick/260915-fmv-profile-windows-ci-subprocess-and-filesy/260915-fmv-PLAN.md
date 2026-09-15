---
status: complete
quick_id: 260915-fmv
---

# Profile and optimize Windows CI overhead

1. Profile the existing exact-package serial smoke and ordinary tests. Record metadata-only subprocess/filesystem timing, establish local baselines and inspect prior hosted timing. No performance attribution without measurements.
2. Optimize the measured bottleneck in maintainer/test infrastructure or its shared implementation. Preserve npm lifecycle evidence, artifact integrity, all hosts, Node 22/24 and Windows/Linux coverage. Add focused regression tests. Workflow edits are conditional on measured need.
3. Run before/after probes, focused tests and full relevant gates; commit scoped code, record evidence and update STATE.md. No release, native LIVE, credentials, global configuration or antivirus changes.

Execution: inline GSD quick fallback; no subagents. Existing unrelated untracked quick directory is preserved.

<threat_model>
ASVS level 1; high findings block. Reports must never contain subprocess output, environment values or MCP configuration. Optimizations must not bypass artifact checks, drift checks, failure propagation or ownership boundaries. Diagnostic preloads are task-local and are not installed into user hooks.
</threat_model>

No external API integration or database schema change. Existing host and evidence identities remain unchanged.
