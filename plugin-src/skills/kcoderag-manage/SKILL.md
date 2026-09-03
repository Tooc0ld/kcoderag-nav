---
name: kcoderag-manage
description: Inspect a project-scoped KCodeRag Nav installation and diagnose its health. Use for status, doctor, or version checks; route explicit update requests to $kcoderag-update and require separate authorization for destructive lifecycle changes.
---

# KCodeRag Management

Manage only the selected host in the explicit project target.

## Safe default

Start with read-only commands:

- Run `npx kcoderag-nav@latest status --host <host>` for current project health.
- Run `npx kcoderag-nav@latest doctor --host <host>` for deeper source and integrity diagnostics.
- Report stable codes and safe paths only. Never expose MCP URLs, headers, bearer tokens,
  configuration bodies, or subprocess output.

For an explicit update request, load and follow `$kcoderag-update`. Do not duplicate its mutation
workflow or treat management discovery as update authority.

Uninstall or another destructive lifecycle action requires a separate explicit user request.
Never infer mutation authority from this Skill being selected, and never bypass a refusal or
manually delete files that the current schema-v1 state does not prove are owned.
