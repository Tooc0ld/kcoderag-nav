# Phase 05 LIVE deferral

Status: deferred
Decision date: 2026-09-02
Release target: 0.3.2
Last protected run: 33607374389
Candidate product commit: 6e6893f41e3d83a1d5a416eeb6c32dc92f8ef819

The protected five-host LIVE gate remains incomplete and is explicitly deferred from the
0.3.2 publication decision. This deferral does not convert any LIVE receipt to PASS and does
not weaken the closed receipt state machine. Local tests, deterministic generation, package
audit, four-platform CI, and five-host PACKAGED smoke remain required release gates.

Deferred LIVE findings:

- Codex: `mcp_connection_failed` after successful project registration.
- Claude Code and OpenCode: `submit_feedback_unavailable` from the current QA service.
- Cursor: `host_cli_missing` on the self-hosted Windows runner.
- ZCode: `workspace_trust_missing`; the runner version must also match the frozen baseline.

Resolution requires a later explicit phase or plan that restores the feedback service,
captures metadata-only Codex transport evidence, provisions the Cursor agent CLI, aligns
ZCode version and trust, and reruns all five hosts against one exact protected candidate.
