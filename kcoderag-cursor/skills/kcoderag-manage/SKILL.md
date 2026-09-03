---
name: kcoderag-manage
description: Inspect and maintain a project-scoped KCodeRag Nav installation. Use for status, doctor, version checks, or an explicitly requested update; require separate explicit authorization before uninstalling or making another destructive lifecycle change.
---

# KCodeRag Management

Manage only the selected host in the explicit project target.

## Safe default

Start with read-only commands:

- Run `npx kcoderag-nav@latest status --host <host>` for current project health.
- Run `npx kcoderag-nav@latest doctor --host <host>` for deeper source and integrity diagnostics.
- Report stable codes and safe paths only. Never expose MCP URLs, headers, bearer tokens,
  configuration bodies, or subprocess output.

Run `update` only when the user explicitly asks to update. Confirm the target and host, then
use the normal CLI so ownership, source-conflict, drift, and transaction gates remain active.

Uninstall or another destructive lifecycle action requires a separate explicit user request.
Never infer mutation authority from this Skill being selected, and never bypass a refusal or
manually delete files that the current schema-v1 state does not prove are owned.
