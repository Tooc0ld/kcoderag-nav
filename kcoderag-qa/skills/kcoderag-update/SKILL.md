---
name: kcoderag-update
description: Safely updates a project-scoped KCodeRag Nav installation for one selected host. Use only when the user explicitly asks to update KCodeRag Nav or refresh its installed project assets.
---

<objective>
Update one selected host's project-scoped KCodeRag Nav installation through the public npm CLI. An implicit Skill match is not mutation authority: continue only when the user's request explicitly asks for an update.
</objective>

<quick_start>
1. Resolve and state the exact project target and one host: `codex`, `claude`, `cursor`, `opencode`, or `zcode`.
2. Run `npx kcoderag-nav@latest status --target <absolute-project-root> --host <host>` as a read-only preflight.
3. After the target and host are confirmed, run `npx kcoderag-nav@latest update --target <absolute-project-root> --host <host> --yes`.
4. Re-run the same `status` command and report the resulting version and stable status code.
</quick_start>

<workflow>
- Require Node.js 22 or newer and use the host's normal shell without rewriting the npm command into a host-specific installer.
- Update exactly one host per CLI invocation. If the user names multiple hosts, treat them as separate explicit updates and report each result independently.
- Preserve the installed capability set. Do not turn an update request into install, uninstall, cleanup, migration, adoption, or manual file replacement.
- If status or update refuses because of source conflict, drift, ownership, symlink, special-file, runtime, or transaction checks, stop and report the stable code and safe path. Never bypass the refusal or delete files manually.
</workflow>

<security_checklist>
- Never print MCP URLs, headers, Bearer values, tokens, configuration bodies, or captured subprocess bodies.
- Keep diagnostics limited to stable codes, versions, host names, and safe project-relative paths.
</security_checklist>

<success_criteria>
- The user explicitly requested the update and the exact target and host were confirmed.
- The public `update` command exited successfully through its normal ownership and transaction gates.
- The post-update `status` check reports a healthy installation for that host.
- No unrelated host, project, capability, user-level source, or secret-bearing value was changed or exposed.
</success_criteria>
