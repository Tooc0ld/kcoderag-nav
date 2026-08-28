# External Integrations

**Analysis Date:** 2026-08-28

## KCodeRag QA MCP Service

- **Purpose:** Supplies graph-first symbol search, context, call-chain, index, and related navigation
  tools through Model Context Protocol.
- **Projection:** `kcoderag-navigation` renders the service into each selected host's native project
  configuration.
- **Ownership:** The remote parser, graph, protocol deployment, and service data are outside this
  repository. This package owns only project integration and user guidance.
- **Credentials:** Endpoint and authorization values are opaque sensitive inputs. Diagnostics,
  documentation, tests, receipts, and smoke output must never include their values.
- **Current boundary:** Internal QA accepts an install-ready bearer risk until Phase 08. Authenticated
  real-service query evidence and protocol alignment remain Phase 06 work.

## Host Integrations

### Codex

- Project surfaces: `.codex/` and `.agents/skills/`.
- Native events: advisory/fail-open `PreToolUse` plus `PostToolUse` success marker.
- Launcher behavior: resolves the nearest valid managed state from session cwd and runs relative CJS.

### Claude Code

- Project surfaces: `.claude/settings.json`, `.claude/skills/`, and root `.mcp.json`.
- Native events: advisory/fail-open `PreToolUse` dispatcher plus `PostToolUse` success marker.
- Code-style support: exact Claude Code `2.1.241` PASS receipt only.

### Cursor

- Project surfaces: `.cursor/rules/`, `.cursor/skills/`, `.cursor/mcp.json`, and
  `.cursor/hooks.json`.
- Native behavior: always-on Rule/skill/MCP; `afterMCPExecution` records successful calls.
- Boundary: No claim of an equivalent native model-visible pre-write hook.

### OpenCode

- Project surfaces: exactly one root JSON/JSONC configuration plus `.opencode/`.
- Native behavior: project plugin, skill, MCP, and `tool.execute.after` marker.
- Safety: Simultaneous JSON and JSONC project roots hard-stop. User-global configuration is never
  managed.

### ZCode

- Project surfaces: `.zcode/config.json`, `.zcode/skills/`, and project hook runtime.
- Native events: advisory `PreToolUse`, successful-call `PostToolUse`, and offline update context.
- Trust boundary: The CLI does not pre-authorize workspace hooks. Host admission remains a user
  decision and true-host verification remains Phase 06.

## npm and Registry

- Public acquisition uses `npx kcoderag-nav@latest` and the package's root `package.json` bin.
- Foreground hooks never access the network. They read a bounded local cache and may schedule a
  detached worker to refresh npm latest metadata.
- Redirects, unexpected package identity, malformed content type/JSON, and invalid versions fail open
  without affecting the host operation.
- Phase 04.2 validates one exact local `0.3.0` candidate tgz only; it does not tag, publish, or refetch
  the registry.

## Local Files and State

- Each host owns project-scoped configuration, Skill assets, hook/plugin runtime as applicable, and
  one capability-scoped schema-v1 state file.
- State contains contributors, sections, originals, per-file/section digests, and one composite
  digest. It contains no MCP response bodies or diagnostic copies of connection values.
- User-cache files are limited to bounded secret-free call/update/nudge markers and mutation locks.

## Authentication and Identity

- The package does not implement user identity or a database client.
- Current internal bearer material is treated as an opaque install input and accepted only for the
  internal QA stage.
- Phase 08 owns production identity, HTTPS, credential rotation, and compatibility retirement.

## Monitoring and Observability

- Hook failures are intentionally silent and fail open.
- `status` provides a fast project health view; `doctor` deep-scans the selected host's project and
  user-level duplicate sources. Both are read-only and secret-safe.
- Success markers store only bounded ownership/time metadata and never MCP arguments or results.

## CI and Readiness

- GitHub Actions validates Windows/Linux on Node 22/24.
- Maintainer gates cover dependency integrity, strict build, Node tests, deterministic generation,
  documentation, retirement/source policy, actual tgz inventory, brand audit, and packaged smoke.
- Packaged smoke is not authenticated true-host evidence. Phase 06 retains that obligation.

---

*Integration audit refreshed: 2026-08-28*
